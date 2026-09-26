import { useState } from "react";
import { Pressable, View } from "react-native";
import { useThemeColor } from "heroui-native";
import { SystemText as Text } from "@/components/system";
import { muscleLabels } from "@/lib/exercises";
import { muscles as allMuscles, type Muscle } from "@/lib/exercises/types";
import { shortDay } from "@/lib/metrics";
import { useStore } from "@/lib/store";
import type { WeeklyVolume } from "@/lib/analytics";

/** Weekly hard sets, binned; one hue from light to dark so more always reads as darker. */
const bins = [
  { min: 1, label: "1–4", opacity: 0.18 },
  { min: 5, label: "5–9", opacity: 0.38 },
  { min: 10, label: "10–14", opacity: 0.6 },
  { min: 15, label: "15–19", opacity: 0.8 },
  { min: 20, label: "20+", opacity: 1 },
];
const binFor = (sets: number) => [...bins].reverse().find((b) => sets >= b.min);
const round = (n: number) => Math.round(n * 10) / 10;

/** Muscles down, weeks across; tap a cell for its number. */
export function MuscleHeatmap({ volume }: { volume: WeeklyVolume }) {
  const { language } = useStore();
  const [hue, border] = useThemeColor(["accent-soft-foreground", "border"]);
  const [picked, setPicked] = useState<{ muscle: Muscle; week: number } | null>(null);
  const rows = allMuscles.filter((m) => volume.sets[m]?.some((v) => v > 0));
  if (!rows.length)
    return <Text className="text-muted">Sets per muscle show up here as you train.</Text>;
  const last = volume.weeks.length - 1;
  const readout = picked
    ? `${muscleLabels[picked.muscle]} · week of ${shortDay(volume.weeks[picked.week], language)} · ${round(volume.sets[picked.muscle]?.[picked.week] ?? 0)} sets`
    : "Tap a square for its number.";
  return (
    <View className="gap-3">
      <View className="gap-1">
        {rows.map((muscle) => (
          <View key={muscle} className="flex-row items-center gap-2">
            <Text className="w-24 text-sm" numberOfLines={1}>
              {muscleLabels[muscle]}
            </Text>
            <View className="flex-1 flex-row gap-0.5">
              {volume.weeks.map((week, i) => {
                const sets = volume.sets[muscle]?.[i] ?? 0;
                const bin = binFor(sets);
                const selected = picked?.muscle === muscle && picked.week === i;
                return (
                  <Pressable
                    key={week}
                    accessibilityRole="button"
                    accessibilityLabel={`${muscleLabels[muscle]}, week of ${shortDay(week, language)}, ${round(sets)} sets`}
                    onPress={() => setPicked(selected ? null : { muscle, week: i })}
                    hitSlop={2}
                    className="h-6 flex-1 rounded-sm"
                    style={{
                      backgroundColor: bin ? String(hue) : "transparent",
                      opacity: bin ? bin.opacity : 1,
                      borderWidth: bin ? 0 : 1,
                      borderColor: String(border),
                    }}
                  >
                    {selected && (
                      <View className="absolute inset-0 rounded-sm border-2 border-foreground" />
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
        <View className="flex-row gap-2">
          <View className="w-24" />
          <View className="flex-1 flex-row justify-between">
            <Text className="font-mono text-xs text-muted">
              {shortDay(volume.weeks[0], language)}
            </Text>
            <Text className="font-mono text-xs text-muted">{last > 0 ? "This week" : ""}</Text>
          </View>
        </View>
      </View>
      <Text className="text-sm text-muted" accessibilityLiveRegion="polite">
        {readout}
      </Text>
      <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
        {bins.map((b) => (
          <View key={b.label} className="flex-row items-center gap-1">
            <View
              className="h-3 w-3 rounded-sm"
              style={{ backgroundColor: String(hue), opacity: b.opacity }}
            />
            <Text className="text-xs text-muted">{b.label}</Text>
          </View>
        ))}
        <Text className="text-xs text-muted">sets a week</Text>
      </View>
    </View>
  );
}
