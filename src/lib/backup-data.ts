import { z } from "zod";
import { eq } from "drizzle-orm";
import {
  aiNudges,
  customExercises,
  db,
  exerciseSettings,
  gyms,
  healthLinks,
  mesoDays,
  mesoSkips,
  mesoSlots,
  mesocycles,
  muscleFeedback,
  preferences,
  sets,
  weightEntries,
  workoutExercises,
  workouts,
  efforts,
  feedbackRatings,
  setKinds,
  sorenessLevels,
} from "@/db";
import { equipment, muscles, patterns } from "./exercises/types";

/* The encrypted backup's contents: every training record and body weight, validated field by
   field so a damaged or hand-edited file can't put anything unexpected into the database. */

export const MAX_BACKUP_TEXT = 20 * 1024 * 1024;
const text = z.string().max(20000);
const id = z.number().int().positive();
const kg = z.number().finite().min(0).max(2000);
const iso = z
  .string()
  .max(40)
  .refine((value) => Number.isFinite(Date.parse(value)));
const timestamp = z.number().int().nonnegative().max(8640000000000000);
const muscleWeights = z
  .partialRecord(z.enum(muscles), z.union([z.literal(1), z.literal(0.5)]))
  .refine((m) => Object.values(m).includes(1), "An exercise needs a primary muscle");
const many = <T extends z.ZodType>(item: T, max = 200000) => z.array(item).max(max);

const dataSchema = z.strictObject({
  weights: many(
    z.strictObject({
      id,
      weightKg: z.number().finite().positive().max(1000),
      measuredAt: iso,
      createdAt: iso.nullable(),
      updatedAt: iso.nullable(),
      // The Health sample a reading was imported from, so a restore keeps them linked.
      healthId: text.min(1).optional(),
    })
  ),
  customExercises: many(
    z.strictObject({
      id: z.string().regex(/^custom-[a-z0-9-]{1,60}$/),
      name: text.min(1).max(120),
      equipment: z.enum(equipment),
      pattern: z.enum(patterns),
      muscles: muscleWeights,
      unilateral: z.boolean(),
      load: z.enum(["bodyweight", "assisted"]).nullable(),
      repMin: z.number().int().min(1).max(100),
      repMax: z.number().int().min(1).max(100),
      cue: text,
      archived: z.boolean(),
      updatedAt: timestamp,
    }),
    10000
  ),
  exerciseSettings: many(
    z.strictObject({
      exerciseId: text.min(1).max(100),
      favorite: z.boolean(),
      avoid: z.boolean(),
      restSeconds: z.number().int().min(0).max(3600).nullable(),
      note: text,
    }),
    10000
  ),
  gyms: many(
    z.strictObject({
      id,
      name: text.min(1).max(120),
      unit: z.enum(["kg", "lb"]),
      barWeight: z.number().finite().min(0).max(200),
      plates: z.array(z.number().finite().positive().max(200)).min(1).max(30),
      dumbbellStep: z.number().finite().positive().max(100),
      dumbbellMax: z.number().finite().positive().max(1000),
      machineStep: z.number().finite().positive().max(100),
      equipment: z.array(z.enum(equipment)).max(equipment.length),
      // Added later; older backups have neither.
      excluded: z.array(text.min(1).max(100)).max(10000).optional(),
      included: z.array(text.min(1).max(100)).max(10000).optional(),
      archived: z.boolean(),
    }),
    100
  ),
  mesocycles: many(
    z.strictObject({
      id,
      name: text.min(1).max(120),
      rir: z.array(z.number().int().min(0).max(10)).min(1).max(12),
      deload: z.boolean(),
      deprioritized: z.array(z.enum(muscles)).max(muscles.length).optional(),
      gymId: id.nullable().optional(),
      method: z.number().int().min(1).max(100),
      status: z.enum(["saved", "active", "finished"]),
      startedAt: iso,
      endedAt: iso.nullable(),
    }),
    10000
  ),
  mesoDays: many(
    z.strictObject({ id, mesoId: id, position: z.number().int().min(0).max(100), name: text }),
    100000
  ),
  mesoSlots: many(
    z.strictObject({
      id,
      dayId: id,
      position: z.number().int().min(0).max(100),
      exerciseId: text.min(1).max(100),
      sets: z.number().int().min(1).max(20),
      repMin: z.number().int().min(1).max(100),
      repMax: z.number().int().min(1).max(100),
    })
  ),
  mesoSkips: many(
    z.strictObject({ id, mesoId: id, week: z.number().int().min(0).max(20), dayId: id })
  ),
  workouts: many(
    z.strictObject({
      id,
      name: text.max(120),
      startedAt: iso,
      endedAt: iso.nullable(),
      gymId: id.nullable(),
      bodyWeightKg: z.number().finite().positive().max(1000).nullable(),
      mesoId: id.nullable(),
      mesoWeek: z.number().int().min(0).max(20).nullable(),
      mesoDayId: id.nullable(),
      deload: z.boolean(),
      travel: z.boolean().optional(),
      note: text,
      updatedAt: timestamp,
      // The Health workout this one was saved as, so restoring doesn't save it twice.
      healthId: text.min(1).optional(),
    })
  ),
  workoutExercises: many(
    z.strictObject({
      id,
      workoutId: id,
      exerciseId: text.min(1).max(100),
      position: z.number().int().min(0).max(1000),
      supersetGroup: z.number().int().min(0).max(1000).nullable(),
      repMin: z.number().int().min(1).max(100),
      repMax: z.number().int().min(1).max(100),
      note: text,
      slotId: id.nullable(),
      advice: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).nullable(),
    })
  ),
  sets: many(
    z.strictObject({
      id,
      workoutExerciseId: id,
      position: z.number().int().min(-1000).max(1000),
      kind: z.enum(setKinds),
      weightKg: kg.nullable(),
      reps: z.number().int().min(0).max(1000).nullable(),
      rir: z.number().finite().min(0).max(10).nullable(),
      // Backups from before effort ratings don't have them.
      effort: z.enum(efforts).nullable().optional(),
      side: z.enum(["left", "right"]).nullable(),
      completedAt: iso.nullable(),
      targetWeightKg: kg.nullable(),
      targetReps: z.number().int().min(0).max(1000).nullable(),
      targetRir: z.number().finite().min(0).max(10).nullable(),
    }),
    1000000
  ),
  muscleFeedback: many(
    z.strictObject({
      id,
      workoutId: id,
      muscle: z.enum(muscles),
      rating: z.enum(feedbackRatings).nullable(),
      soreness: z.enum(sorenessLevels).nullable().optional(),
    })
  ),
  // Backups from before the model's nudges don't have them.
  aiNudges: many(
    z.strictObject({
      id,
      workoutId: id,
      exerciseId: text.min(1).max(100).nullable(),
      muscle: z.enum(muscles).nullable(),
      value: z.number().int().min(-1).max(1),
      reason: text.max(200),
      dismissed: z.boolean(),
    })
  ).optional(),
  activeGym: id.nullable(),
});

