import { useState } from "react";
import { View } from "react-native";
import { useThemeColor } from "heroui-native";
import { fromKg, localDay, shortDay, weightTrend, weightUnit } from "@/lib/metrics";
import { useStore } from "@/lib/store";
import { Legend, RangeChips, RangeSummary, TrendChart, rangeStart, type Range } from "./chart";

/** Scale weights as dots under a smoothed trend line (7-day half-life). */
export function WeightChart() {
  const { weights, units, language, number } = useStore();
  const [hue, muted] = useThemeColor(["accent-soft-foreground", "muted"]).map(String);
  const [range, setRange] = useState<Range>("3M");
  const [scrub, setScrub] = useState<string | null>(null);
  const trend = weightTrend(weights);
  if (trend.length < 2) return null;
  const to = localDay();
  const from = rangeStart(range, to, trend[0].day);
  const shown = trend.filter((p) => p.day >= from);
  const unit = weightUnit(units);
  const at =
    scrub && shown.length
      ? shown.reduce((best, p) =>
          Math.abs(Date.parse(p.day) - Date.parse(scrub)) <
          Math.abs(Date.parse(best.day) - Date.parse(scrub))
            ? p
            : best
        )
      : null;
  const latest = shown.at(-1) ?? trend.at(-1)!;
  const change = shown.length > 1 ? latest.trend - shown[0].trend : 0;
  const v = (kg: number) => number(fromKg(kg, units));
  const swatch = (color: string, dot = false) => (
    <View
      style={{
        width: dot ? 8 : 16,
        height: dot ? 8 : 2,
        borderRadius: 4,
        backgroundColor: dot ? "transparent" : color,
        borderWidth: dot ? 1.5 : 0,
        borderColor: color,
      }}
    />
  );
  return (
    <View className="gap-3">
      <RangeSummary
        stats={
          at
            ? [
                { label: "Trend", value: v(at.trend), unit },
                { label: "Scale", value: v(at.raw), unit },
              ]
            : [
                { label: "Trend", value: v(latest.trend), unit },
                {
                  label: "Change",
                  value: `${change >= 0 ? "+" : "−"}${v(Math.abs(change))}`,
                  unit,
                },
              ]
        }
        caption={
          at
            ? shortDay(at.day, language, true)
            : `Since ${shortDay(shown[0]?.day ?? from, language)}`
        }
      />
      <TrendChart
        from={from}
        to={to}
        lines={[
          {
            key: "scale",
            segments: [shown.map((p) => ({ day: p.day, value: fromKg(p.raw, units) }))],
            color: muted,
            width: 0,
            dots: true,
          },
          {
            key: "trend",
            segments: [shown.map((p) => ({ day: p.day, value: fromKg(p.trend, units) }))],
            color: hue,
          },
        ]}
        minSpan={units === "metric" ? 2 : 4}
        format={(value) => String(Math.round(value))}
        label={`Body weight trend, ${shortDay(from, language)} to today`}
        scrub={scrub}
        onScrub={setScrub}
      />
      <Legend
        items={[
          { label: "Trend", swatch: swatch(hue) },
          { label: "Scale", swatch: swatch(muted, true) },
        ]}
      />
      <RangeChips value={range} onChange={setRange} />
    </View>
  );
}
