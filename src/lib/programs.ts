import { and, asc, desc, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  db,
  mesoDays,
  mesoSkips,
  mesoSlots,
  mesocycles,
  muscleFeedback,
  preferences,
  sets,
  workoutExercises,
  workouts,
  type FeedbackRating,
  type Gym,
  type MesoDay,
  type MesoSlot,
  type ExerciseSetting,
  type Mesocycle,
  type Soreness,
  type Workout,
} from "@/db";
import { standIns, type Exercise } from "./exercises";
import type { Muscle } from "./exercises/types";
import type { ProgramDraft } from "./program-builder";
import { DELOAD_RIR, METHOD, prescribe, type Advice, type AiApplied } from "./progression";
import { countsAsWork } from "./strength";
import {
  activeWorkout,
  addSet,
  comparableSessions,
  dismissNudges,
  exerciseNudge,
  gymById,
  nudgesFor,
  withNudge,
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
 * A finished program as the next block's draft. Each muscle whose weekly sets grew by two or
 * more through the block, and that ended it without being still sore, too much or hurt, starts
 * a set higher: on the day and slot where it has the fewest. Loads carry over from history.
 */
export function nextBlock(detail: ProgramDetail, byId: (id: string) => Exercise): ProgramDraft {
  const draft = draftFrom(detail);
  const done = mesoWorkouts(detail.id).filter((w) => w.endedAt && !w.deload);
  const weeks = [...new Set(done.map((w) => w.mesoWeek ?? 0))].sort((a, b) => a - b);
  if (weeks.length < 2) return draft;
  const weekly = (week: number) => {
    const count = new Map<Muscle, number>();
    for (const w of done.filter((w) => w.mesoWeek === week))
      for (const block of workoutDetail(w.id)?.exercises ?? []) {
        const worked = block.sets.filter((s) => s.completedAt && countsAsWork(s.kind)).length;
        for (const m of primary(byId(block.exerciseId))) count.set(m, (count.get(m) ?? 0) + worked);
      }
    return count;
  };
  const first = weekly(weeks[0]);
  const last = weekly(weeks[weeks.length - 1]);
  const strained = new Set(
    done
      .filter((w) => (w.mesoWeek ?? 0) >= weeks[weeks.length - 1] - 1)
      .flatMap((w) => feedbackFor(w.id))
      .filter((f) => f.soreness === "sore" || f.rating === "tooMuch" || f.rating === "pain")
      .map((f) => f.muscle)
  );
  for (const [muscle, sets] of last) {
    if (sets < (first.get(muscle) ?? 0) + 2) continue;
    if (strained.has(muscle) || detail.deprioritized.includes(muscle)) continue;
    const target = draft.days
      .flatMap((d) => d.slots)
      .filter((s) => byId(s.exerciseId).muscles[muscle] === 1 && s.sets < MAX_SLOT_SETS)
      .sort((a, b) => a.sets - b.sets)[0];
    if (target) target.sets++;
  }
  return draft;
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
 * How a muscle's sets should change on a day, from last week's same session. Workload feedback
 * decides when given; otherwise hitting the prescribed reps adds a set, missing by two or more on
 * most sets takes one away, anything else holds. A drop in performance caps good feedback at
 * hold. Soreness from that session caps the result: only just recovered holds, still sore takes
 * a set away.
 */
export function muscleDelta(
  previous: WorkoutDetail,
  muscle: Muscle,
  byId: (id: string) => Exercise,
  feedback: FeedbackRating | undefined,
  soreness?: Soreness
): number {
  const delta = workloadDelta(previous, muscle, byId, feedback);
  if (soreness === "sore") return Math.min(delta, -1);
  if (soreness === "justInTime") return Math.min(delta, 0);
  return delta;
}

function workloadDelta(
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

/** `ai` is the part of `delta` the phone's model asked for, and `aiIds` its nudges. */
export type SlotPlan = { slot: MesoSlot; sets: number; delta: number; ai: number; aiIds: number[] };

/** Model nudges for a day's muscles: ±1 set each, with their ids. */
export type SetNudges = Partial<Record<Muscle, { value: number; id: number }>>;

/**
 * Sets for each slot of a day in a week. Week one uses the plan. Later weeks start from last
 * week's same session and move each muscle by its delta, added to the slot with the fewest sets
 * that trains it and taken from the one with the most. A muscle brought down never gains sets.
 * The model's nudges then move a muscle one more set either way, within the same limits. The
 * deload halves last week's sets.
 */
export function planDay(
  meso: Pick<Mesocycle, "rir" | "deload" | "deprioritized">,
  day: MesoDay & { slots: MesoSlot[] },
  week: number,
  previous: WorkoutDetail | undefined,
  feedback: Partial<Record<Muscle, FeedbackRating>>,
  byId: (id: string) => Exercise,
  soreness: Partial<Record<Muscle, Soreness>> = {},
  nudges: SetNudges = {}
): SlotPlan[] {
  const plans: SlotPlan[] = day.slots.map((slot) => ({
    slot,
    sets: setsIn(week ? previous : undefined, slot),
    delta: 0,
    ai: 0,
    aiIds: [],
  }));
  if (week === 0 || !previous) return plans;
  if (isDeloadWeek(meso, week))
    return plans.map((p) => ({ ...p, sets: Math.max(1, Math.ceil(p.sets / 2)), delta: 0 }));
  const muscles = [...new Set(day.slots.flatMap((s) => primary(byId(s.exerciseId))))];
  /** Moves a muscle's sets by `delta`; returns the slots changed and by how much. */
  const shift = (muscle: Muscle, delta: number) => {
    const training = plans.filter((p) => byId(p.slot.exerciseId).muscles[muscle] === 1);
    const total = () => training.reduce((sum, p) => sum + p.sets, 0);
    const moved = new Map<SlotPlan, number>();
    while (delta > 0 && total() < MAX_MUSCLE_SESSION_SETS) {
      const target = training
        .filter((p) => p.sets < MAX_SLOT_SETS)
        .sort((a, b) => a.sets - b.sets)[0];
      if (!target) break;
      target.sets++;
      target.delta++;
      moved.set(target, (moved.get(target) ?? 0) + 1);
      delta--;
    }
    while (delta < 0) {
      const target = training.filter((p) => p.sets > 1).sort((a, b) => b.sets - a.sets)[0];
      if (!target) break;
      target.sets--;
      target.delta--;
      moved.set(target, (moved.get(target) ?? 0) - 1);
      delta++;
    }
    return moved;
  };
  for (const muscle of muscles) {
    const delta = muscleDelta(previous, muscle, byId, feedback[muscle], soreness[muscle]);
    shift(muscle, meso.deprioritized.includes(muscle) ? Math.min(0, delta) : delta);
  }
  for (const muscle of muscles) {
    const nudge = nudges[muscle];
    if (!nudge || (nudge.value > 0 && meso.deprioritized.includes(muscle))) continue;
    for (const [plan, n] of shift(muscle, Math.sign(nudge.value))) {
      plan.ai += n;
      plan.aiIds.push(nudge.id);
    }
  }
  return plans;
}

// ——— Starting a session ———

/** Records sets the model added or took on a block's advice, with their reasons. */
function withSetNudge<T extends AiApplied>(
  advice: T,
  sets: number,
  ids: number[],
  reasons: Map<number, string>
): T {
  if (!sets) return advice;
  const all = [...(advice.aiIds ? advice.aiIds.split(",").map(Number) : []), ...ids];
  const why = [advice.aiReason, ...ids.map((id) => reasons.get(id))].filter(Boolean);
  return {
    ...advice,
    aiSets: sets,
    aiReason: [...new Set(why)].join("; "),
    aiIds: [...new Set(all)].join(","),
  };
}

/**
 * How recovered each muscle was from a session: the soreness answered at the next session that
 * trained it. A later session that trained it without an answer ends the search for that muscle.
 */
export function sorenessAfter(
  session: Workout,
  byId: (id: string) => Exercise
): Partial<Record<Muscle, Soreness>> {
  const later = db
    .select()
    .from(workouts)
    .where(and(gt(workouts.startedAt, session.startedAt), isNotNull(workouts.endedAt)))
    .orderBy(asc(workouts.startedAt))
    .limit(14)
    .all();
  const found: Partial<Record<Muscle, Soreness>> = {};
  const settled = new Set<Muscle>();
  for (const workout of later) {
    const detail = workoutDetail(workout.id);
    if (!detail) continue;
    const answers = feedbackFor(workout.id);
    for (const muscle of trainedMuscles(detail, byId)) {
      if (settled.has(muscle)) continue;
      settled.add(muscle);
      const soreness = answers.find((a) => a.muscle === muscle)?.soreness;
      if (soreness) found[muscle] = soreness;
    }
  }
  return found;
}

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
  if (!found) return { previous: undefined, found, feedback: {}, soreness: {} };
  const answers = feedbackFor(found.id);
  const feedback = Object.fromEntries(
    answers.filter((f) => f.rating).map((f) => [f.muscle, f.rating])
  ) as Partial<Record<Muscle, FeedbackRating>>;
  // Soreness answered in that session is about the one before it: the fallback when nothing has
  // answered for this one yet, as for a muscle trained once a week.
  const soreness = Object.fromEntries(
    answers.filter((f) => f.soreness).map((f) => [f.muscle, f.soreness])
  ) as Partial<Record<Muscle, Soreness>>;
  return { previous: workoutDetail(found.id), found, feedback, soreness };
}

/**
 * Completed working sets from the last non-deload session that did an exercise. Sessions from
 * the same side of a trip come first (see {@link comparableSessions}).
 */
export const lastComparable = (exerciseId: string, excludeWorkout?: number, travel = false) =>
  comparableSessions(exerciseId, { limit: 1, excludeWorkout, travel })[0] ?? [];

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
  const { previous, found, feedback, soreness: before } = previousSession(detail.id, dayId, week);
  const soreness = found ? { ...before, ...sorenessAfter(found, context.byId) } : {};
  const nudges: SetNudges = Object.fromEntries(
    (found ? nudgesFor(found.id) : [])
      .filter((n) => n.muscle && !n.dismissed)
      .map((n) => [n.muscle, { value: n.value, id: n.id }])
  );
  const plan = planDay(detail, day, week, previous, feedback, context.byId, soreness, nudges);
  const reasons = new Map(found ? nudgesFor(found.id).map((n) => [n.id, n.reason]) : []);
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
    plan.forEach(({ slot, sets: count, ai, aiIds }, position) => {
      const exercise = chosen[position];
      // A stand-in trains in its own rep range, as a swap does.
      const reps: [number, number] =
        exercise.id === slot.exerciseId
          ? [slot.repMin, slot.repMax]
          : [exercise.reps[0], exercise.reps[1]];
      const [last = [], ...history] = comparableSessions(exercise.id, { travel: context.travel });
      const nudge = deload ? undefined : exerciseNudge(exercise.id, workoutId);
      const result = prescribe({
        exercise,
        gym: context.gym,
        reps,
        rir,
        sets: count,
        last,
        history,
        bodyWeightKg: context.bodyWeightKg,
        deload,
        nudge: nudge?.value,
      });
      const advice = withSetNudge(withNudge(result.advice, nudge), ai, aiIds, reasons);
      const blockId = tx
        .insert(workoutExercises)
        .values({
          workoutId,
          exerciseId: exercise.id,
          position,
          repMin: reps[0],
          repMax: reps[1],
          slotId: slot.id,
          advice,
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

/** Records one muscle's answers; a muscle with neither answer left has no row. */
function saveAnswers(
  workoutId: number,
  muscle: Muscle,
  patch: { rating?: FeedbackRating | null; soreness?: Soreness | null }
) {
  const where = and(eq(muscleFeedback.workoutId, workoutId), eq(muscleFeedback.muscle, muscle));
  const existing = db.select().from(muscleFeedback).where(where).get();
  const next = { rating: existing?.rating ?? null, soreness: existing?.soreness ?? null, ...patch };
  if (!next.rating && !next.soreness) {
    db.delete(muscleFeedback).where(where).run();
    return;
  }
  db.insert(muscleFeedback)
    .values({ workoutId, muscle, ...next })
    .onConflictDoUpdate({ target: [muscleFeedback.workoutId, muscleFeedback.muscle], set: next })
    .run();
}

/** How much the session was for a muscle; adjusts that day's sets next week. */
export const saveFeedback = (workoutId: number, muscle: Muscle, rating: FeedbackRating | null) =>
  saveAnswers(workoutId, muscle, { rating });

/** Whether a muscle came in recovered; adjusts the session that last trained it. */
export const saveSoreness = (workoutId: number, muscle: Muscle, soreness: Soreness | null) =>
  saveAnswers(workoutId, muscle, { soreness });

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

const SKIPPED = "feedbackSkipped";

/**
 * The last program session whose questions are still open: nothing answered, not skipped and
 * nothing started since. They can wait, e.g. after finishing on the Watch or when busy.
 */
export function awaitingFeedback(byId: (id: string) => Exercise): WorkoutDetail | undefined {
  if (activeWorkout()) return undefined;
  const last = db
    .select()
    .from(workouts)
    .where(isNotNull(workouts.endedAt))
    .orderBy(desc(workouts.startedAt))
    .limit(1)
    .get();
  if (!last || last.mesoId === null || last.deload || feedbackFor(last.id).length) return undefined;
  const skipped = db.select().from(preferences).where(eq(preferences.key, SKIPPED)).get()?.value;
  if (skipped === String(last.id)) return undefined;
  const detail = workoutDetail(last.id);
  return detail && trainedMuscles(detail, byId).length ? detail : undefined;
}

export function skipFeedback(workoutId: number) {
  const value = String(workoutId);
  db.insert(preferences)
    .values({ key: SKIPPED, value })
    .onConflictDoUpdate({ target: preferences.key, set: { value } })
    .run();
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
    const [last = [], ...history] = comparableSessions(exercise.id, {
      excludeWorkout: workout.id,
      travel: workout.travel,
    });
    const result = prescribe({
      exercise,
      gym: context.gym,
      reps: exercise.reps,
      rir: weekRir(meso, workout.mesoWeek ?? 0),
      sets: open.length,
      last,
      history,
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

// ——— The model's nudges ———

/**
 * Undoes what the phone's model changed on an exercise in an open session: sets it added or
 * took come back off or on (open ones only), a push or hold is re-prescribed without it, and its
 * nudges are dismissed so they aren't applied again.
 */
export function undoAi(workoutExerciseId: number, byId: (id: string) => Exercise) {
  db.transaction(() => {
    const block = db
      .select()
      .from(workoutExercises)
      .where(eq(workoutExercises.id, workoutExerciseId))
      .get();
    const advice = block?.advice;
    const workout = block
      ? db.select().from(workouts).where(eq(workouts.id, block.workoutId)).get()
      : undefined;
    if (!block || !advice || !workout || (!advice.ai && !advice.aiSets)) return;
    dismissNudges((advice.aiIds ?? "").split(",").map(Number).filter(Boolean));
    const openSets = () =>
      db
        .select()
        .from(sets)
        .where(and(eq(sets.workoutExerciseId, block.id), isNull(sets.completedAt)))
        .orderBy(asc(sets.position))
        .all()
        .filter((s) => s.kind === "working");
    const added = advice.aiSets ?? 0;
    if (added > 0)
      for (const s of openSets().slice(-added)) db.delete(sets).where(eq(sets.id, s.id)).run();
    for (let i = 0; i < -added; i++) addSet(block.id);
    let next: Advice = { ...advice };
    for (const key of ["ai", "aiSets", "aiReason", "aiIds"] as const) delete next[key];
    const open = openSets();
    if (advice.ai && open.length) {
      const meso = workout.mesoId
        ? db.select().from(mesocycles).where(eq(mesocycles.id, workout.mesoId)).get()
        : undefined;
      const [last = [], ...history] = comparableSessions(block.exerciseId, {
        excludeWorkout: workout.id,
        travel: workout.travel,
      });
      const result = prescribe({
        exercise: byId(block.exerciseId),
        gym: workout.gymId ? gymById(workout.gymId) : undefined,
        reps: [block.repMin, block.repMax],
        rir: meso ? weekRir(meso, workout.mesoWeek ?? 0) : undefined,
        sets: open.length,
        last,
        history,
        bodyWeightKg: workout.bodyWeightKg,
        deload: workout.deload,
      });
      next = result.advice;
      open.forEach((s, i) =>
        db
          .update(sets)
          .set({
            targetWeightKg: result.sets[i]?.weightKg ?? null,
            targetReps: result.sets[i]?.reps ?? null,
            targetRir: meso ? (result.sets[i]?.rir ?? null) : null,
          })
          .where(eq(sets.id, s.id))
          .run()
      );
    }
    db.update(workoutExercises)
      .set({ advice: next })
      .where(eq(workoutExercises.id, block.id))
      .run();
  });
}
