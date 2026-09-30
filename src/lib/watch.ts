import { z } from "zod";
import { efforts, type Effort, type Gym, type SetKind } from "@/db";
import type { Exercise } from "./exercises";
import { achievableLoads, fromGymUnit, toGymUnit } from "./loads";
import type { Units } from "./metrics";
import {
  activeMeso,
  isDeloadWeek,
  nextSession,
  programDetail,
  startSession,
  type SessionContext,
} from "./programs";
import type { Rest } from "./rest-timer";
import {
  activeWorkout,
  completeSet,
  finishWorkout,
  finishedWorkouts,
  gymById,
  rateSet,
  restLabel,
  restsAfter,
  startWorkout,
  trainingGym,
  updateSet,
  upNext,
  workoutDetail,
} from "./workouts";

/* The Watch shows the open workout and sends back what was done on it. The phone stays the one
   source of truth: it sends the whole open workout, and the Watch applies its own taps on top
   until the phone lists them as done in `acked`. */

export type WatchSet = {
  id: number;
  kind: SetKind;
  /** What was done, or else what's prescribed. */
  weightKg: number | null;
  reps: number | null;
  done: boolean;
  /** When it was checked off, in ms since 1970: the Watch follows the latest one. */
  doneAt: number | null;
  effort: Effort | null;
};

export type WatchExercise = {
  id: number;
  name: string;
  repMin: number;
  repMax: number;
  /** Its superset, shared with the exercises it alternates with; null when it stands alone. */
  superset: number | null;
  /** Seconds of rest after a working set; 0 inside a superset until its last exercise. */
  rest: number;
  /** Loads the crown steps through, in kg, ascending: what the gym can make near the target. */
  loads: number[];
  sets: WatchSet[];
};

export type WatchState = {
  v: 1;
  sentAt: number;
  unit: "kg" | "lb";
  workout: {
    id: number;
    name: string;
    startedAt: number;
    exercises: WatchExercise[];
    rest: Rest | null;
  } | null;
  /** What Start on the Watch would begin; null when there's nothing to start without the phone. */
  start: { title: string; detail: string } | null;
  /** Commands from the Watch already applied, newest last. */
  acked: string[];
};

export type WatchContext = Omit<SessionContext, "gym" | "travel"> & {
  units: Units;
  /** Seconds of rest after a working set of this exercise. */
  restFor: (exercise: Exercise) => number;
};

const STEPS_EACH_WAY = 40;

/** Loads near `kg` for the crown, including `kg` itself even when the gym can't make it. */
export function crownLoads(exercise: Exercise, gym: Gym | undefined, units: Units, kg: number) {
  const unit = gym?.unit ?? (units === "metric" ? "kg" : "lb");
  const upTo = toGymUnit(kg, unit) * 1.5 + (unit === "kg" ? 40 : 90);
  let values = gym ? achievableLoads(exercise.equipment, gym, upTo) : [];
  if (!values.length) {
    const step = unit === "kg" ? 2.5 : 5;
    values = Array.from({ length: Math.ceil(upTo / step) }, (_, i) => (i + 1) * step);
  }
  const loads = values.map((v) => fromGymUnit(v, unit));
  if (exercise.load && !loads.some((k) => k === 0)) loads.unshift(0);
  if (!loads.some((k) => Math.abs(k - kg) < 0.01)) loads.push(kg);
  loads.sort((a, b) => a - b);
  const at = loads.findIndex((k) => Math.abs(k - kg) < 0.01);
  return loads.slice(Math.max(0, at - STEPS_EACH_WAY), at + STEPS_EACH_WAY + 1);
}

/** The program's next session, else a repeat of the last workout. */
function nextStart() {
  const meso = activeMeso();
  const program = meso ? programDetail(meso.id) : undefined;
  const next = program ? nextSession(program) : undefined;
  if (program && next) return { kind: "program" as const, program, next };
  const last = finishedWorkouts(10).find((w) => w.exerciseIds.length);
  return last ? { kind: "repeat" as const, last } : undefined;
}

