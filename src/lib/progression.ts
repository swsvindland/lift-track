import type { Equipment } from "./exercises/types";
import { achievableLoads, fromGymUnit, type GymSetup } from "./loads";
import { e1rm, repsToFailure } from "./strength";

/**
 * Progression method 1. Deterministic and explainable: the next session's load and reps come
 * from the last comparable performance, this week's reps-in-reserve target and the loads the gym
 * can actually make. See docs/progression.md.
 */
export const METHOD = 1;

/** Reps in reserve for each accumulation week; effort rises toward the deload. */
export function rirPlan(weeks: number): number[] {
  const plans: Record<number, number[]> = {
    3: [3, 2, 1],
    4: [3, 2, 1, 0],
    5: [3, 2, 2, 1, 0],
    6: [3, 3, 2, 2, 1, 0],
  };
  return plans[Math.min(6, Math.max(3, Math.round(weeks)))];
}
export const DELOAD_RIR = 4;
/** Deload loads, as a share of the last accumulation week's. */
export const DELOAD_LOAD = 0.9;

export type Advice =
  | { kind: "first"; reps: number; rir: number }
  | { kind: "up"; fromKg: number; toKg: number; fromReps: number; toReps: number; rir: number }
  | { kind: "reps"; kg: number; fromReps: number; toReps: number; rir: number }
  | { kind: "down"; fromKg: number; toKg: number; fromReps: number; toReps: number; rir: number }
  | { kind: "topOut"; kg: number; reps: number; rir: number }
  | { kind: "deload"; kg: number | null; reps: number };

export type PastSet = {
  weightKg: number | null;
  reps: number | null;
  rir: number | null;
  targetReps: number | null;
  targetRir: number | null;
};

export type PrescribeInput = {
  exercise: { equipment: Equipment; load?: "bodyweight" | "assisted" };
  gym?: GymSetup;
  reps: readonly [number, number];
  /** This week's reps-in-reserve target. */
  rir: number;
  sets: number;
  /** Completed working sets from the last comparable (non-deload) session, in order. */
  last?: PastSet[];
  bodyWeightKg?: number | null;
  deload?: boolean;
};

