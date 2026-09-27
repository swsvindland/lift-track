import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  db,
  mesoDays,
  mesoSkips,
  mesoSlots,
  mesocycles,
  muscleFeedback,
  sets,
  workoutExercises,
  workouts,
  type FeedbackRating,
  type Gym,
  type MesoDay,
  type MesoSlot,
  type ExerciseSetting,
  type Mesocycle,
} from "@/db";
import { standIns, type Exercise } from "./exercises";
import type { Muscle } from "./exercises/types";
import type { ProgramDraft } from "./program-builder";
import { DELOAD_RIR, METHOD, prescribe, type PastSet } from "./progression";
import { countsAsWork } from "./strength";
import {
  activeWorkout,
  discardWorkout,
  replaceExercise,
  workoutDetail,
  type WorkoutDetail,
} from "./workouts";

/* Programs (mesocycles) and the sessions they generate. A session's prescription is computed
   when it starts, from what was actually done before, and stored on its sets. */

const now = () => new Date().toISOString();

export type ProgramDetail = Mesocycle & { days: (MesoDay & { slots: MesoSlot[] })[] };

export function activeMeso(): Mesocycle | undefined {
  return db
    .select()
    .from(mesocycles)
    .where(eq(mesocycles.status, "active"))
    .orderBy(desc(mesocycles.id))
    .limit(1)
    .get();
}

export function lastMeso(): Mesocycle | undefined {
  return db.select().from(mesocycles).orderBy(desc(mesocycles.id)).limit(1).get();
}

export function programDetail(id: number): ProgramDetail | undefined {
  const meso = db.select().from(mesocycles).where(eq(mesocycles.id, id)).get();
  if (!meso) return undefined;
  const days = db
    .select()
    .from(mesoDays)
    .where(eq(mesoDays.mesoId, id))
    .orderBy(asc(mesoDays.position))
    .all();
  const slots = days.length
    ? db
        .select()
        .from(mesoSlots)
        .where(
          inArray(
            mesoSlots.dayId,
            days.map((d) => d.id)
          )
        )
        .orderBy(asc(mesoSlots.position))
        .all()
    : [];
  return {
    ...meso,
    days: days.map((d) => ({ ...d, slots: slots.filter((s) => s.dayId === d.id) })),
  };
}

/** Weeks including the deload. */
export const totalWeeks = (meso: Pick<Mesocycle, "rir" | "deload">) =>
  meso.rir.length + (meso.deload ? 1 : 0);
export const isDeloadWeek = (meso: Pick<Mesocycle, "rir" | "deload">, week: number) =>
  meso.deload && week === meso.rir.length;
export const weekRir = (meso: Pick<Mesocycle, "rir" | "deload">, week: number) =>
  isDeloadWeek(meso, week) ? DELOAD_RIR : meso.rir[Math.min(week, meso.rir.length - 1)];

/** Saves a draft as the active program, finishing any other. */
export function startProgram(draft: ProgramDraft, options: { deload?: boolean } = {}) {
  return db.transaction((tx) => {
    tx.update(mesocycles)
      .set({ status: "finished", endedAt: now() })
      .where(eq(mesocycles.status, "active"))
      .run();
    const meso = tx
      .insert(mesocycles)
      .values({
        name: draft.name,
        rir: draft.rir,
        deload: options.deload ?? true,
        deprioritized: draft.deprioritized ?? [],
        gymId: draft.gymId ?? null,
        method: METHOD,
        status: "active",
        startedAt: now(),
      })
      .returning()
      .get();
    draft.days.forEach((day, position) => {
      const dayId = tx
        .insert(mesoDays)
        .values({ mesoId: meso.id, position, name: day.name })
        .returning()
        .get().id;
      day.slots.forEach((slot, index) =>
        tx
          .insert(mesoSlots)
          .values({
            dayId,
            position: index,
            exerciseId: slot.exerciseId,
            sets: slot.sets,
            repMin: slot.reps[0],
            repMax: slot.reps[1],
          })
          .run()
      );
    });
    return meso.id;
  });
}

/** The program as a draft, to edit or to run again. */
export function draftFrom(detail: ProgramDetail): ProgramDraft {
  return {
    name: detail.name,
    rir: detail.rir,
    deprioritized: detail.deprioritized,
    gymId: detail.gymId,
    days: detail.days.map((d) => ({
      name: d.name,
      slots: d.slots.map((s) => ({
        exerciseId: s.exerciseId,
        sets: s.sets,
        reps: [s.repMin, s.repMax] as [number, number],
      })),
    })),
  };
}

