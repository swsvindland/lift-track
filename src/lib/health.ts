import Constants from "expo-constants";
import { eq } from "drizzle-orm";
import { db, healthLinks, preferences, weightEntries } from "@/db";
import { getHealthAdapter } from "./health-native";
import type { HealthAdapter, HealthKind, HealthRecord } from "./health-types";
import { validDay, dayOf } from "./metrics";

let running = false;
export async function syncHealth(adapter?: HealthAdapter, interactive = true) {
  if (running) throw new Error("syncing");
  if (!adapter && Constants.appOwnership === "expo") throw new Error("healthUnavailable");
  running = true;
  try {
    let provider: HealthAdapter;
    try {
      provider = adapter ?? (await getHealthAdapter());
    } catch {
      throw new Error("healthUnavailable");
    }
    await provider.authorize(interactive);
    let installation = db
      .select()
      .from(preferences)
      .where(eq(preferences.key, "installation"))
      .get()?.value;
    if (!installation) {
      installation = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      db.insert(preferences).values({ key: "installation", value: installation }).run();
    }
    const prefix = `lift-track:${installation}:`;
    let imported = 0;
    let exported = 0;
    const localRecords = () => [
      ...db
        .select()
        .from(weightEntries)
        .all()
        .map((w) => ({
          id: w.id,
          kind: "weight" as const,
          value: w.weightKg,
          measuredAt: w.measuredAt,
          version: w.updatedAt?.getTime() ?? w.createdAt?.getTime() ?? 1,
        })),
    ];
    const fingerprint = (record: { value: number; measuredAt: string }) =>
      `${record.value}:${record.measuredAt}`;
    const links = db.select().from(healthLinks).all();
    // Export before import. Persist each mapping immediately, so partial failures are safely retried.
    for (const record of localRecords()) {
      if (
        links.some(
          (l) => l.localKind === record.kind && l.localId === record.id && l.origin === "health"
        )
      )
        continue;
      const key = `${prefix}${record.kind}:${record.id}`;
      const link = links.find((l) => l.key === key);
      const hash = fingerprint(record);
      if (link?.fingerprint === hash) continue;
      const remoteId = await provider.write({
        ...record,
        clientId: key,
        version: Math.max(record.version, Date.now()),
      });
      db.insert(healthLinks)
        .values({
          key,
          localKind: record.kind,
          localId: record.id,
          remoteId,
          fingerprint: hash,
          origin: "local",
        })
        .onConflictDoUpdate({ target: healthLinks.key, set: { remoteId, fingerprint: hash } })
        .run();
      exported++;
    }
    const current = localRecords();
    for (const link of links.filter((l) => l.origin === "local" && l.fingerprint !== "deleted")) {
      if (link.localKind !== "weight") continue;
      if (!current.some((r) => r.kind === link.localKind && r.id === link.localId)) {
        await provider.remove(link.localKind as HealthKind, link.remoteId);
        db.update(healthLinks)
          .set({ fingerprint: "deleted" })
          .where(eq(healthLinks.key, link.key))
          .run();
      }
    }
    const external = await provider.read();
    for (const record of external) {
      if (record.kind !== "weight") continue;
      if (record.clientId?.startsWith(prefix) || !validHealthRecord(record)) continue;
      const key = `health:${record.kind}:${record.id}`;
      const link = db.select().from(healthLinks).where(eq(healthLinks.key, key)).get();
      const hash = fingerprint(record);
      if (link?.fingerprint === hash) continue;
      db.transaction((tx) => {
        let localId = link?.localId;
        if (link)
          tx.update(weightEntries)
            .set({ weightKg: record.value, measuredAt: record.measuredAt, updatedAt: new Date() })
            .where(eq(weightEntries.id, link.localId))
            .run();
        else
          localId = tx
            .insert(weightEntries)
            .values({ weightKg: record.value, measuredAt: record.measuredAt })
            .returning()
            .get().id;
        tx.insert(healthLinks)
          .values({
            key,
            localKind: record.kind,
            localId: localId!,
            remoteId: record.id,
            fingerprint: hash,
            origin: "health",
          })
          .onConflictDoUpdate({ target: healthLinks.key, set: { fingerprint: hash } })
          .run();
      });
      imported++;
    }
    const value = new Date().toISOString();
    db.insert(preferences)
      .values({ key: "lastSync", value })
      .onConflictDoUpdate({ target: preferences.key, set: { value } })
      .run();
    return { imported, exported };
  } finally {
    running = false;
  }
}
export function validHealthRecord(record: HealthRecord) {
  return (
    Number.isFinite(record.value) &&
    record.value > 0 &&
    record.value <= 500 &&
    Number.isFinite(Date.parse(record.measuredAt)) &&
    validDay(dayOf(record.measuredAt))
  );
}