export type Prescription = {
  /** Load as logged: plates or stack for most, added load for bodyweight, assistance for assisted. */
  sets: { weightKg: number | null; reps: number; rir: number }[];
  advice: Advice;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const same = (a: number, b: number) => Math.abs(a - b) < 0.01;

/**
 * Reps in reserve a past set most likely had. Recorded RIR wins; a set that fell short of its
 * target reps is taken as done to failure; otherwise the lifter stopped where the week asked.
 */
export function assumedRir(set: PastSet): number {
  if (set.rir !== null) return set.rir;
  if (set.targetReps !== null && (set.reps ?? 0) < set.targetReps) return 0;
  return set.targetRir ?? 2;
}

/** Converts between logged load and the load the body moves, for bodyweight movements. */
function loadModel(input: PrescribeInput) {
  const { exercise, bodyWeightKg } = input;
  const bw = bodyWeightKg && bodyWeightKg > 0 ? bodyWeightKg : null;
  const logged = (kg: number | null) => kg ?? 0;
  if (exercise.load === "bodyweight" && bw)
    return {
      toEffective: (kg: number | null) => bw + logged(kg),
      toLogged: (eff: number) => eff - bw,
    };
  if (exercise.load === "assisted" && bw)
    return {
      toEffective: (kg: number | null) => Math.max(1, bw - logged(kg)),
      toLogged: (eff: number) => bw - eff,
    };
  return { toEffective: logged, toLogged: (eff: number) => eff };
}

/** Loggable loads in kg, ascending, for this equipment and gym, up to a limit. */
function candidates(input: PrescribeInput, upToKg: number): number[] {
  const { exercise, gym, bodyWeightKg } = input;
  if (exercise.load === "assisted") {
    // Assistance comes off a machine stack; zero assistance is the full movement.
    const step = gym ? fromGymUnit(gym.machineStep, gym.unit) : 5;
    const max = bodyWeightKg ?? 100;
    const loads = [];
    for (let a = 0; a <= max; a += step) loads.push(a);
    return loads;
  }
  if (!gym) {
    const loads = [];
    for (let w = 0; w <= upToKg; w += 2.5) loads.push(w);
    return loads;
  }
  const unit = gym.unit;
  const upTo = (unit === "kg" ? upToKg : upToKg / 0.45359237) + 1;
  const loads = achievableLoads(exercise.equipment, gym, upTo).map((l) => fromGymUnit(l, unit));
  return exercise.load === "bodyweight" ? [0, ...loads] : loads;
}

/**
 * The next session's sets for one exercise.
 *
 * - First time: no load, reps in the middle of the range.
 * - Deload: 90% of the last top load at the bottom of the range, well short of failure.
 * - Otherwise: estimate a 1RM from last time's best set (reps + assumed reps in reserve), then
 *   keep last time's load while this week's target reps stay in range; past the top of the range,
 *   move to the lightest heavier load that lands in range; below the bottom, the heaviest lighter
 *   one. When the next load up is too big a jump, stay and keep reps at the top of the range.
 * - Later sets keep last time's drop-off in reps from the first set.
 */
export function prescribe(input: PrescribeInput): Prescription {
  const [min, max] = input.reps;
  const { rir, sets } = input;
  const last = (input.last ?? []).filter((s) => (s.reps ?? 0) > 0);
  const model = loadModel(input);
  const repeat = (weightKg: number | null, reps: number[], setRir: number) =>
    Array.from({ length: Math.max(1, sets) }, (_, i) => ({
      weightKg,
      reps: reps[Math.min(i, reps.length - 1)],
      rir: setRir,
    }));

  if (!last.length) {
    const reps = Math.round((min + max) / 2);
    return { sets: repeat(null, [reps], rir), advice: { kind: "first", reps, rir } };
  }

  const top = last.reduce((best, s) =>
    e1rm(model.toEffective(s.weightKg), s.reps ?? 0, assumedRir(s)) >
    e1rm(model.toEffective(best.weightKg), best.reps ?? 0, assumedRir(best))
      ? s
      : best
  );
  const topEffective = model.toEffective(top.weightKg);

  if (input.deload) {
    const target = topEffective * DELOAD_LOAD;
    const loads = candidates(input, topEffective + 10).filter(
      (l) => model.toEffective(l) <= target + 0.01
    );
    // Assistance runs the other way: more assistance is lighter.
    const logged =
      input.exercise.load === "assisted"
        ? (loads.find((l) => model.toEffective(l) <= target + 0.01) ?? top.weightKg)
        : loads.length
          ? loads[loads.length - 1]
          : top.weightKg;
    return {
      sets: repeat(logged ?? null, [min], DELOAD_RIR),
      advice: { kind: "deload", kg: logged ?? null, reps: min },
    };
  }

  // Drop-off from the first set, among sets at the top set's load.
  const atTop = last.filter((s) => same(s.weightKg ?? 0, top.weightKg ?? 0));
  const drops = atTop.map((s) => (s.reps ?? 0) - (atTop[0].reps ?? 0));
  const withDrop = (first: number) => drops.map((d) => clamp(first + d, Math.max(1, min - 2), max));

  const oneRm = e1rm(topEffective, top.reps ?? 0, assumedRir(top));
  if (!(topEffective > 0) || !(oneRm > 0)) {
    // Bodyweight without a known body weight: progress reps only.
    const reps = clamp(
      (top.reps ?? min) + Math.max(0, (top.targetRir ?? assumedRir(top)) - rir),
      min,
      max
    );
    return {
      sets: repeat(top.weightKg, withDrop(reps), rir),
      advice:
        reps >= max
          ? { kind: "topOut", kg: top.weightKg ?? 0, reps, rir }
          : { kind: "reps", kg: top.weightKg ?? 0, fromReps: top.reps ?? 0, toReps: reps, rir },
    };
  }

  const repsAt = (effective: number) => Math.floor(repsToFailure(oneRm, effective) - rir + 0.1);
  const options = candidates(input, topEffective * 1.3 + 20)
    .map((logged) => ({ logged, effective: model.toEffective(logged) }))
    .filter((o) => o.effective > 0)
    .sort((a, b) => a.effective - b.effective);
  const current = options.reduce<(typeof options)[number] | undefined>(
    (best, o) =>
      !best || Math.abs(o.effective - topEffective) < Math.abs(best.effective - topEffective)
        ? o
        : best,
    undefined
  ) ?? { logged: top.weightKg ?? 0, effective: topEffective };

  let choice = current;
  let reps = repsAt(current.effective);
  if (reps > max) {
    const heavier = options.find(
      (o) => o.effective > current.effective + 0.01 && repsAt(o.effective) >= min
    );
    if (heavier && repsAt(heavier.effective) <= max) {
      choice = heavier;
      reps = repsAt(heavier.effective);
    } else if (heavier) {
      // Even the next load up leaves reps above the range: take it at the top of the range.
      choice = heavier;
      reps = max;
    } else reps = max;
  } else if (reps < min) {
    const lighter = [...options]
      .reverse()
      .find((o) => o.effective < current.effective - 0.01 && repsAt(o.effective) >= min);
    choice = lighter ?? options[0] ?? current;
    reps = clamp(repsAt(choice.effective), min, max);
  }
  reps = clamp(reps, min, max);

  const up = choice.effective > topEffective + 0.01;
  const down = choice.effective < topEffective - 0.01;
  const fromReps = top.reps ?? 0;
  const advice: Advice = up
    ? { kind: "up", fromKg: top.weightKg ?? 0, toKg: choice.logged, fromReps, toReps: reps, rir }
    : down
      ? {
          kind: "down",
          fromKg: top.weightKg ?? 0,
          toKg: choice.logged,
          fromReps,
          toReps: reps,
          rir,
        }
      : reps >= max && repsAt(choice.effective) > max
        ? { kind: "topOut", kg: choice.logged, reps, rir }
        : { kind: "reps", kg: choice.logged, fromReps, toReps: reps, rir };
  // A new load resets the drop-off pattern to the old load's; keep it, it's the best guess.
  return { sets: repeat(choice.logged, withDrop(reps), rir), advice };
}