/**
 * Replaces the running program's days and slots. Past sessions keep their exercises; slots that
 * survive (same day and exercise) keep their ids, so progression history carries over.
 */
export function updateProgram(id: number, draft: ProgramDraft) {
  db.transaction((tx) => {
    tx.update(mesocycles)
      .set({
        name: draft.name,
        rir: draft.rir,
        ...(draft.gymId !== undefined && { gymId: draft.gymId }),
      })
      .where(eq(mesocycles.id, id))
      .run();
    const existing = programDetail(id);
    if (!existing) return;
    draft.days.forEach((day, position) => {
      const old = existing.days[position];
      const dayId = old
        ? (tx
            .update(mesoDays)
            .set({ name: day.name, position })
            .where(eq(mesoDays.id, old.id))
            .run(),
          old.id)
        : tx.insert(mesoDays).values({ mesoId: id, position, name: day.name }).returning().get().id;
      const keep = new Set<number>();
      day.slots.forEach((slot, index) => {
        const match = old?.slots.find((s) => s.exerciseId === slot.exerciseId && !keep.has(s.id));
        const values = {
          dayId,
          position: index,
          exerciseId: slot.exerciseId,
          sets: slot.sets,
          repMin: slot.reps[0],
          repMax: slot.reps[1],
        };
        if (match) {
          keep.add(match.id);
          tx.update(mesoSlots).set(values).where(eq(mesoSlots.id, match.id)).run();
        } else keep.add(tx.insert(mesoSlots).values(values).returning().get().id);
      });
      for (const s of old?.slots ?? [])
        if (!keep.has(s.id)) tx.delete(mesoSlots).where(eq(mesoSlots.id, s.id)).run();
    });
    for (const old of existing.days.slice(draft.days.length))
      tx.delete(mesoDays).where(eq(mesoDays.id, old.id)).run();
  });
}

export function endProgram(id: number) {
  db.update(mesocycles)
    .set({ status: "finished", endedAt: now() })
    .where(eq(mesocycles.id, id))
    .run();
}

// ——— Progress through the weeks ———

export type SessionState = "done" | "skipped" | "open" | "next" | "upcoming";
export type SessionCell = { week: number; dayId: number; state: SessionState; workoutId?: number };

function mesoWorkouts(mesoId: number) {
  return db.select().from(workouts).where(eq(workouts.mesoId, mesoId)).all();
}

/** Every week × day of the program with what happened to it. The first open slot is next. */
export function programProgress(detail: ProgramDetail): SessionCell[][] {
  const done = mesoWorkouts(detail.id);
  const skips = db.select().from(mesoSkips).where(eq(mesoSkips.mesoId, detail.id)).all();
  let foundNext = false;
  return Array.from({ length: totalWeeks(detail) }, (_, week) =>
    detail.days.map((day) => {
      const workout = done.find((w) => w.mesoWeek === week && w.mesoDayId === day.id);
      if (workout)
        return {
          week,
          dayId: day.id,
          state: workout.endedAt ? "done" : "open",
          workoutId: workout.id,
        } as SessionCell;
      if (skips.some((s) => s.week === week && s.dayId === day.id))
        return { week, dayId: day.id, state: "skipped" } as SessionCell;
      const state: SessionState = foundNext ? "upcoming" : "next";
      foundNext = true;
      return { week, dayId: day.id, state };
    })
  );
}

export function nextSession(detail: ProgramDetail) {
  return programProgress(detail)
    .flat()
    .find((c) => c.state === "next" || c.state === "open");
}

export function skipSession(mesoId: number, week: number, dayId: number) {
  db.insert(mesoSkips).values({ mesoId, week, dayId }).run();
}

export function unskipSession(mesoId: number, week: number, dayId: number) {
  db.delete(mesoSkips)
    .where(and(eq(mesoSkips.mesoId, mesoId), eq(mesoSkips.week, week), eq(mesoSkips.dayId, dayId)))
    .run();
}

/** The program is over once every session is done or skipped. */
export const programComplete = (detail: ProgramDetail) => !nextSession(detail);

// ——— Volume from feedback and performance ———

export const ratingDelta: Record<FeedbackRating, number> = {
  easy: 2,
  good: 1,
  hard: 0,
  tooMuch: -1,
  pain: 0,
};

