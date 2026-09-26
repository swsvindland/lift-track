import { useState } from "react";
import { View } from "react-native";
import { useThemeColor } from "heroui-native";
import { SystemText as Text } from "@/components/system";
import type { StrengthPoint } from "@/lib/analytics";
import { loadValue } from "@/lib/format";
import { fromKg, localDay, shortDay, weightUnit } from "@/lib/metrics";
import { useStore } from "@/lib/store";
import { RangeChips, RangeSummary, TrendChart, rangeStart, type Range } from "./chart";

/** Best estimated 1RM per session over a chosen range, with a press-and-drag readout. */
export function StrengthChart({ series, name }: { series: StrengthPoint[]; name: string }) {
  const { units, language } = useStore();
  const hue = String(useThemeColor("accent-soft-foreground"));
  const [range, setRange] = useState<Range>("3M");
  const [scrub, setScrub] = useState<string | null>(null);
  if (series.length < 2)
    return (
      <Text className="text-sm text-muted">
        A strength trend appears once you have done this on two different days.
      </Text>
    );
  const to = localDay();
  const from = rangeStart(range, to, series[0].day);
  const shown = series.filter((p) => p.day >= from);
  const points = shown.map((p) => ({ day: p.day, value: fromKg(p.e1rmKg, units) }));
  const unit = weightUnit(units);
  const at = scrub
    ? shown.reduce((best, p) =>
        Math.abs(Date.parse(p.day) - Date.parse(scrub)) <
        Math.abs(Date.parse(best.day) - Date.parse(scrub))
          ? p
          : best
      )
    : null;
  const latest = shown.at(-1) ?? series.at(-1)!;
  const change = shown.length > 1 ? latest.e1rmKg - shown[0].e1rmKg : 0;
  // Estimates aren't precise to the plate; whole units read honestly.
  const round = (kg: number) => String(Math.round(fromKg(kg, units)));
  return (
    <View className="gap-3">
      <RangeSummary
        stats={
          at
            ? [{ label: "Est. 1RM", value: round(at.e1rmKg), unit }]
            : [
                { label: "Est. 1RM", value: round(latest.e1rmKg), unit },
                {
                  label: "Change",
                  value: `${change >= 0 ? "+" : "−"}${round(Math.abs(change))}`,
                  unit,
                },
              ]
        }
        caption={
          at
            ? `${shortDay(at.day, language, true)} · best set ${loadValue(at.topKg, units)} × ${at.reps}`
            : `${shown.length} sessions since ${shortDay(shown[0]?.day ?? from, language)}`
        }
      />
      <TrendChart
        from={from}
        to={to}
        lines={[{ key: "e1rm", segments: [points], color: hue, dots: true }]}
        minSpan={units === "metric" ? 5 : 10}
        format={(v) => String(Math.round(v))}
        label={`${name} estimated one-rep max, ${shortDay(from, language)} to today`}
        scrub={scrub}
        onScrub={setScrub}
      />
      <RangeChips value={range} onChange={setRange} />
    </View>
  );
}