const schema = z
  .strictObject({
    format: z.literal("lift-track-backup"),
    version: z.literal(1),
    createdAt: iso,
    data: dataSchema,
  })
  .superRefine(({ data }, context) => {
    const fail = (message: string) => context.addIssue({ code: "custom", message });
    const ids = <T extends { id: number }>(rows: T[], name: string) => {
      const set = new Set(rows.map((r) => r.id));
      if (set.size !== rows.length) fail(`Duplicate ids in ${name}`);
      return set;
    };
    const gymIds = ids(data.gyms, "gyms");
    const mesoIds = ids(data.mesocycles, "programs");
    const dayIds = ids(data.mesoDays, "program days");
    const slotIds = ids(data.mesoSlots, "program slots");
    const workoutIds = ids(data.workouts, "workouts");
    const blockIds = ids(data.workoutExercises, "workout exercises");
    ids(data.sets, "sets");
    ids(data.weights, "weights");
    ids(data.mesoSkips, "skipped sessions");
    ids(data.muscleFeedback, "feedback");
    ids(data.aiNudges ?? [], "nudges");
    if (new Set(data.customExercises.map((e) => e.id)).size !== data.customExercises.length)
      fail("Duplicate custom exercises");
    if (
      new Set(data.exerciseSettings.map((e) => e.exerciseId)).size !== data.exerciseSettings.length
    )
      fail("Duplicate exercise settings");
    const has = (set: Set<number>, value: number | null) => value === null || set.has(value);
    if (data.mesoDays.some((d) => !mesoIds.has(d.mesoId))) fail("Program day without program");
    if (data.mesocycles.some((m) => !has(gymIds, m.gymId ?? null)))
      fail("Program refers to a missing gym");
    if (data.mesoSlots.some((s) => !dayIds.has(s.dayId) || s.repMin > s.repMax))
      fail("Invalid program slot");
    if (data.mesoSkips.some((s) => !mesoIds.has(s.mesoId) || !dayIds.has(s.dayId)))
      fail("Invalid skipped session");
    if (
      data.workouts.some(
        (w) => !has(gymIds, w.gymId) || !has(mesoIds, w.mesoId) || !has(dayIds, w.mesoDayId)
      )
    )
      fail("Workout refers to a missing gym or program");
    if (data.workouts.filter((w) => !w.endedAt).length > 1) fail("More than one open workout");
    if (data.workoutExercises.some((b) => !workoutIds.has(b.workoutId) || !has(slotIds, b.slotId)))
      fail("Exercise without workout");
    if (data.sets.some((s) => !blockIds.has(s.workoutExerciseId))) fail("Set without exercise");
    if ((data.aiNudges ?? []).some((n) => !workoutIds.has(n.workoutId)))
      fail("Nudge without workout");
    if (data.muscleFeedback.some((f) => !workoutIds.has(f.workoutId)))
      fail("Feedback without workout");
    if (data.mesocycles.filter((m) => m.status === "active").length > 1)
      fail("More than one active program");
    if (data.activeGym !== null && !gymIds.has(data.activeGym)) fail("Unknown active gym");
  });

