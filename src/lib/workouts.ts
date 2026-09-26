import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, max } from "drizzle-orm";
import {
  db,
  gyms,
  preferences,
  sets,
  weightEntries,
  workoutExercises,
  workouts,
  type Gym,
  type SetKind,
  type Workout,
  type WorkoutExercise,
  type WorkoutSet,
} from "@/db";
import { defaultGym } from "./loads";
import type { Units } from "./metrics";
import { countsAsWork, e1rm } from "./strength";

/* Every write here is one small transaction, so a workout survives the app being killed
   between any two taps. Functions that remove data return an undo. */

const now = () => new Date().toISOString();
const touch = (workoutId: number) =>
  db.update(workouts).set({ updatedAt: Date.now() }).where(eq(workouts.id, workoutId)).run();

// ——— Gyms ———

export function activeGym(units: Units): Gym {
  const chosen = Number(
    db.select().from(preferences).where(eq(preferences.key, "activeGym")).get()?.value
  );
  const all = db.select().from(gyms).where(eq(gyms.archived, false)).orderBy(asc(gyms.id)).all();
  const found = all.find((g) => g.id === chosen) ?? all[0];
  if (found) return found;
  return db
    .insert(gyms)
    .values(defaultGym(units === "metric" ? "kg" : "lb"))
    .returning()
    .get();
}

export const gymById = (id: number) => db.select().from(gyms).where(eq(gyms.id, id)).get();

export function updateGym(id: number, patch: Partial<Omit<Gym, "id">>) {
  db.update(gyms).set(patch).where(eq(gyms.id, id)).run();
}

// ——— Reading ———

export type SetRow = WorkoutSet;
export type ExerciseBlock = WorkoutExercise & { sets: SetRow[] };
export type WorkoutDetail = Workout & { exercises: ExerciseBlock[] };

export function activeWorkout(): Workout | undefined {
  return db
    .select()
    .from(workouts)
    .where(isNull(workouts.endedAt))
    .orderBy(desc(workouts.startedAt))
    .limit(1)
    .get();
}

export function workoutDetail(id: number): WorkoutDetail | undefined {
  const workout = db.select().from(workouts).where(eq(workouts.id, id)).get();
  if (!workout) return undefined;
  const blocks = db
    .select()
    .from(workoutExercises)
    .where(eq(workoutExercises.workoutId, id))
    .orderBy(asc(workoutExercises.position))
    .all();
  const rows = blocks.length
    ? db
        .select()
        .from(sets)
        .where(
          inArray(
            sets.workoutExerciseId,
            blocks.map((b) => b.id)
          )
        )
        .orderBy(asc(sets.position))
        .all()
    : [];
  return {
    ...workout,
    exercises: blocks.map((block) => ({
      ...block,
      sets: rows.filter((row) => row.workoutExerciseId === block.id),
    })),
  };
}

export type WorkoutSummary = Workout & {
  exerciseIds: string[];
  setCount: number;
  volumeKg: number;
};

/** Finished workouts, newest first, with enough to list them. */
export function finishedWorkouts(limit = 50, before?: string): WorkoutSummary[] {
  const list = db
    .select()
    .from(workouts)
    .where(
      before
        ? and(isNotNull(workouts.endedAt), lt(workouts.startedAt, before))
        : isNotNull(workouts.endedAt)
    )
    .orderBy(desc(workouts.startedAt))
    .limit(limit)
    .all();
  if (!list.length) return [];
  const blocks = db
    .select()
    .from(workoutExercises)
    .where(
      inArray(
        workoutExercises.workoutId,
        list.map((w) => w.id)
      )
    )
    .orderBy(asc(workoutExercises.position))
    .all();
  const rows = blocks.length
    ? db
        .select()
        .from(sets)
        .where(
          inArray(
            sets.workoutExerciseId,
            blocks.map((b) => b.id)
          )
        )
        .all()
    : [];
  return list.map((workout) => {
    const mine = blocks.filter((b) => b.workoutId === workout.id);
    const ids = new Set(mine.map((b) => b.id));
    const work = rows.filter(
      (r) => ids.has(r.workoutExerciseId) && r.completedAt && countsAsWork(r.kind)
    );
    return {
      ...workout,
      exerciseIds: mine.map((b) => b.exerciseId),
      setCount: work.length,
      volumeKg: work.reduce((sum, r) => sum + (r.weightKg ?? 0) * (r.reps ?? 0), 0),
    };
  });
}