export function watchState(ctx: WatchContext, rest: Rest | null, acked: string[]): WatchState {
  const base = {
    v: 1 as const,
    sentAt: Date.now(),
    unit: ctx.units === "metric" ? ("kg" as const) : ("lb" as const),
    acked,
  };
  const open = activeWorkout();
  const detail = open ? workoutDetail(open.id) : undefined;
  if (!detail) {
    const start = nextStart();
    return {
      ...base,
      workout: null,
      start:
        start?.kind === "program"
          ? {
              title:
                start.program.days.find((d) => d.id === start.next.dayId)?.name ?? "Next session",
              detail: `${start.program.name} · ${isDeloadWeek(start.program, start.next.week) ? "Deload" : `Week ${start.next.week + 1}`}`,
            }
          : start
            ? {
                title:
                  start.last.name ||
                  start.last.exerciseIds
                    .slice(0, 2)
                    .map((id) => ctx.byId(id).name)
                    .join(", "),
                detail: "Repeat last workout",
              }
            : null,
    };
  }
  const gym = detail.gymId ? gymById(detail.gymId) : undefined;
  return {
    ...base,
    start: null,
    workout: {
      id: detail.id,
      name: detail.name,
      startedAt: Date.parse(detail.startedAt),
      rest,
      exercises: detail.exercises.map((block, index) => {
        const exercise = ctx.byId(block.exerciseId);
        const sets = block.sets.map((s) => ({
          id: s.id,
          kind: s.kind,
          weightKg: s.weightKg ?? s.targetWeightKg,
          reps: s.reps ?? s.targetReps,
          done: !!s.completedAt,
          doneAt: s.completedAt ? Date.parse(s.completedAt) : null,
          effort: s.effort,
        }));
        const current = sets.find((s) => !s.done && s.weightKg !== null) ?? sets.at(-1);
        return {
          id: block.id,
          name: exercise.name,
          repMin: block.repMin,
          repMax: block.repMax,
          superset: block.supersetGroup,
          rest: restsAfter(detail.exercises, index) ? ctx.restFor(exercise) : 0,
          loads: crownLoads(exercise, gym, ctx.units, current?.weightKg ?? 0),
          sets,
        };
      }),
    },
  };
}

const command = z.discriminatedUnion("type", [
  z.object({ id: z.string(), type: z.literal("start") }),
  z.object({
    id: z.string(),
    type: z.literal("log"),
    setId: z.number().int(),
    weightKg: z.number().min(0).max(2000),
    reps: z.number().int().min(0).max(999),
  }),
  z.object({
    id: z.string(),
    type: z.literal("rate"),
    setId: z.number().int(),
    effort: z.enum(efforts).nullable(),
  }),
  z.object({ id: z.string(), type: z.literal("skipRest") }),
  z.object({ id: z.string(), type: z.literal("finish"), workoutId: z.number().int() }),
]);
export type WatchCommand = z.infer<typeof command>;

export const parseWatchCommand = (json: string): WatchCommand | undefined => {
  try {
    return command.parse(JSON.parse(json));
  } catch {
    return undefined;
  }
};

/** What the phone's rest timer should do after a command. */
export type WatchEffect = {
  rest?: { seconds: number; label: string; setId: number };
  stopRest?: boolean;
  started?: boolean;
  /** The workout finished from the Watch; null when it was empty and discarded. */
  finished?: number | null;
};

/**
 * Applies one command from the Watch, the same way the phone's own taps would. Commands are safe
 * to apply twice: a set already done isn't logged again, and Start resumes an open workout.
 */
export function applyWatchCommand(cmd: WatchCommand, ctx: WatchContext): WatchEffect {
  if (cmd.type === "start") {
    if (activeWorkout()) return {};
    const start = nextStart();
    if (start?.kind === "program") {
      const { gym, travel } = trainingGym(ctx.units, start.program.gymId);
      startSession(start.program, start.next.week, start.next.dayId, { ...ctx, gym, travel });
    } else if (start) {
      const { gym, travel } = trainingGym(ctx.units);
      startWorkout({ gymId: gym.id, travel, from: start.last.id });
    } else return {};
    return { started: true };
  }
  if (cmd.type === "skipRest") return { stopRest: true };
  if (cmd.type === "finish") {
    // Only the workout the Watch was showing; a retry after it finished does nothing.
    if (activeWorkout()?.id !== cmd.workoutId) return {};
    return { finished: finishWorkout(cmd.workoutId), stopRest: true };
  }

  const open = activeWorkout();
  const detail = open ? workoutDetail(open.id) : undefined;
  const index = detail?.exercises.findIndex((b) => b.sets.some((s) => s.id === cmd.setId)) ?? -1;
  if (!detail || index < 0) return {};
  const block = detail.exercises[index];
  const row = block.sets.find((s) => s.id === cmd.setId)!;

  if (cmd.type === "rate") {
    if (row.kind !== "warmup") rateSet(row.id, cmd.effort);
    return {};
  }
  if (row.completedAt) return {};
  updateSet(row.id, { weightKg: cmd.weightKg, reps: cmd.reps });
  if (!completeSet(row.id) || row.kind === "warmup" || !restsAfter(detail.exercises, index))
    return {};
  const exercise = ctx.byId(block.exerciseId);
  const next = upNext(detail.exercises, row.id);
  return {
    rest: {
      seconds: ctx.restFor(exercise),
      label: restLabel(next ? ctx.byId(next.exerciseId).name : exercise.name),
      setId: row.id,
    },
  };
}