export type Backup = z.infer<typeof schema>;

export function validateBackup(value: unknown): Backup {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new Error("This backup is invalid or uses an unsupported version. Nothing was restored.");
  return result.data;
}

export function parseBackup(json: string): Backup {
  if (json.length > MAX_BACKUP_TEXT) throw new Error("This backup exceeds the 20 MB data limit.");
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("This backup could not be read.");
  }
  return validateBackup(value);
}

export function createBackup(): Backup {
  const snapshot = db.transaction((tx) => {
    const links = tx.select().from(healthLinks).all();
    const importedWeights = new Map(
      links
        .filter((l) => l.origin === "health" && l.localKind === "weight")
        .map((l) => [l.localId, l.remoteId])
    );
    const savedWorkouts = new Map(
      links
        .filter(
          (l) => l.origin === "local" && l.localKind === "workout" && l.fingerprint !== "deleted"
        )
        .map((l) => [l.localId, l.remoteId])
    );
    const activeGym = Number(
      tx.select().from(preferences).where(eq(preferences.key, "activeGym")).get()?.value
    );
    const gymRows = tx.select().from(gyms).all();
    return {
      format: "lift-track-backup",
      version: 1,
      createdAt: new Date().toISOString(),
      data: {
        weights: tx
          .select()
          .from(weightEntries)
          .all()
          .map((row) => ({
            ...row,
            createdAt: row.createdAt?.toISOString() ?? null,
            updatedAt: row.updatedAt?.toISOString() ?? null,
            healthId: importedWeights.get(row.id),
          })),
        customExercises: tx.select().from(customExercises).all(),
        exerciseSettings: tx.select().from(exerciseSettings).all(),
        gyms: gymRows,
        mesocycles: tx.select().from(mesocycles).all(),
        mesoDays: tx.select().from(mesoDays).all(),
        mesoSlots: tx.select().from(mesoSlots).all(),
        mesoSkips: tx.select().from(mesoSkips).all(),
        workouts: tx
          .select()
          .from(workouts)
          .all()
          .map((row) => ({ ...row, healthId: savedWorkouts.get(row.id) })),
        workoutExercises: tx.select().from(workoutExercises).all(),
        sets: tx.select().from(sets).all(),
        muscleFeedback: tx.select().from(muscleFeedback).all(),
        aiNudges: tx.select().from(aiNudges).all(),
        activeGym: gymRows.some((g) => g.id === activeGym) ? activeGym : null,
      },
    };
  });
  // The file must pass the same checks a restore applies.
  return parseBackup(JSON.stringify(snapshot));
}

/** A transaction of the app's Drizzle database (or of one opened on the same schema). */
export type BackupTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const setPreference = (tx: BackupTransaction, key: string, value: string) =>
  tx
    .insert(preferences)
    .values({ key, value })
    .onConflictDoUpdate({ target: preferences.key, set: { value } })
    .run();

/**
 * Replaces every training record and body weight with the backup's, in one transaction: a
 * failure anywhere leaves the current records as they were. The caller holds the Health pause.
 */