export type Performance = {
  workoutId: number;
  startedAt: string;
  block: WorkoutExercise;
  sets: SetRow[];
};

/** Completed sets of an exercise, one entry per workout, newest first. */
export function exerciseHistory(
  exerciseId: string,
  options: { limit?: number; excludeWorkout?: number } = {}
): Performance[] {
  const blocks = db
    .select({ block: workoutExercises, startedAt: workouts.startedAt })
    .from(workoutExercises)
    .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
    .where(and(eq(workoutExercises.exerciseId, exerciseId), isNotNull(workouts.endedAt)))
    .orderBy(desc(workouts.startedAt), desc(workoutExercises.position))
    .limit((options.limit ?? 20) + 1)
    .all()
    .filter((b) => b.block.workoutId !== options.excludeWorkout)
    .slice(0, options.limit ?? 20);
  if (!blocks.length) return [];
  const rows = db
    .select()
    .from(sets)
    .where(
      and(
        inArray(
          sets.workoutExerciseId,
          blocks.map((b) => b.block.id)
        ),
        isNotNull(sets.completedAt)
      )
    )
    .orderBy(asc(sets.position))
    .all();
  return blocks
    .map(({ block, startedAt }) => ({
      workoutId: block.workoutId,
      startedAt,
      block,
      sets: rows.filter((r) => r.workoutExerciseId === block.id),
    }))
    .filter((p) => p.sets.length);
}

export const lastPerformance = (exerciseId: string, excludeWorkout?: number) =>
  exerciseHistory(exerciseId, { limit: 1, excludeWorkout })[0];

/** Best estimated 1RM in finished workouts, optionally only before a date. */
export function bestE1rm(exerciseId: string, before?: string): number {
  let best = 0;
  for (const p of exerciseHistory(exerciseId, { limit: 500 })) {
    if (before && p.startedAt >= before) continue;
    for (const s of p.sets)
      if (countsAsWork(s.kind)) best = Math.max(best, e1rm(s.weightKg ?? 0, s.reps ?? 0, s.rir));
  }
  return best;
}

// ——— Starting and finishing ———

function latestBodyWeight() {
  return (
    db.select().from(weightEntries).orderBy(desc(weightEntries.measuredAt)).limit(1).get()
      ?.weightKg ?? null
  );
}

/** Starts a workout, or returns the one already open: there is only ever one. */
export function startWorkout(options: { gymId?: number; name?: string; from?: number } = {}) {
  const open = activeWorkout();
  if (open) return open.id;
  return db.transaction((tx) => {
    const id = tx
      .insert(workouts)
      .values({
        name: options.name ?? "",
        startedAt: now(),
        gymId: options.gymId ?? null,
        bodyWeightKg: latestBodyWeight(),
        updatedAt: Date.now(),
      })
      .returning()
      .get().id;
    if (options.from) {
      const template = workoutDetail(options.from);
      if (template) {
        tx.update(workouts)
          .set({ name: options.name ?? template.name })
          .where(eq(workouts.id, id))
          .run();
        template.exercises.forEach((block, position) => {
          const count = block.sets.filter((s) => s.kind === "working").length || 3;
          insertBlock(id, block.exerciseId, position, [block.repMin, block.repMax], count, {
            supersetGroup: block.supersetGroup,
          });
        });
      }
    }
    return id;
  });
}

