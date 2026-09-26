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