/** Sets for one muscle in one session, at most, by experience of the plan's starting volume. */
const MAX_SLOT_SETS = 6;
const MAX_MUSCLE_SESSION_SETS = 10;

const primary = (exercise: Exercise) =>
  (Object.keys(exercise.muscles) as Muscle[]).filter((m) => exercise.muscles[m] === 1);

/**
 * How a muscle's sets should change on a day, from last week's same session. Feedback decides
 * when given; otherwise hitting the prescribed reps adds a set, missing by two or more on most
 * sets takes one away, anything else holds. A drop in performance caps good feedback at hold.
 */
export function muscleDelta(
  previous: WorkoutDetail,
  muscle: Muscle,
  byId: (id: string) => Exercise,
  feedback: FeedbackRating | undefined
): number {
  const blocks = previous.exercises.filter((b) => byId(b.exerciseId).muscles[muscle] === 1);
  const work = blocks.flatMap((b) => b.sets).filter((s) => s.completedAt && countsAsWork(s.kind));
  const scored = work.filter((s) => s.targetReps !== null);
  const missed = scored.filter((s) => (s.reps ?? 0) <= (s.targetReps ?? 0) - 2).length;
  const met = scored.length > 0 && scored.every((s) => (s.reps ?? 0) >= (s.targetReps ?? 0));
  const struggling = scored.length > 0 && missed * 2 > scored.length;
  if (feedback) {
    const delta = ratingDelta[feedback];
    return struggling ? Math.min(0, delta) : delta;
  }
  if (struggling) return -1;
  return met ? 1 : 0;
}

/** Working sets a slot had in a past session, or the plan's starting count. */
function setsIn(previous: WorkoutDetail | undefined, slot: MesoSlot) {
  const block = previous?.exercises.find((b) => b.slotId === slot.id);
  if (!block) return slot.sets;
  const done = block.sets.filter((s) => s.kind === "working" && s.completedAt).length;
  const planned = block.sets.filter((s) => s.kind === "working").length;
  return Math.max(1, done || planned || slot.sets);
}

export type SlotPlan = { slot: MesoSlot; sets: number; delta: number };

/**
 * Sets for each slot of a day in a week. Week one uses the plan. Later weeks start from last
 * week's same session and move each muscle by its delta, added to the slot with the fewest sets
 * that trains it and taken from the one with the most. A muscle brought down never gains sets.
 * The deload halves last week's sets.
 */
export function planDay(
  meso: Pick<Mesocycle, "rir" | "deload" | "deprioritized">,
  day: MesoDay & { slots: MesoSlot[] },
  week: number,
  previous: WorkoutDetail | undefined,
  feedback: Partial<Record<Muscle, FeedbackRating>>,
  byId: (id: string) => Exercise
): SlotPlan[] {
  const plans = day.slots.map((slot) => ({
    slot,
    sets: setsIn(week ? previous : undefined, slot),
    delta: 0,
  }));
  if (week === 0 || !previous) return plans;
  if (isDeloadWeek(meso, week))
    return plans.map((p) => ({ ...p, sets: Math.max(1, Math.ceil(p.sets / 2)), delta: 0 }));
  const muscles = [...new Set(day.slots.flatMap((s) => primary(byId(s.exerciseId))))];
  for (const muscle of muscles) {
    let delta = muscleDelta(previous, muscle, byId, feedback[muscle]);
    if (meso.deprioritized.includes(muscle)) delta = Math.min(0, delta);
    const training = plans.filter((p) => byId(p.slot.exerciseId).muscles[muscle] === 1);
    const total = () => training.reduce((sum, p) => sum + p.sets, 0);
    while (delta > 0 && total() < MAX_MUSCLE_SESSION_SETS) {
      const target = training
        .filter((p) => p.sets < MAX_SLOT_SETS)
        .sort((a, b) => a.sets - b.sets)[0];
      if (!target) break;
      target.sets++;
      target.delta++;
      delta--;
    }
    while (delta < 0) {
      const target = training.filter((p) => p.sets > 1).sort((a, b) => b.sets - a.sets)[0];
      if (!target) break;
      target.sets--;
      target.delta--;
      delta++;
    }
  }
  return plans;
}

// ——— Starting a session ———