/**
 * Adds an exercise with sets prefilled from its last performance: the same loads and reps
 * as targets. With no history the sets start empty with the slot's rep range.
 */
function insertBlock(
  workoutId: number,
  exerciseId: string,
  position: number,
  reps: readonly [number, number],
  count?: number,
  extra: { supersetGroup?: number | null } = {}
) {
  const block = db
    .insert(workoutExercises)
    .values({
      workoutId,
      exerciseId,
      position,
      repMin: reps[0],
      repMax: reps[1],
      supersetGroup: extra.supersetGroup ?? null,
    })
    .returning()
    .get();
  const last = lastPerformance(exerciseId, workoutId);
  const previous = last?.sets.filter((s) => s.kind === "working") ?? [];
  // Last time's set count unless the caller asks for a number (repeating a workout).
  const total = count ?? (Math.min(previous.length, 10) || 3);
  for (let i = 0; i < total; i++) {
    const from = previous[Math.min(i, previous.length - 1)];
    db.insert(sets)
      .values({
        workoutExerciseId: block.id,
        position: i,
        kind: "working",
        side: null,
        targetWeightKg: from?.weightKg ?? null,
        targetReps: from?.reps ?? null,
      })
      .run();
  }
  return block.id;
}

export function addExercise(
  workoutId: number,
  exercise: { id: string; reps: readonly [number, number] },
  count?: number
) {
  return db.transaction(() => {
    const position =
      (db
        .select({ value: max(workoutExercises.position) })
        .from(workoutExercises)
        .where(eq(workoutExercises.workoutId, workoutId))
        .get()?.value ?? -1) + 1;
    const id = insertBlock(workoutId, exercise.id, position, exercise.reps, count);
    touch(workoutId);
    return id;
  });
}

/** Ends the workout. Unchecked sets and exercises with nothing done are dropped. */
export function finishWorkout(workoutId: number) {
  return db.transaction((tx) => {
    const detail = workoutDetail(workoutId);
    if (!detail) return null;
    for (const block of detail.exercises) {
      const open = block.sets.filter((s) => !s.completedAt).map((s) => s.id);
      if (open.length) tx.delete(sets).where(inArray(sets.id, open)).run();
      if (open.length === block.sets.length)
        tx.delete(workoutExercises).where(eq(workoutExercises.id, block.id)).run();
    }
    const done = detail.exercises.some((b) => b.sets.some((s) => s.completedAt));
    if (!done) {
      tx.delete(workouts).where(eq(workouts.id, workoutId)).run();
      return null;
    }
    tx.update(workouts)
      .set({ endedAt: now(), updatedAt: Date.now() })
      .where(eq(workouts.id, workoutId))
      .run();
    return workoutId;
  });
}

export function discardWorkout(workoutId: number) {
  db.delete(workouts).where(eq(workouts.id, workoutId)).run();
}

/** Reopens a finished workout for editing; used from History. */
export function renameWorkout(workoutId: number, name: string) {
  db.update(workouts)
    .set({ name: name.trim(), updatedAt: Date.now() })
    .where(eq(workouts.id, workoutId))
    .run();
}

// ——— Sets ———

function blockOf(setId: number) {
  return db
    .select({ block: workoutExercises })
    .from(sets)
    .innerJoin(workoutExercises, eq(workoutExercises.id, sets.workoutExerciseId))
    .where(eq(sets.id, setId))
    .get()?.block;
}

export function updateSet(
  setId: number,
  patch: Partial<Pick<SetRow, "weightKg" | "reps" | "rir" | "kind" | "side">>
) {
  const block = blockOf(setId);
  db.update(sets).set(patch).where(eq(sets.id, setId)).run();
  if (block) touch(block.workoutId);
}

/**
 * Checks a set off. Values not typed are taken from its targets, so a set done as
 * prescribed is one tap. Returns false when there is nothing to record yet.
 */
