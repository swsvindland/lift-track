import type { Advice } from "./progression";
import { fromKg, weightUnit, type Units } from "./metrics";

/** A load in the display unit without trailing zeros: 80, 102.5, 11.25. */
export function loadValue(kg: number, units: Units): string {
  const value = Math.round(fromKg(kg, units) * 100) / 100;
  return String(value);
}

export const loadText = (kg: number, units: Units) =>
  `${loadValue(kg, units)} ${weightUnit(units)}`;

/** "80 × 8", with "@2" when reps in reserve were recorded; "80×8" when compact. */
export function setText(
  set: { weightKg: number | null; reps: number | null; rir?: number | null },
  units: Units,
  compact = false
) {
  const weight = set.weightKg ? loadValue(set.weightKg, units) : "BW";
  const rir = set.rir !== null && set.rir !== undefined ? `${compact ? "@" : " @"}${set.rir}` : "";
  return compact ? `${weight}×${set.reps ?? "–"}${rir}` : `${weight} × ${set.reps ?? "–"}${rir}`;
}

export function duration(fromIso: string, toIso?: string | null) {
  const minutes = Math.max(
    0,
    Math.round((Date.parse(toIso ?? new Date().toISOString()) - Date.parse(fromIso)) / 60000)
  );
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function dayLabel(iso: string, locale: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}

/** One line on why a prescription is what it is. */
export function adviceText(advice: Advice | null | undefined, units: Units): string {
  if (!advice) return "";
  const load = (kg: number) => loadText(kg, units);
  switch (advice.kind) {
    case "first":
      return `First time: pick a load you could do ${advice.reps + advice.rir} times, stop at ${advice.reps}`;
    case "up":
      return `Up from ${load(advice.fromKg)} × ${advice.fromReps} last time`;
    case "reps":
      return advice.toReps > advice.fromReps
        ? `${advice.fromReps} → ${advice.toReps} reps at ${load(advice.kg)}`
        : advice.toReps === advice.fromReps
          ? `Same as last time: ${load(advice.kg)} × ${advice.toReps}`
          : `${load(advice.kg)} × ${advice.toReps}: more in reserve this week`;
    case "down":
      return `Lighter: last time ${load(advice.fromKg)} × ${advice.fromReps} fell short`;
    case "topOut":
      return `Top of the range; the next load up is a big jump, so hold ${advice.reps}`;
    case "deload":
      return "Deload: lighter and easy, to recover for the next block";
  }
}

/** "2 RIR" reads as jargon to newer lifters; say it plainly. */
export const rirText = (rir: number) =>
  rir === 0 ? "to failure" : `${rir} ${rir === 1 ? "rep" : "reps"} in reserve`;

/** A total such as session volume, to the nearest whole unit. */
export const totalText = (kg: number, units: Units) =>
  `${Math.round(fromKg(kg, units)).toLocaleString()} ${weightUnit(units)}`;

/** An estimate, such as a 1RM, to the nearest whole unit: decimals would claim false precision. */
export const estimateText = (kg: number, units: Units) =>
  `${Math.round(fromKg(kg, units))} ${weightUnit(units)}`;

/** Body weight to one decimal place. */
export const weightText = (kg: number, units: Units) =>
  `${Math.round(fromKg(kg, units) * 10) / 10} ${weightUnit(units)}`;
