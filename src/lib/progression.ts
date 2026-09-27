import type { Effort } from "@/db/schema";
import type { Equipment } from "./exercises/types";
import { achievableLoads, fromGymUnit, type GymSetup } from "./loads";
import { e1rm, repsToFailure } from "./strength";

/**
 * Progression method 2. Deterministic and explainable: the next session's load and reps come
 * from the last comparable performance and how hard it felt, this week's reps-in-reserve target
 * and the loads the gym can actually make. A session done as prescribed always earns a step.
 * See docs/progression.md.
 */
export const METHOD = 2;

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
/** Reps a set may run past the top of the range while the next load up is too big a jump. */
export const OVERFLOW = 3;
/** Sessions in a row behind the prescription before an exercise counts as stalled. */
export const STALL_SESSIONS = 3;

type Stall = {
  /** Sessions in a row the lifter fell behind, once that reaches {@link STALL_SESSIONS}. */
  stalled?: number;
};
/**
 * What the phone's model changed, so the screen can show it and undo it: a push (+1) or hold
 * (−1) on the load and reps, sets added or taken (±), its reason, and the nudges' ids.
 */
export type AiApplied = { ai?: number; aiSets?: number; aiReason?: string; aiIds?: string };
export type Advice = (
  | { kind: "first"; reps: number; rir: number }
  | ({
      kind: "up";
      fromKg: number;
      toKg: number;
      fromReps: number;
      toReps: number;
      rir: number;
    } & Stall)
  | ({ kind: "reps"; kg: number; fromReps: number; toReps: number; rir: number } & Stall)
  | ({
      kind: "down";
      fromKg: number;
      toKg: number;
      fromReps: number;
      toReps: number;
      rir: number;
    } & Stall)
  | ({ kind: "topOut"; kg: number; reps: number; rir: number } & Stall)
  | { kind: "deload"; kg: number | null; reps: number }
) &
  AiApplied;

export type PastSet = {
  weightKg: number | null;
  reps: number | null;
  rir: number | null;
  effort?: Effort | null;
  targetWeightKg?: number | null;
  targetReps: number | null;
  targetRir: number | null;
};

export type PrescribeInput = {
  exercise: { equipment: Equipment; load?: "bodyweight" | "assisted" };
  gym?: GymSetup;
  reps: readonly [number, number];
  /** This week's reps-in-reserve target; outside a program, left out to match last time. */
  rir?: number;
  sets: number;
  /** Completed working sets from the last comparable (non-deload) session, in order. */
  last?: PastSet[];
  /** The comparable sessions before that, newest first, to tell a stall. */
  history?: PastSet[][];
  bodyWeightKg?: number | null;
  deload?: boolean;
  /**
   * The phone's model read the lifter's note: +1 pushes (last time counts as a rep easier),
   * −1 holds (last time's targets again, no step and no back-off).
   */
  nudge?: number;
};