export function completeSet(setId: number, done = true): boolean {
  const row = db.select().from(sets).where(eq(sets.id, setId)).get();
  if (!row) return false;
  if (!done) {
    db.update(sets).set({ completedAt: null }).where(eq(sets.id, setId)).run();
    return true;
  }
  const reps = row.reps ?? row.targetReps;
  if (reps === null || reps === undefined) return false;
  db.update(sets)
    .set({
      reps,
      weightKg: row.weightKg ?? row.targetWeightKg ?? 0,
      rir: row.rir ?? null,
      completedAt: now(),
    })
    .where(eq(sets.id, setId))
    .run();
  const block = blockOf(setId);
  if (block) {
    // The next open set starts from what was just done, not the old target.
    const next = db
      .select()
      .from(sets)
      .where(
        and(
          eq(sets.workoutExerciseId, row.workoutExerciseId),
          isNull(sets.completedAt),
          eq(sets.kind, row.kind)
        )
      )
      .orderBy(asc(sets.position))
      .limit(1)
      .get();
    if (next && next.targetWeightKg === null && next.weightKg === null)
      db.update(sets)
        .set({ targetWeightKg: row.weightKg ?? row.targetWeightKg ?? 0, targetReps: reps })
        .where(eq(sets.id, next.id))
        .run();
    touch(block.workoutId);
  }
  return true;
}

export function addSet(workoutExerciseId: number, kind: SetKind = "working") {
  const existing = db
    .select()
    .from(sets)
    .where(eq(sets.workoutExerciseId, workoutExerciseId))
    .orderBy(asc(sets.position))
    .all();
  const like = [...existing].reverse().find((s) => s.kind === kind) ?? existing.at(-1);
  const position =
    kind === "warmup"
      ? // Warm-ups go before the first working set.
        Math.min(0, ...existing.map((s) => s.position)) - 1
      : Math.max(-1, ...existing.map((s) => s.position)) + 1;
  const id = db
    .insert(sets)
    .values({
      workoutExerciseId,
      position,
      kind,
      side: like?.side ?? null,
      targetWeightKg: kind === "warmup" ? null : (like?.weightKg ?? like?.targetWeightKg ?? null),
      targetReps: kind === "warmup" ? null : (like?.reps ?? like?.targetReps ?? null),
    })
    .returning()
    .get().id;
  const block = db
    .select()
    .from(workoutExercises)
    .where(eq(workoutExercises.id, workoutExerciseId))
    .get();
  if (block) touch(block.workoutId);
  return id;
}

export function deleteSet(setId: number): () => void {
  const row = db.select().from(sets).where(eq(sets.id, setId)).get();
  db.delete(sets).where(eq(sets.id, setId)).run();
  return () => {
    if (row) db.insert(sets).values(row).onConflictDoNothing().run();
  };
}

// ——— Exercises in a workout ———

export function removeExercise(workoutExerciseId: number): () => void {
  const block = db
    .select()
    .from(workoutExercises)
    .where(eq(workoutExercises.id, workoutExerciseId))
    .get();
  const rows = db.select().from(sets).where(eq(sets.workoutExerciseId, workoutExerciseId)).all();
  db.delete(workoutExercises).where(eq(workoutExercises.id, workoutExerciseId)).run();
  return () => {
    if (!block) return;
    db.transaction((tx) => {
      tx.insert(workoutExercises).values(block).onConflictDoNothing().run();
      for (const row of rows) tx.insert(sets).values(row).onConflictDoNothing().run();
    });
  };
}

