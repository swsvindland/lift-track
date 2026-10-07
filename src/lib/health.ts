import Constants from "expo-constants";
import { eq, isNotNull } from "drizzle-orm";
import { db, healthLinks, preferences, weightEntries, workouts } from "@/db";
import { getHealthAdapter } from "./health-native";
import type { HealthAdapter, HealthKind, HealthRecord } from "./health-types";
import { validDay, dayOf } from "./metrics";

let running = false;
let maintenance = false;

/** Restore and erase hold this so no sync reads or writes records while they're replaced. */
export async function withHealthPaused<T>(work: () => Promise<T>): Promise<T> {
  if (running || maintenance) throw new Error("Wait for Health sync to finish, then try again.");
  maintenance = true;
  try {
    return await work();
  } finally {
    maintenance = false;
  }
}

/**
 * The vault's restore pause: waits up to `timeoutMs` for a running sync (or another pause) to
 * end, then holds sync off while `work` runs. The pause is taken in the same tick that sees sync
 * idle, so no sync can start in between; past the timeout it throws.
 */
export async function pauseWhenIdle<T>(work: () => Promise<T>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (running || maintenance) {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error("healthBusy");
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, left)));
  }
  maintenance = true;
  try {
    return await work();
  } finally {
    maintenance = false;
  }
}

/** The installations whose exports are this app's own: `"*"` stands for every installation. */
function lineage(value: string | undefined): Set<string> {
  try {
    const list: unknown = JSON.parse(value ?? "[]");
    return new Set(
      Array.isArray(list) ? list.filter((i): i is string => typeof i === "string" && !!i) : []
    );
  } catch {
    return new Set();
  }
}

/** A weight reading as its fingerprint describes it, rounded so another store's copy compares equal. */
const readingKey = (value: number, measuredAt: string) =>
  `${Math.round(value * 100)}:${Math.floor(Date.parse(measuredAt) / 1000)}`;
const fingerprintKey = (fingerprint: string) => {
  const at = fingerprint.indexOf(":");
  return readingKey(Number(fingerprint.slice(0, at)), fingerprint.slice(at + 1));
};