export function restoreBackup(value: unknown, recoveryUri?: string) {
  const { data } = validateBackup(value);
  db.transaction((tx) => {
    // Children first; foreign keys are enforced.
    for (const table of [
      aiNudges,
      muscleFeedback,
      sets,
      workoutExercises,
      workouts,
      mesoSkips,
      mesoSlots,
      mesoDays,
      mesocycles,
      gyms,
      exerciseSettings,
      customExercises,
      weightEntries,
      healthLinks,
    ])
      tx.delete(table).run();
    writeBackupRows(tx, data);
    if (recoveryUri) setPreference(tx, "recoveryBackupUri", recoveryUri);
    // Health starts over: sync is off, and weights written from here get a fresh namespace.
    setPreference(tx, "healthSyncEnabled", "false");
    setPreference(tx, "healthSyncError", "");
    setPreference(tx, "lastSync", "");
    tx.delete(preferences).where(eq(preferences.key, "installation")).run();
    tx.delete(preferences).where(eq(preferences.key, "restTimer")).run();
    // A trip names a gym by id, and the restored gyms may not be the same ones.
    tx.delete(preferences).where(eq(preferences.key, "travel")).run();
  });
}

/**
 * Writes a validated backup's records into emptied tables with their original ids, parents
 * first, with the Health links a backup implies and its active gym. restoreBackup() runs it on
 * the app's database; the vault's import of these files runs it on its scratch copy.
 */
export function writeBackupRows(tx: BackupTransaction, data: Backup["data"]) {
  for (const { healthId, ...row } of data.weights) {
    tx.insert(weightEntries)
      .values({
        ...row,
        createdAt: row.createdAt ? new Date(row.createdAt) : null,
        updatedAt: row.updatedAt ? new Date(row.updatedAt) : null,
      })
      .run();
    if (healthId)
      tx.insert(healthLinks)
        .values({
          key: `health:weight:${healthId}`,
          localKind: "weight",
          localId: row.id,
          remoteId: healthId,
          fingerprint: `${row.weightKg}:${row.measuredAt}`,
          origin: "health",
        })
        .onConflictDoNothing()
        .run();
  }
  for (const row of data.customExercises) tx.insert(customExercises).values(row).run();
  for (const row of data.exerciseSettings) tx.insert(exerciseSettings).values(row).run();
  for (const row of data.gyms) tx.insert(gyms).values(row).run();
  for (const row of data.mesocycles) tx.insert(mesocycles).values(row).run();
  for (const row of data.mesoDays) tx.insert(mesoDays).values(row).run();
  for (const row of data.mesoSlots) tx.insert(mesoSlots).values(row).run();
  for (const row of data.mesoSkips) tx.insert(mesoSkips).values(row).run();
  for (const { healthId, ...row } of data.workouts) {
    tx.insert(workouts).values(row).run();
    // Keeps the Health copy: sync matches it by workout and won't save it again. The key is not
    // the saved workout's sync id; the link reaches that workout by its remote id only.
    if (healthId && row.endedAt)
      tx.insert(healthLinks)
        .values({
          key: `restored:workout:${row.id}`,
          localKind: "workout",
          localId: row.id,
          remoteId: healthId,
          fingerprint: `${row.startedAt}|${row.endedAt}|${row.name}`,
          origin: "local",
        })
        .run();
  }
  for (const row of data.workoutExercises)
    tx.insert(workoutExercises)
      .values(row as typeof workoutExercises.$inferInsert)
      .run();
  for (const row of data.sets) tx.insert(sets).values(row).run();
  for (const row of data.muscleFeedback) tx.insert(muscleFeedback).values(row).run();
  for (const row of data.aiNudges ?? []) tx.insert(aiNudges).values(row).run();
  if (data.activeGym !== null) setPreference(tx, "activeGym", String(data.activeGym));
  else tx.delete(preferences).where(eq(preferences.key, "activeGym")).run();
}

/** Record counts for the restore preview. */
export function backupSummary(backup: Backup) {
  const done = backup.data.workouts.filter((w) => w.endedAt);
  return {
    workouts: done.length,
    sets: backup.data.sets.filter((s) => s.completedAt).length,
    programs: backup.data.mesocycles.length,
    weights: backup.data.weights.length,
    customExercises: backup.data.customExercises.length,
    first: done.map((w) => w.startedAt).sort()[0] ?? null,
  };
}