/** The last finished session of the same program day before a week, with its feedback. */
function previousSession(mesoId: number, dayId: number, week: number) {
  const list = db
    .select()
    .from(workouts)
    .where(
      and(eq(workouts.mesoId, mesoId), eq(workouts.mesoDayId, dayId), isNotNull(workouts.endedAt))
    )
    .orderBy(desc(workouts.mesoWeek))
    .all()
    .filter((w) => (w.mesoWeek ?? 0) < week);
  const found = list[0];
  if (!found) return { previous: undefined, feedback: {} };
  const feedback = Object.fromEntries(
    db
      .select()
      .from(muscleFeedback)
      .where(eq(muscleFeedback.workoutId, found.id))
      .all()
      .map((f) => [f.muscle, f.rating])
  ) as Partial<Record<Muscle, FeedbackRating>>;
  return { previous: workoutDetail(found.id), feedback };
}

/**
 * Completed working sets from the last non-deload session that did an exercise. Sessions from
 * the same side of a trip come first: away, the hotel's dumbbells set the pace; back home, the
 * loads from before you left do, so a lighter week away doesn't pull them down.
 */
export function lastComparable(
  exerciseId: string,
  excludeWorkout?: number,
  travel = false
): PastSet[] {
  const rows = db
    .select({ block: workoutExercises, workout: workouts })
    .from(workoutExercises)
    .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
    .where(
      and(
        eq(workoutExercises.exerciseId, exerciseId),
        isNotNull(workouts.endedAt),
        eq(workouts.deload, false)
      )
    )
    .orderBy(desc(workouts.startedAt))
    .limit(20)
    .all()
    .sort((a, b) => Number(a.workout.travel !== travel) - Number(b.workout.travel !== travel));
  for (const { block, workout } of rows) {
    if (workout.id === excludeWorkout) continue;
    const done = db
      .select()
      .from(sets)
      .where(and(eq(sets.workoutExerciseId, block.id), isNotNull(sets.completedAt)))
      .orderBy(asc(sets.position))
      .all()
      .filter((s) => s.kind === "working");
    if (done.length) return done;
  }
  return [];
}

export type SessionContext = {
  gym?: Gym;
  bodyWeightKg?: number | null;
  byId: (id: string) => Exercise;
  /** Away from your usual gym; the workout is marked so its loads stay with the trip. */
  travel?: boolean;
  /** With these, exercises the gym can't do become the closest ones it can, for this session. */
  exercises?: Exercise[];
  settings?: ExerciseSetting[];
};

/**
 * Starts a program session with every set prescribed. Returns the open workout instead when one
 * is already running with exercises in it; an empty one is discarded first. A slot whose exercise
 * the gym can't do gets a stand-in that keeps the slot, so its sets still count and progress.
 */
export function startSession(
  detail: ProgramDetail,
  week: number,
  dayId: number,
  context: SessionContext
): number {
  const open = activeWorkout();
  if (open) {
    if (workoutDetail(open.id)?.exercises.length) return open.id;
    discardWorkout(open.id);
  }
  const day = detail.days.find((d) => d.id === dayId);
  if (!day) throw new Error("Unknown program day");
  const deload = isDeloadWeek(detail, week);
  const rir = weekRir(detail, week);
  const { previous, feedback } = previousSession(detail.id, dayId, week);
  const plan = planDay(detail, day, week, previous, feedback, context.byId);
  const planned = plan.map(({ slot }) => context.byId(slot.exerciseId));
  const chosen =
    context.gym && context.exercises
      ? standIns(planned, context.exercises, context.gym, context.settings)
      : planned;
  return db.transaction((tx) => {
    const workoutId = tx
      .insert(workouts)
      .values({
        name: day.name,
        startedAt: now(),
        gymId: context.gym?.id ?? null,
        bodyWeightKg: context.bodyWeightKg ?? null,
        mesoId: detail.id,
        mesoWeek: week,
        mesoDayId: day.id,
        deload,
        travel: context.travel ?? false,
        updatedAt: Date.now(),
      })
      .returning()
      .get().id;
    plan.forEach(({ slot, sets: count }, position) => {
      const exercise = chosen[position];
      // A stand-in trains in its own rep range, as a swap does.
      const reps: [number, number] =
        exercise.id === slot.exerciseId
          ? [slot.repMin, slot.repMax]
          : [exercise.reps[0], exercise.reps[1]];
      const result = prescribe({
        exercise,
        gym: context.gym,
        reps,
        rir,
        sets: count,
        last: lastComparable(exercise.id, undefined, context.travel),
        bodyWeightKg: context.bodyWeightKg,
        deload,
      });
      const blockId = tx
        .insert(workoutExercises)
        .values({
          workoutId,
          exerciseId: exercise.id,
          position,
          repMin: reps[0],
          repMax: reps[1],
          slotId: slot.id,
          advice: result.advice,
        })
        .returning()
        .get().id;
      result.sets.forEach((set, index) =>
        tx
          .insert(sets)
          .values({
            workoutExerciseId: blockId,
            position: index,
            kind: "working",
            targetWeightKg: set.weightKg,
            targetReps: set.reps,
            targetRir: set.rir,
          })
          .run()
      );
    });
    return workoutId;
  });
}