/** Swaps an exercise. Done sets stay with the old one; open sets take the new one's history. */
export function replaceExercise(
  workoutExerciseId: number,
  exercise: { id: string; reps: readonly [number, number] }
) {
  return db.transaction((tx) => {
    const block = tx
      .select()
      .from(workoutExercises)
      .where(eq(workoutExercises.id, workoutExerciseId))
      .get();
    if (!block) return null;
    const rows = tx.select().from(sets).where(eq(sets.workoutExerciseId, block.id)).all();
    const done = rows.filter((r) => r.completedAt);
    const open = rows.filter((r) => !r.completedAt && r.kind !== "warmup");
    if (!done.length) {
      tx.delete(workoutExercises).where(eq(workoutExercises.id, block.id)).run();
      return insertBlock(
        block.workoutId,
        exercise.id,
        block.position,
        exercise.reps,
        open.length || undefined,
        {
          supersetGroup: block.supersetGroup,
        }
      );
    }
    // Keep the finished part in place and add the replacement right after it.
    for (const r of rows.filter((r) => !r.completedAt))
      tx.delete(sets).where(eq(sets.id, r.id)).run();
    shiftAfter(block.workoutId, block.position);
    return insertBlock(
      block.workoutId,
      exercise.id,
      block.position + 1,
      exercise.reps,
      open.length || undefined
    );
  });
}

function shiftAfter(workoutId: number, position: number) {
  const later = db
    .select()
    .from(workoutExercises)
    .where(eq(workoutExercises.workoutId, workoutId))
    .all()
    .filter((b) => b.position > position);
  for (const b of later)
    db.update(workoutExercises)
      .set({ position: b.position + 1 })
      .where(eq(workoutExercises.id, b.id))
      .run();
}

export function moveExercise(workoutExerciseId: number, direction: -1 | 1) {
  db.transaction((tx) => {
    const block = tx
      .select()
      .from(workoutExercises)
      .where(eq(workoutExercises.id, workoutExerciseId))
      .get();
    if (!block) return;
    const siblings = tx
      .select()
      .from(workoutExercises)
      .where(eq(workoutExercises.workoutId, block.workoutId))
      .orderBy(asc(workoutExercises.position))
      .all();
    const index = siblings.findIndex((b) => b.id === block.id);
    const other = siblings[index + direction];
    if (!other) return;
    // Renumber so positions stay dense after swaps.
    const order = siblings.map((b) => b.id);
    [order[index], order[index + direction]] = [order[index + direction], order[index]];
    order.forEach((id, position) =>
      tx.update(workoutExercises).set({ position }).where(eq(workoutExercises.id, id)).run()
    );
  });
}

/** Pairs an exercise with the next one as a superset, or splits the pair. */
export function toggleSuperset(workoutExerciseId: number) {
  db.transaction((tx) => {
    const block = tx
      .select()
      .from(workoutExercises)
      .where(eq(workoutExercises.id, workoutExerciseId))
      .get();
    if (!block) return;
    const siblings = tx
      .select()
      .from(workoutExercises)
      .where(eq(workoutExercises.workoutId, block.workoutId))
      .orderBy(asc(workoutExercises.position))
      .all();
    if (block.supersetGroup !== null) {
      const group = siblings.filter((b) => b.supersetGroup === block.supersetGroup);
      const rest = group.filter((b) => b.id !== block.id);
      tx.update(workoutExercises)
        .set({ supersetGroup: null })
        .where(eq(workoutExercises.id, block.id))
        .run();
      // A group of one isn't a superset.
      if (rest.length === 1)
        tx.update(workoutExercises)
          .set({ supersetGroup: null })
          .where(eq(workoutExercises.id, rest[0].id))
          .run();
      return;
    }
    const next = siblings[siblings.findIndex((b) => b.id === block.id) + 1];
    if (!next) return;
    const group =
      next.supersetGroup ?? Math.max(0, ...siblings.map((b) => b.supersetGroup ?? 0)) + 1;
    for (const id of [block.id, next.id])
      tx.update(workoutExercises)
        .set({ supersetGroup: group })
        .where(eq(workoutExercises.id, id))
        .run();
  });
}

