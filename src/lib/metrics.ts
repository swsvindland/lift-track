export type Units = "metric" | "imperial";
export const LB = 0.45359237;
export const weightUnit = (units: Units) => (units === "metric" ? "kg" : "lb");
export const fromKg = (kg: number, units: Units) => (units === "metric" ? kg : kg / LB);
export const toKg = (value: number, units: Units) => (units === "metric" ? value : value * LB);
export function parseNumber(input: string): number {
  const normalized = input.trim().replace(",", ".");
  return /^\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : NaN;
}
export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function validDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const date = new Date(`${day}T12:00:00`);
  return (
    Number.isFinite(date.getTime()) &&
    localDay(date) === day &&
    day <= localDay() &&
    day >= "1900-01-01"
  );
}
export function dayOf(timestamp: string): string {
  return timestamp.length === 10 ? timestamp : localDay(new Date(timestamp));
}
export type TrendPoint = { day: string; raw: number; trend: number };
export function weightTrend(entries: { measuredAt: string; weightKg: number }[]): TrendPoint[] {
  const days = new Map<string, number[]>();
  for (const entry of entries) {
    if (!Number.isFinite(entry.weightKg) || entry.weightKg <= 0) continue;
    const day = dayOf(entry.measuredAt);
    days.set(day, [...(days.get(day) ?? []), entry.weightKg]);
  }
  let previous = 0;
  let previousTime = 0;
  return [...days]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, values], index) => {
      const raw = values.reduce((a, b) => a + b, 0) / values.length;
      const time = Date.parse(`${day}T00:00:00Z`);
      const alpha = 1 - Math.pow(0.5, (time - previousTime) / 86400000 / 7);
      const trend = index === 0 ? raw : previous + alpha * (raw - previous);
      previous = trend;
      previousTime = time;
      return { day, raw, trend };
    });
}