// ——— Feedback ———

export function saveFeedback(workoutId: number, muscle: Muscle, rating: FeedbackRating | null) {
  if (!rating) {
    db.delete(muscleFeedback)
      .where(and(eq(muscleFeedback.workoutId, workoutId), eq(muscleFeedback.muscle, muscle)))
      .run();
    return;
  }
  db.insert(muscleFeedback)
    .values({ workoutId, muscle, rating })
    .onConflictDoUpdate({
      target: [muscleFeedback.workoutId, muscleFeedback.muscle],
      set: { rating },
    })
    .run();
}

export function feedbackFor(workoutId: number) {
  return db.select().from(muscleFeedback).where(eq(muscleFeedback.workoutId, workoutId)).all();
}

/** Muscles worked as a primary mover in a session, in the order they came up. */
export function trainedMuscles(detail: WorkoutDetail, byId: (id: string) => Exercise): Muscle[] {
  const seen: Muscle[] = [];
  for (const block of detail.exercises) {
    if (!block.sets.some((s) => s.completedAt && countsAsWork(s.kind))) continue;
    for (const m of primary(byId(block.exerciseId))) if (!seen.includes(m)) seen.push(m);
  }
  return seen;
}

/** Makes a swap permanent for the rest of the program. */
export function replaceSlotExercise(slotId: number, exercise: Exercise) {
  db.update(mesoSlots)
    .set({ exerciseId: exercise.id, repMin: exercise.reps[0], repMax: exercise.reps[1] })
    .where(eq(mesoSlots.id, slotId))
    .run();
}

/**
 * Swaps an exercise in a session. In a program session the replacement keeps the slot and gets
 * a real prescription for the week, so a swap never loses its targets; `permanent` also changes
 * the program from now on.
 */
export function swapInSession(
  workoutExerciseId: number,
  exercise: Exercise,
  permanent: boolean,
  context: { gym?: Gym; bodyWeightKg?: number | null }
) {
  return db.transaction(() => {
    const block = db
      .select()
      .from(workoutExercises)
      .where(eq(workoutExercises.id, workoutExerciseId))
      .get();
    if (!block) return null;
    const workout = db.select().from(workouts).where(eq(workouts.id, block.workoutId)).get();
    const newId = replaceExercise(workoutExerciseId, exercise);
    if (!newId || !workout?.mesoId || block.slotId === null) return newId;
    const meso = db.select().from(mesocycles).where(eq(mesocycles.id, workout.mesoId)).get();
    if (!meso) return newId;
    if (permanent) replaceSlotExercise(block.slotId, exercise);
    const open = db
      .select()
      .from(sets)
      .where(and(eq(sets.workoutExerciseId, newId), isNull(sets.completedAt)))
      .orderBy(asc(sets.position))
      .all()
      .filter((s) => s.kind === "working");
    const result = prescribe({
      exercise,
      gym: context.gym,
      reps: exercise.reps,
      rir: weekRir(meso, workout.mesoWeek ?? 0),
      sets: open.length,
      last: lastComparable(exercise.id, workout.id, workout.travel),
      bodyWeightKg: context.bodyWeightKg ?? workout.bodyWeightKg,
      deload: workout.deload,
    });
    db.update(workoutExercises)
      .set({ slotId: block.slotId, advice: result.advice })
      .where(eq(workoutExercises.id, newId))
      .run();
    open.forEach((s, i) =>
      db
        .update(sets)
        .set({
          targetWeightKg: result.sets[i]?.weightKg ?? null,
          targetReps: result.sets[i]?.reps ?? null,
          targetRir: result.sets[i]?.rir ?? null,
        })
        .where(eq(sets.id, s.id))
        .run()
    );
    return newId;
  });
}