export function setExerciseNote(workoutExerciseId: number, note: string) {
  db.update(workoutExercises).set({ note }).where(eq(workoutExercises.id, workoutExerciseId)).run();
}

/** Full detail of finished workouts that started in a range. */
export function workoutsBetween(from: string, to: string): WorkoutDetail[] {
  return db
    .select({ id: workouts.id })
    .from(workouts)
    .where(
      and(isNotNull(workouts.endedAt), gte(workouts.startedAt, from), lt(workouts.startedAt, to))
    )
    .orderBy(asc(workouts.startedAt))
    .all()
    .flatMap((w) => workoutDetail(w.id) ?? []);
}

/** Drops unchecked sets and empty exercises after editing a finished workout. */
export function tidyWorkout(workoutId: number) {
  const detail = workoutDetail(workoutId);
  if (!detail) return;
  db.transaction((tx) => {
    for (const block of detail.exercises) {
      const open = block.sets.filter((s) => !s.completedAt).map((s) => s.id);
      if (open.length) tx.delete(sets).where(inArray(sets.id, open)).run();
      if (open.length === block.sets.length)
        tx.delete(workoutExercises).where(eq(workoutExercises.id, block.id)).run();
    }
    tx.update(workouts).set({ updatedAt: Date.now() }).where(eq(workouts.id, workoutId)).run();
  });
}

/** How often and how recently each exercise was done, for ranking search results. */
export function exerciseUsage(): Map<string, { count: number; last: string }> {
  const rows = db
    .select({ exerciseId: workoutExercises.exerciseId, startedAt: workouts.startedAt })
    .from(workoutExercises)
    .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
    .all();
  const usage = new Map<string, { count: number; last: string }>();
  for (const row of rows) {
    const entry = usage.get(row.exerciseId);
    if (!entry) usage.set(row.exerciseId, { count: 1, last: row.startedAt });
    else {
      entry.count++;
      if (row.startedAt > entry.last) entry.last = row.startedAt;
    }
  }
  return usage;
}

export type PersonalRecord = {
  exerciseId: string;
  kind: "e1rm" | "weight";
  valueKg: number;
  previousKg: number;
};

/** Personal records set in a workout: best estimated 1RM and heaviest load, per exercise. */
export function workoutRecords(detail: WorkoutDetail): PersonalRecord[] {
  const records: PersonalRecord[] = [];
  const seen = new Set<string>();
  for (const block of detail.exercises) {
    if (seen.has(block.exerciseId)) continue;
    seen.add(block.exerciseId);
    const mine = detail.exercises
      .filter((b) => b.exerciseId === block.exerciseId)
      .flatMap((b) => b.sets)
      .filter((s) => s.completedAt && countsAsWork(s.kind) && (s.weightKg ?? 0) > 0);
    if (!mine.length) continue;
    const history = exerciseHistory(block.exerciseId, { limit: 500 }).filter(
      (p) => p.startedAt < detail.startedAt
    );
    // A first session sets a baseline, not a record.
    if (!history.length) continue;
    const before = history.flatMap((p) => p.sets).filter((s) => countsAsWork(s.kind));
    const best = (list: SetRow[], f: (s: SetRow) => number) => Math.max(0, ...list.map(f));
    const oneRm = (s: SetRow) => e1rm(s.weightKg ?? 0, s.reps ?? 0, s.rir);
    const heaviest = (s: SetRow) => s.weightKg ?? 0;
    const now1 = best(mine, oneRm);
    const was1 = best(before, oneRm);
    if (now1 > was1 + 0.01)
      records.push({ exerciseId: block.exerciseId, kind: "e1rm", valueKg: now1, previousKg: was1 });
    const nowW = best(mine, heaviest);
    const wasW = best(before, heaviest);
    if (nowW > wasW + 0.01)
      records.push({
        exerciseId: block.exerciseId,
        kind: "weight",
        valueKg: nowW,
        previousKg: wasW,
      });
  }
  return records;
}
