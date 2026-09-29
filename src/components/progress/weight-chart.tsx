import { useState } from "react";
import { View } from "react-native";
import { massUnit, useLiftFormat } from "@/lib/format";
import { fromKg, localDay, shortDay, weightTrend } from "@/lib/metrics";
import { useStore } from "@/lib/store";
import {
  RangeChips,
  RangeSummary,
  TrendChart,
  rangeStart,
  useKitFormat,
  type ChartPoint,
  type Range,
} from "@/vector";

/** Scale weights as dots under a smoothed trend line (7-day half-life). */
export function WeightChart() {
  const { weights, units, locale, t } = useStore();
  const { weightText } = useLiftFormat();
  const format = useKitFormat();
  const [range, setRange] = useState<Range>("3M");
  const [scrub, setScrub] = useState<ChartPoint | null>(null);
  const trend = weightTrend(weights);
  if (trend.length < 2) return null;
  const to = localDay();
  const from = rangeStart(range, to, trend[0].day);
  const shown = trend.filter((p) => p.day >= from);
  const at = scrub ? shown.find((p) => p.day === scrub.day) : undefined;
  const latest = shown.at(-1) ?? trend.at(-1)!;
  const first = shown[0] ?? latest;
  const change = shown.length > 1 ? latest.trend - first.trend : 0;
  const shownValue = (kg: number) => fromKg(kg, units);
  // One decimal always, so the readout keeps its width as the value changes.
  const reading = (kg: number) => ({
    ...format.unitParts(shownValue(kg), massUnit(units), 1),
    value: format.number(shownValue(kg), 1),
  });
  const values = (shown.length ? shown : [latest]).map((p) => p.trend);
  const direction =
    weightText(latest.trend, units) === weightText(first.trend, units)
      ? "trendSteady"
      : latest.trend > first.trend
        ? "trendRising"
        : "trendFalling";
  return (
    <View className="gap-3">
      <RangeSummary
        label={at ? shortDay(at.day, locale, true) : t("trend")}
        {...reading((at ?? latest).trend)}
        delta={at ? undefined : format.number(shownValue(change), 1, true)}
        meta={[
          at
            ? t("scaleValue", { value: weightText(at.raw, units) })
            : t("sinceDay", { day: shortDay(first.day, locale) }),
        ]}
      />
      <TrendChart
        from={from}
        to={to}
        lines={[
          {
            role: "reference",
            points: shown.map((p) => ({ day: p.day, value: shownValue(p.raw) })),
            label: t("scale"),
          },
          {
            role: "subject",
            points: shown.map((p) => ({ day: p.day, value: shownValue(p.trend) })),
            label: t("trend"),
          },
        ]}
        minSpan={units === "metric" ? 2 : 4}
        yFormat={(value) => format.number(Math.round(value))}
        summary={t("trendChartSummary", {
          from: shortDay(first.day, locale),
          to: shortDay(latest.day, locale),
          min: weightText(Math.min(...values), units),
          max: weightText(Math.max(...values), units),
          value: weightText(latest.trend, units),
          direction: t(direction),
        })}
        onScrub={setScrub}
      />
      <RangeChips value={range} onChange={setRange} accessibilityLabel={t("chartRange")} />
    </View>
  );
}
