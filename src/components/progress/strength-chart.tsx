import { useState } from "react";
import { View } from "react-native";
import type { StrengthPoint } from "@/lib/analytics";
import { massUnit, useLiftFormat } from "@/lib/format";
import { fromKg, localDay, shortDay } from "@/lib/metrics";
import { useStore } from "@/lib/store";
import { useCount } from "@/lib/use-count";
import {
  Note,
  RangeChips,
  RangeSummary,
  TrendChart,
  rangeStart,
  useKitFormat,
  type ChartPoint,
  type Range,
} from "@/vector";

/** Best estimated 1RM per session over a chosen range, with a press-and-drag readout. */
export function StrengthChart({ series, name }: { series: StrengthPoint[]; name: string }) {
  const { units, locale, t } = useStore();
  const { estimateText, loadText } = useLiftFormat();
  const format = useKitFormat();
  const count = useCount();
  const [range, setRange] = useState<Range>("3M");
  const [scrub, setScrub] = useState<ChartPoint | null>(null);
  if (series.length < 2) return <Note>{t("strengthTrendEmpty")}</Note>;
  const to = localDay();
  const from = rangeStart(range, to, series[0].day);
  const shown = series.filter((p) => p.day >= from);
  const at = scrub ? shown.find((p) => p.day === scrub.day) : undefined;
  const latest = shown.at(-1) ?? series.at(-1)!;
  const first = shown[0] ?? latest;
  const change = shown.length > 1 ? latest.e1rmKg - first.e1rmKg : 0;
  // Estimates aren't precise to the plate; whole units read honestly.
  const round = (kg: number) => Math.round(fromKg(kg, units));
  const values = (shown.length ? shown : [latest]).map((p) => p.e1rmKg);
  const direction =
    round(latest.e1rmKg) === round(first.e1rmKg)
      ? "trendSteady"
      : latest.e1rmKg > first.e1rmKg
        ? "trendRising"
        : "trendFalling";
  return (
    <View className="gap-3">
      <RangeSummary
        label={at ? shortDay(at.day, locale, true) : t("estimated1rm")}
        {...format.unitParts(round((at ?? latest).e1rmKg), massUnit(units))}
        delta={at ? undefined : format.number(round(change), 0, true)}
        meta={[
          at
            ? t("bestSet", {
                set: t("loadTimesReps", {
                  load: loadText(at.topKg, units),
                  reps: format.number(at.reps),
                }),
              })
            : t("sessionsSince", {
                sessions: count(shown.length, "sessionCountOne", "sessionCount"),
                day: shortDay(first.day, locale),
              }),
        ]}
      />
      <TrendChart
        from={from}
        to={to}
        lines={[
          {
            role: "subject",
            points: shown.map((p) => ({ day: p.day, value: fromKg(p.e1rmKg, units) })),
          },
        ]}
        minSpan={units === "metric" ? 5 : 10}
        yFormat={(value) => format.number(Math.round(value))}
        summary={t("strengthChartSummary", {
          name,
          from: shortDay(first.day, locale),
          to: shortDay(latest.day, locale),
          min: estimateText(Math.min(...values), units),
          max: estimateText(Math.max(...values), units),
          value: estimateText(latest.e1rmKg, units),
          direction: t(direction),
        })}
        onScrub={setScrub}
      />
      <RangeChips value={range} onChange={setRange} accessibilityLabel={t("chartRange")} />
    </View>
  );
}
