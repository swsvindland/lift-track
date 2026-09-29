import { useState } from "react";
import { Pressable, View } from "react-native";
import { muscleLabels } from "@/lib/exercises";
import { muscles as allMuscles, type Muscle } from "@/lib/exercises/types";
import { shortDay } from "@/lib/metrics";
import { useStore } from "@/lib/store";
import { useCount } from "@/lib/use-count";
import type { WeeklyVolume } from "@/lib/analytics";
import { Note, Text, useKitFormat } from "@/vector";

/** Weekly hard sets, binned; the tint from faint to full, so more always reads as darker. */
const bins = [
  { min: 1, max: 4, opacity: 0.16 },
  { min: 5, max: 9, opacity: 0.36 },
  { min: 10, max: 14, opacity: 0.58 },
  { min: 15, max: 19, opacity: 0.8 },
  { min: 20, opacity: 1 },
];
const binFor = (sets: number) => [...bins].reverse().find((b) => sets >= b.min);
const round = (n: number) => Math.round(n * 10) / 10;

/** Muscles down, weeks across; tap a cell for its number. */
export function MuscleHeatmap({ volume }: { volume: WeeklyVolume }) {
  const { locale, t } = useStore();
  const format = useKitFormat();
  const count = useCount();
  const [picked, setPicked] = useState<{ muscle: Muscle; week: number } | null>(null);
  const rows = allMuscles.filter((m) => volume.sets[m]?.some((v) => v > 0));
  if (!rows.length) return <Text tone="muted">{t("setsPerMuscleEmpty")}</Text>;
  const last = volume.weeks.length - 1;
  const sets = (n: number) =>
    count(round(n), "setCountOne", "setCount", Number.isInteger(round(n)) ? 0 : 1);
  const cell = (muscle: Muscle, week: number) => ({
    muscle: muscleLabels[muscle],
    day: shortDay(volume.weeks[week], locale),
    sets: sets(volume.sets[muscle]?.[week] ?? 0),
  });
  return (
    <View className="gap-3">
      <View className="gap-1">
        {rows.map((muscle) => (
          <View key={muscle} className="flex-row items-center gap-2">
            {/* A share of the width, not a fixed one: labels wrap at +40% text and the columns stay aligned. */}
            <Text variant="small" className="w-1/3">
              {muscleLabels[muscle]}
            </Text>
            <View className="flex-1 flex-row gap-0.5">
              {volume.weeks.map((week, i) => {
                const bin = binFor(volume.sets[muscle]?.[i] ?? 0);
                const selected = picked?.muscle === muscle && picked.week === i;
                return (
                  <Pressable
                    key={week}
                    accessibilityRole="button"
                    accessibilityLabel={t("heatmapCell", cell(muscle, i))}
                    accessibilityState={{ selected }}
                    onPress={() => setPicked(selected ? null : { muscle, week: i })}
                    hitSlop={2}
                    className="h-6 flex-1"
                  >
                    {/* The fill fades by opacity on its own layer, so the selection outline never fades with it. */}
                    <View
                      className={
                        bin
                          ? "absolute inset-0 rounded-mark bg-tint"
                          : "absolute inset-0 rounded-mark border border-border"
                      }
                      style={bin ? { opacity: bin.opacity } : undefined}
                    />
                    {selected && (
                      <View className="absolute inset-0 rounded-mark border-2 border-foreground" />
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
        <View className="flex-row gap-2">
          <View className="w-1/3" />
          <View className="flex-1 flex-row justify-between gap-2">
            <Text variant="readoutXS" tone="muted">
              {shortDay(volume.weeks[0], locale)}
            </Text>
            {last > 0 && (
              <Text variant="readoutXS" tone="muted">
                {t("thisWeek")}
              </Text>
            )}
          </View>
        </View>
      </View>
      <Note accessibilityLiveRegion="polite">
        {picked ? t("heatmapReadout", cell(picked.muscle, picked.week)) : t("heatmapHint")}
      </Note>
      <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
        {bins.map((b) => (
          <View key={b.min} className="flex-row items-center gap-1">
            <View className="size-3 rounded-mark bg-tint" style={{ opacity: b.opacity }} />
            <Text variant="caption" tone="muted">
              {b.max ? format.range(b.min, b.max) : t("nOrMore", { n: format.number(b.min) })}
            </Text>
          </View>
        ))}
        <Text variant="caption" tone="muted">
          {t("setsAWeek")}
        </Text>
      </View>
    </View>
  );
}