export async function syncHealth(adapter?: HealthAdapter, interactive = true) {
  if (running || maintenance) throw new Error("syncing");
  if (!adapter && Constants.appOwnership === "expo") throw new Error("healthUnavailable");
  running = true;
  try {
    let provider: HealthAdapter;
    try {
      provider = adapter ?? (await getHealthAdapter());
    } catch {
      throw new Error("healthUnavailable");
    }
    const access = (await provider.authorize(interactive)) ?? {
      weightRead: true,
      weightWrite: true,
      workoutWrite: true,
    };
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
    // Every installation this library's exports were written under, this one included: a restored
    // library keeps them, so their samples are never imported back as another app's readings.
    const known = lineage(
      db.select().from(preferences).where(eq(preferences.key, "healthInstallations")).get()?.value
    );
    if (!known.has(installation)) {
      known.add(installation);
      const value = JSON.stringify([...known].sort());
      db.insert(preferences)
        .values({ key: "healthInstallations", value })
        .onConflictDoUpdate({ target: preferences.key, set: { value } })
        .run();
    }
    const ownClient = (clientId?: string) =>
      !!clientId &&
      (known.has("*")
        ? clientId.startsWith("lift-track:")
        : [...known].some((i) => clientId.startsWith(`lift-track:${i}:`)));
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
    // Keys written below: each now names the sample just saved, whatever `links` still says of it.
    const written = new Set<string>();
    // Export before import. Persist each mapping immediately, so partial failures are safely retried.
    for (const record of access.weightWrite ? localRecords() : []) {
      if (
        links.some(
          (l) => l.localKind === record.kind && l.localId === record.id && l.origin === "health"
        )
      )
        continue;
      // A record keeps the key it was first exported under, whichever installation wrote it (a
      // restore brings the links along), so writing it again replaces that sample.
      const link = links.find(
        (l) =>
          l.origin === "local" &&
          l.localKind === record.kind &&
          l.localId === record.id &&
          l.localId >= 0
      );
      const key = link?.key ?? `${prefix}${record.kind}:${record.id}`;
      const hash = fingerprint(record);
      if (link?.fingerprint === hash) continue;
      const remoteId = await provider.write({
        ...record,
        clientId: key,
        version: Math.max(record.version, Date.now()),
      });
      // The sample saved under this key is this record's now, even if a restore set the key aside.
      db.insert(healthLinks)
        .values({
          key,
          localKind: record.kind,
          localId: record.id,
          remoteId,
          fingerprint: hash,
          origin: "local",
        })
        .onConflictDoUpdate({
          target: healthLinks.key,
          set: { localId: record.id, remoteId, fingerprint: hash },
        })
        .run();
      written.add(key);
      exported++;
    }
    const current = localRecords();
    // A row a restore gave to a Health import (another phone's reading under this id) is never
    // exported: the sample this link saved for the old record has nothing behind it any more.
    const imports = links.filter((l) => l.origin === "health");
    for (const link of links.filter((l) => l.origin === "local" && l.fingerprint !== "deleted")) {
      if (link.localKind !== "weight" || !access.weightWrite || written.has(link.key)) continue;
      if (
        !current.some((r) => r.kind === link.localKind && r.id === link.localId) ||
        imports.some((i) => i.localKind === link.localKind && i.localId === link.localId)
      ) {
        // An empty remote id (restored from the other platform) is removed by its client id.
        await provider.remove(link.localKind as HealthKind, link.remoteId, link.key);
        db.update(healthLinks)
          .set({ fingerprint: "deleted" })
          .where(eq(healthLinks.key, link.key))
          .run();
      }
    }
    if (access.workoutWrite && provider.writeWorkout && provider.removeWorkout)
      exported += await syncWorkouts(provider, prefix);
    const external = access.weightRead ? await provider.read() : [];
    // Readings already imported, by value and second: the same reading under another sample id (a
    // restore onto the other platform, or a store that re-issued ids) links to the same row, or
    // stays deleted with it, instead of coming in twice.
    const twins = new Map<string, number>();
    for (const l of db.select().from(healthLinks).all())
      if (l.origin === "health" && l.localKind === "weight") {
        const reading = fingerprintKey(l.fingerprint);
        if (!twins.has(reading)) twins.set(reading, l.localId);
      }
    for (const record of external) {
      if (record.kind !== "weight") continue;
      if (ownClient(record.clientId) || !validHealthRecord(record)) continue;
      const key = `health:${record.kind}:${record.id}`;
      const link = db.select().from(healthLinks).where(eq(healthLinks.key, key)).get();
      const hash = fingerprint(record);
      if (link?.fingerprint === hash) continue;
      const reading = readingKey(record.value, record.measuredAt);
      const twin = link ? undefined : twins.get(reading);
      if (twin !== undefined) {
        db.insert(healthLinks)
          .values({
            key,
            localKind: record.kind,
            localId: twin,
            remoteId: record.id,
            fingerprint: hash,
            origin: "health",
          })
          .onConflictDoNothing()
          .run();
        continue;
      }
      if (link) {
        const before = fingerprintKey(link.fingerprint);
        if (twins.get(before) === link.localId) twins.delete(before);
      }
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
        if (!twins.has(reading)) twins.set(reading, localId!);
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

/**
 * Writes finished workouts as strength-training sessions. Health stores can't edit a workout,
 * so a changed one is removed and written again; one deleted here is removed there.
 */
async function syncWorkouts(provider: HealthAdapter, prefix: string) {
  const writeWorkout = provider.writeWorkout!;
  const removeWorkout = provider.removeWorkout!;
  let exported = 0;
  const finished = db.select().from(workouts).where(isNotNull(workouts.endedAt)).all();
  const links = db
    .select()
    .from(healthLinks)
    .all()
    .filter((l) => l.localKind === "workout" && l.origin === "local");
  // Keys written below: each now names the workout just saved, whatever `links` still says of it.
  const written = new Set<string>();
  // The sample ids those writes returned (Health Connect updates a record in place and keeps its id).
  const writtenIds = new Set<string>();
  for (const w of finished) {
    const hash = `${w.startedAt}|${w.endedAt}|${w.name}`;
    // Matched by workout, not key: a restored workout keeps the Health copy it already has.
    const link = links.find((l) => l.localId === w.id);
    // A `lift-track:` key is the saved workout's own sync id, so writing under it again replaces
    // that workout. A `restored:` key (from a v1 backup) is not: it reaches its workout by remote
    // id only, and gives way to a real key the first time the workout is written again.
    const own = link !== undefined && link.key.startsWith("lift-track:");
    const key = own ? link.key : `${prefix}workout:${w.id}`;
    if (link?.fingerprint === hash) continue;
    // A restore on another device resets an own key to "": the write replaces the copy in place.
    // Anything else is removed first. An empty remote id (restored from the other platform) names
    // nothing to remove.
    if (
      link &&
      link.fingerprint !== "deleted" &&
      !(own && link.fingerprint === "") &&
      link.remoteId !== ""
    )
      await removeWorkout(link.remoteId);
    const remoteId = await writeWorkout({
      clientId: key,
      version: Math.max(w.updatedAt, Date.now()),
      startedAt: w.startedAt,
      endedAt: w.endedAt!,
      title: w.name || "Strength training",
    });
    // A `restored:` link gives way to the real key. It stays, as a tombstone parked at -1: it is this store's only
    // record that its sample is gone, which a later restore of an archive still linking that sample needs (the
    // vault's merge then has the workout written again).
    if (link && link.key !== key)
      db.update(healthLinks)
        .set({ localId: -1, fingerprint: "deleted" })
        .where(eq(healthLinks.key, link.key))
        .run();
    // The key may be one a restore set aside for removal (this phone's own copy of the workout,
    // carried with local id -1): writing under it replaced that copy, so the key is this
    // workout's again and is not removed below.
    db.insert(healthLinks)
      .values({
        key,
        localKind: "workout",
        localId: w.id,
        remoteId,
        fingerprint: hash,
        origin: "local",
      })
      .onConflictDoUpdate({
        target: healthLinks.key,
        set: { localId: w.id, remoteId, fingerprint: hash },
      })
      .run();
    written.add(key);
    writtenIds.add(remoteId);
    exported++;
  }
  for (const link of links) {
    if (
      link.fingerprint === "deleted" ||
      written.has(link.key) ||
      finished.some((w) => w.id === link.localId)
    )
      continue;
    // A record this pass just wrote under its own key (Health Connect updated it in place, keeping its id): this
    // link no longer names a sample of its own, so it goes without removing anything. Not kept as a tombstone: a
    // later restore of a file with this link's key would then write the workout next to that record.
    if (writtenIds.has(link.remoteId)) {
      db.delete(healthLinks).where(eq(healthLinks.key, link.key)).run();
      continue;
    }
    await removeWorkout(link.remoteId, link.key);
    db.update(healthLinks)
      .set({ fingerprint: "deleted" })
      .where(eq(healthLinks.key, link.key))
      .run();
  }
  return exported;
}
