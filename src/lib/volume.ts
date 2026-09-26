import type { Exercise } from "./exercises";
import type { Muscle } from "./exercises/types";
import { countsAsWork } from "./strength";
import type { WorkoutDetail } from "./workouts";

/** Monday 00:00 local of the week containing a date, as an ISO string. */
export function weekStart(date = new Date()): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

/**
 * Completed hard sets per muscle: a primary mover counts a whole set, a secondary mover half.
 * A unilateral exercise's left and right sets count once per pair.
 */
export function setsPerMuscle(
  workouts: WorkoutDetail[],
  byId: (id: string) => Exercise
): Partial<Record<Muscle, number>> {
  const totals: Partial<Record<Muscle, number>> = {};
  for (const workout of workouts)
    for (const block of workout.exercises) {
      const exercise = byId(block.exerciseId);
      const done = block.sets.filter((s) => s.completedAt && countsAsWork(s.kind));
      const count = done.some((s) => s.side) ? done.length / 2 : done.length;
      for (const [muscle, weight] of Object.entries(exercise.muscles) as [Muscle, number][])
        totals[muscle] = (totals[muscle] ?? 0) + count * weight;
    }
  return totals;
}
