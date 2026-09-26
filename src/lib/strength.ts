import type { SetKind } from "@/db/schema";

/**
 * Estimated one-rep max from a set, counting reps in reserve as reps that could have been done
 * (Epley). Unknown RIR is treated as 0, so an estimate never assumes unreported effort.
 * Beyond about 12 reps to failure the estimate grows unreliable; callers show it as a trend.
 */
export function e1rm(weightKg: number, reps: number, rir?: number | null): number {
  if (!(weightKg > 0) || !(reps > 0)) return 0;
  const toFailure = reps + Math.max(0, rir ?? 0);
  return toFailure <= 1 ? weightKg : weightKg * (1 + toFailure / 30);
}

/** Reps doable at a load for a given e1RM, the inverse of {@link e1rm}. */
export function repsToFailure(e1rmKg: number, weightKg: number): number {
  if (!(weightKg > 0) || !(e1rmKg > 0)) return 0;
  return Math.max(0, 30 * (e1rmKg / weightKg - 1));
}

/** Warm-ups don't count toward volume or strength trends. */
export const countsAsWork = (kind: SetKind) => kind !== "warmup";

/**
 * The load a lifter adds to or subtracts from their body for bodyweight and assisted exercises;
 * this is what strength trends compare.
 */
export function effectiveLoad(
  weightKg: number | null,
  load: "bodyweight" | "assisted" | undefined,
  bodyWeightKg: number | null | undefined
): number {
  const w = weightKg ?? 0;
  if (!load) return w;
  if (!bodyWeightKg) return load === "bodyweight" ? w : 0;
  return load === "bodyweight" ? bodyWeightKg + w : Math.max(0, bodyWeightKg - w);
}