export type Prescription = {
  /** Load as logged: plates or stack for most, added load for bodyweight, assistance for assisted. */
  sets: { weightKg: number | null; reps: number; rir: number }[];
  advice: Advice;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const same = (a: number, b: number) => Math.abs(a - b) < 0.01;

/**
 * Reps in reserve an effort rating stands for, read against the set's target: hard is 1 or
 * fewer (0 when the target was already that close), good is 1–3 (the target when it's in that
 * band), easy is 4 or more.
 */
export function effortRir(effort: Effort, targetRir: number | null): number {
  const target = targetRir ?? 2;
  if (effort === "hard") return target >= 2 ? 1 : 0;
  if (effort === "good") return clamp(target, 1, 3);
  return Math.max(4, target + 2);
}

/**
 * Reps in reserve a past set most likely had. Recorded RIR wins, then the effort rating; a set
 * that fell short of its target reps is taken as done to failure; otherwise the lifter stopped
 * where the week asked.
 */
export function assumedRir(set: PastSet): number {
  if (set.rir !== null) return set.rir;
  if (set.effort) return effortRir(set.effort, set.targetRir);
  if (set.targetReps !== null && (set.reps ?? 0) < set.targetReps) return 0;
  return set.targetRir ?? 2;
}

const missed = (set: PastSet) => set.targetReps !== null && (set.reps ?? 0) < set.targetReps;

/**
 * Whether a session kept up with its prescription: no set short of its target reps, and the
 * first set no harder than planned. Outside a program there's no plan, so only "hard" counts.
 */
export function keptUp(done: PastSet[]): boolean {
  const first = done.find((s) => (s.reps ?? 0) > 0);
  if (!first) return true;
  if (done.some(missed)) return false;
  return first.targetRir !== null
    ? assumedRir(first) >= first.targetRir
    : first.effort !== "hard" && (first.rir === null || first.rir >= 1);
}

/** Sessions in a row, newest first, that fell behind their prescription. */
export function sessionsBehind(sessions: PastSet[][]): number {
  let count = 0;
  for (const done of sessions) {
    if (!done.some((s) => (s.reps ?? 0) > 0)) continue;
    if (keptUp(done)) break;
    count++;
  }
  return count;
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
 *   move to the lightest heavier load that lands in range (or one rep under it); below the
 *   bottom, the heaviest lighter one. When the next load up is too big a jump, reps run up to
 *   {@link OVERFLOW} past the top of the range until it fits.
 * - A session that kept up earns at least a step, +1 rep or the next load, unless this week asks
 *   for more in reserve than last time. One that fell behind holds or backs off.
 * - Later sets keep last time's drop-off in reps from the first set.
 */
export function prescribe(input: PrescribeInput): Prescription {
  const [min, max] = input.reps;
  const { sets } = input;
  const push = input.nudge === 1;
  const last = (input.last ?? [])
    .filter((s) => (s.reps ?? 0) > 0)
    .map((s) => (push ? { ...s, rir: assumedRir(s) + 1 } : s));
  const model = loadModel(input);
  const repeat = (weightKg: number | null, reps: number[], setRir: number) =>
    Array.from({ length: Math.max(1, sets) }, (_, i) => ({
      weightKg,
      reps: reps[Math.min(i, reps.length - 1)],
      rir: setRir,
    }));

  if (!last.length) {
    const rir = input.rir ?? 2;
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
  const topReps = top.reps ?? 0;
  // Outside a program, match last time's effort (as it was, before any push).
  const rir = input.rir ?? assumedRir(top) - (push ? 1 : 0);

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

  if (input.nudge === -1) {
    // Held on the lifter's word: last time's targets again, or what was done where there were none.
    const first = last[0];
    const kg = first.targetWeightKg ?? first.weightKg;
    const reps = last.map((s) => clamp(s.targetReps ?? s.reps ?? min, 1, max + OVERFLOW));
    return {
      sets: repeat(kg, reps, rir),
      advice: { kind: "reps", kg: kg ?? 0, fromReps: topReps, toReps: reps[0], rir },
    };
  }

  // A step is owed when last time kept up and this week doesn't ask for more in reserve.
  const owed = keptUp(last) && rir <= (top.targetRir ?? assumedRir(top));
  const behind = sessionsBehind([last, ...(input.history ?? [])]);
  const stall: Stall = behind >= STALL_SESSIONS ? { stalled: behind } : {};

  // Drop-off from the first set, among sets at the top set's load.
  const atTop = last.filter((s) => same(s.weightKg ?? 0, top.weightKg ?? 0));
  const drops = atTop.map((s) => (s.reps ?? 0) - (atTop[0].reps ?? 0));
  const withDrop = (first: number, cap: number) =>
    drops.map((d) => clamp(first + d, Math.max(1, min - 2), cap));

  const oneRm = e1rm(topEffective, topReps, assumedRir(top));
  if (!(topEffective > 0) || !(oneRm > 0)) {
    // Bodyweight without a known body weight: progress reps only.
    const cap = max + OVERFLOW;
    let reps = topReps + Math.max(0, (top.targetRir ?? assumedRir(top)) - rir);
    if (owed) reps = Math.max(reps, topReps + 1);
    reps = clamp(reps, min, cap);
    return {
      sets: repeat(top.weightKg, withDrop(reps, cap), rir),
      advice:
        reps >= cap && reps <= topReps
          ? { kind: "topOut", kg: top.weightKg ?? 0, reps, rir, ...stall }
          : { kind: "reps", kg: top.weightKg ?? 0, fromReps: topReps, toReps: reps, rir, ...stall },
    };
  }

  const repsAt = (effective: number) => Math.floor(repsToFailure(oneRm, effective) - rir + 0.1);
  const options = candidates(input, topEffective * 1.3 + 20)
    .map((logged) => ({ logged, effective: model.toEffective(logged) }))
    .filter((o) => o.effective > 0)
    .sort((a, b) => a.effective - b.effective);
  type Option = (typeof options)[number];
  const current = options.reduce<Option | undefined>(
    (best, o) =>
      !best || Math.abs(o.effective - topEffective) < Math.abs(best.effective - topEffective)
        ? o
        : best,
    undefined
  ) ?? { logged: top.weightKg ?? 0, effective: topEffective };
  /** The next load up, when reps there would land in the range or one short of it. */
  const reachable = (o: Option) => {
    const next = options.find((x) => x.effective > o.effective + 0.01);
    return next && repsAt(next.effective) >= min - 1 ? next : undefined;
  };
  /** Most reps to prescribe at a load: the range, or past it while the next load is too far. */
  const capAt = (o: Option) => (reachable(o) ? max : max + OVERFLOW);
  const moveUp = (from: Option) => {
    const next = reachable(from);
    return next ? { choice: next, reps: clamp(repsAt(next.effective), min - 1, max) } : undefined;
  };

  let choice = current;
  let reps = repsAt(current.effective);
  if (reps > max) {
    const up = moveUp(current);
    if (up) ({ choice, reps } = up);
    else reps = Math.min(reps, capAt(current));
  } else if (reps < (owed ? min - 1 : min)) {
    // One short of the range after keeping up (a load just taken) stays; the step adds the rep.
    const lighter = [...options]
      .reverse()
      .find((o) => o.effective < current.effective - 0.01 && repsAt(o.effective) >= min);
    choice = lighter ?? options[0] ?? current;
    reps = clamp(repsAt(choice.effective), min, max);
  }

  const heavier = () => choice.effective > topEffective + 0.01;
  const lighter = () => choice.effective < topEffective - 0.01;
  if (owed && !heavier() && !lighter() && reps <= topReps) {
    // Kept up but the estimate alone doesn't move: one more rep, or the next load.
    if (topReps + 1 <= capAt(current)) {
      choice = current;
      reps = topReps + 1;
    } else {
      const up = moveUp(current);
      if (up) ({ choice, reps } = up);
    }
  }
  const cap = capAt(choice);
  reps = clamp(reps, heavier() ? min - 1 : min, cap);

  const advice: Advice = heavier()
    ? {
        kind: "up",
        fromKg: top.weightKg ?? 0,
        toKg: choice.logged,
        fromReps: topReps,
        toReps: reps,
        rir,
        ...stall,
      }
    : lighter()
      ? {
          kind: "down",
          fromKg: top.weightKg ?? 0,
          toKg: choice.logged,
          fromReps: topReps,
          toReps: reps,
          rir,
          ...stall,
        }
      : reps >= cap && !reachable(choice) && reps <= topReps
        ? { kind: "topOut", kg: choice.logged, reps, rir, ...stall }
        : { kind: "reps", kg: choice.logged, fromReps: topReps, toReps: reps, rir, ...stall };
  // A new load resets the drop-off pattern to the old load's; keep it, it's the best guess.
  return { sets: repeat(choice.logged, withDrop(reps, cap), rir), advice };
}
