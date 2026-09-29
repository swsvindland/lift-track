import { useMemo } from "react";
import { useKitFormat, type Format, type IntlUnit } from "@/vector";
import type { Advice } from "./progression";
import { fromKg, type Units } from "./metrics";
import { useStore } from "./store";
import type { Message } from "./translations";

type Translate = (key: Message, values?: Record<string, string | number>) => string;
type SetLike = { weightKg: number | null; reps: number | null; rir?: number | null };

/** The Intl unit loads and body weight are shown in. */
export const massUnit = (units: Units): IntlUnit => (units === "metric" ? "kilogram" : "pound");

/** A load in the display unit without trailing zeros: 80, 102.5, 11.25. Plain digits: set inputs read it back. */
export function loadValue(kg: number, units: Units): string {
  const value = Math.round(fromKg(kg, units) * 100) / 100;
  return String(value);
}

/** The compact set line in plain digits and English for the on-device model's prompt: "102.5×8@2". */
export function modelSetText(set: SetLike, units: Units) {
  const weight = set.weightKg ? loadValue(set.weightKg, units) : "BW";
  const rir = set.rir !== null && set.rir !== undefined ? `@${set.rir}` : "";
  return `${weight}×${set.reps ?? "–"}${rir}`;
}

/**
 * Loads, set lines, durations and advice in the app's language and locale. A hook, not plain functions: its
 * helpers change with the language, so the React Compiler recomputes every text built from them.
 */
export function useLiftFormat() {
  const { t } = useStore();
  const format = useKitFormat();
  return useMemo(() => liftFormat(format, t), [format, t]);
}

function liftFormat(format: Format, t: Translate) {
  /** Loads to two decimals without trailing zeros: 80, 102.5, 11.25 (102,5 in de). */
  const loads = new Intl.NumberFormat(format.tag, { maximumFractionDigits: 2 });
  /** Measurements side by side ("1 hr 5 min", "80 × 8, 80 × 7"): the kit's unit list, which adds no "and". */
  const unitList = (items: string[], style: "short" | "narrow") =>
    format.list(items, { type: "unit", style });

  /** A load with its unit in the locale's form: "102.5 kg", "102,5 kg". */
  const loadText = (kg: number, units: Units) => format.unit(fromKg(kg, units), massUnit(units), 2);

  /** "80 × 8", with "@2" when reps in reserve were recorded; "80×8" when compact. Body weight reads "BW". */
  const setText = (set: SetLike, units: Units, compact = false) => {
    const load = set.weightKg ? loads.format(fromKg(set.weightKg, units)) : t("bodyweightShort");
    const reps = set.reps !== null ? format.number(set.reps) : "–";
    const line = t(compact ? "loadTimesRepsCompact" : "loadTimesReps", { load, reps });
    return set.rir !== null && set.rir !== undefined
      ? t(compact ? "setAtRirCompact" : "setAtRir", { set: line, rir: format.number(set.rir) })
      : line;
  };

  /** Elapsed time to the minute: "45 min", "1 hr 5 min", in the locale's units. */
  const duration = (fromIso: string, toIso?: string | null) => {
    const minutes = Math.max(
      0,
      Math.round((Date.parse(toIso ?? new Date().toISOString()) - Date.parse(fromIso)) / 60000)
    );
    if (minutes < 60) return format.unit(minutes, "minute");
    const hours = format.unit(Math.floor(minutes / 60), "hour");
    return minutes % 60 ? unitList([hours, format.unit(minutes % 60, "minute")], "narrow") : hours;
  };

  /** "Today", "Yesterday", else the short date in the kit's locale, with the year once it is not this one. */
  const dayLabel = (iso: string) => {
    const date = new Date(iso);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return t("today");
    if (date.toDateString() === yesterday.toDateString()) return t("yesterday");
    return date.toLocaleDateString(format.tag, {
      weekday: "short",
      month: "short",
      day: "numeric",
      ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
    });
  };

  const reason = (advice: Advice, units: Units): string => {
    const load = (kg: number) => loadText(kg, units);
    const n = (value: number) => format.number(value);
    switch (advice.kind) {
      case "first":
        return t("adviceFirst", { max: n(advice.reps + advice.rir), reps: n(advice.reps) });
      case "up":
        return t("adviceUp", { load: load(advice.fromKg), reps: n(advice.fromReps) });
      case "reps":
        return advice.toReps > advice.fromReps
          ? t("adviceRepsUp", {
              from: n(advice.fromReps),
              to: n(advice.toReps),
              load: load(advice.kg),
            })
          : advice.toReps === advice.fromReps
            ? t("adviceSame", { load: load(advice.kg), reps: n(advice.toReps) })
            : t("adviceReserve", { load: load(advice.kg), reps: n(advice.toReps) });
      case "down":
        return t("adviceDown", { load: load(advice.fromKg), reps: n(advice.fromReps) });
      case "topOut":
        return t("adviceTopOut", { reps: n(advice.reps) });
      case "deload":
        return t("adviceDeload");
    }
  };

  return {
    loadText,
    setText,
    /** Sets side by side, as a list of measurements: "80 × 8, 80 × 7". */
    setList: (sets: string[]) => unitList(sets, "short"),
    duration,
    dayLabel,
    /** One line on why a prescription is what it is. */
    adviceText: (advice: Advice | null | undefined, units: Units): string => {
      if (!advice) return "";
      const why = reason(advice, units);
      return "stalled" in advice && advice.stalled
        ? t("adviceStalled", { reason: why, n: format.number(advice.stalled) })
        : why;
    },
    /** "2 RIR" reads as jargon to newer lifters; say it plainly. */
    rirText: (rir: number) =>
      rir === 0
        ? t("rirToFailure")
        : t(format.plural(rir) === "one" ? "rirOne" : "rirOther", { n: format.number(rir) }),
    /** A total such as session volume, to the nearest whole unit. */
    totalText: (kg: number, units: Units) =>
      format.unit(Math.round(fromKg(kg, units)), massUnit(units)),
    /** An estimate, such as a 1RM, to the nearest whole unit: decimals would claim false precision. */
    estimateText: (kg: number, units: Units) =>
      format.unit(Math.round(fromKg(kg, units)), massUnit(units)),
    /** Body weight to one decimal place. */
    weightText: (kg: number, units: Units) => format.unit(fromKg(kg, units), massUnit(units), 1),
  };
}
