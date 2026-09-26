import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { useThemeColor } from "heroui-native";
import {
  SystemButton,
  SystemIcon,
  SystemLabel,
  SystemPanel,
  SystemText as Text,
} from "@/components/system";
import { Screen } from "@/components/ui";
import {
  frequentExercises,
  recordTimeline,
  strengthSeries,
  weeklyVolume,
  type WeekTotals,
} from "@/lib/analytics";
import { useQuery } from "@/lib/data";
import { useExercises } from "@/lib/exercise-store";
import { estimateText, loadText, totalText, weightText } from "@/lib/format";
import { dayOf, shortDay, weightTrend } from "@/lib/metrics";
import { useStore } from "@/lib/store";
import { Sparkline } from "./chart";
import { MuscleHeatmap } from "./muscle-heatmap";

const WEEKS = 8;

function Delta({
  now,
  before,
  format,
}: {
  now: number;
  before: number;
  format: (n: number) => string;
}) {
  if (!before && !now) return <Text className="text-xs text-muted">–</Text>;
  const diff = now - before;
  return (
    <Text className="text-xs text-muted" numberOfLines={1}>
      {diff === 0 ? "Same" : `${diff > 0 ? "+" : "−"}${format(Math.abs(diff))}`}
    </Text>
  );
}

function WeekTiles({ current, previous }: { current: WeekTotals; previous: WeekTotals }) {
  const { units } = useStore();
  const tiles = [
    { label: "Workouts", now: current.workouts, before: previous.workouts, format: String },
    { label: "Sets", now: current.sets, before: previous.sets, format: String },
    {
      label: "Volume",
      now: current.volumeKg,
      before: previous.volumeKg,
      format: (n: number) => totalText(n, units),
    },
  ];
  return (
    <View className="flex-row gap-3">
      {tiles.map((t) => (
        <SystemPanel key={t.label} className="flex-1 gap-1 p-4">
          <SystemLabel>{t.label}</SystemLabel>
          <Text className="font-mono text-xl" numberOfLines={1} adjustsFontSizeToFit>
            {t.format(t.now)}
          </Text>
          <Delta now={t.now} before={t.before} format={t.format} />
        </SystemPanel>
      ))}
    </View>
  );
}

export function ProgressScreen() {
  const { units, language, weights } = useStore();
  const { byId } = useExercises();
  const hue = String(useThemeColor("accent-soft-foreground"));
  const data = useQuery(() => {
    const volume = weeklyVolume(WEEKS, byId);
    const strength = frequentExercises().map((id) => {
      const exercise = byId(id);
      return { exercise, series: strengthSeries(exercise).slice(-12) };
    });
    const records = recordTimeline(byId).slice(-8).reverse();
    return { volume, strength, records };
  }, [byId]);
  const trend = weightTrend(weights).slice(-30);
  const { volume, strength, records } = data;
  const current = volume.totals[WEEKS - 1];
  const previous = volume.totals[WEEKS - 2];

  return (
    <Screen title="Progress">
      <View className="gap-2">
        <SystemLabel>This week · change from last week</SystemLabel>
        <WeekTiles current={current} previous={previous} />
      </View>

      <SystemPanel className="gap-3">
        <SystemLabel>Sets per muscle · {WEEKS} weeks</SystemLabel>
        <MuscleHeatmap volume={volume} />
      </SystemPanel>

      <View className="gap-2">
        <SystemLabel>Strength · estimated 1RM</SystemLabel>
        {!strength.length && (
          <Text className="text-muted">Your most-trained lifts show up here.</Text>
        )}
        {strength.map(({ exercise, series }) => {
          const last = series.at(-1);
          const first = series[0];
          const change = last && first && series.length > 1 ? last.e1rmKg - first.e1rmKg : 0;
          return (
            <Pressable
              key={exercise.id}
              accessibilityRole="button"
              accessibilityLabel={`${exercise.name}, estimated 1RM ${last ? estimateText(last.e1rmKg, units) : "none"}`}
              onPress={() =>
                router.push({ pathname: "/exercise/[id]", params: { id: exercise.id } })
              }
              className="flex-row items-center gap-3 rounded-2xl bg-surface p-4 active:opacity-70"
            >
              <View className="flex-1 gap-0.5">
                <Text className="font-medium" numberOfLines={1}>
                  {exercise.name}
                </Text>
                <Text className="font-mono text-sm text-muted" numberOfLines={1}>
                  {last ? estimateText(last.e1rmKg, units) : "–"}
                  {series.length > 1 && Math.abs(change) >= 0.5
                    ? `  ${change > 0 ? "+" : "−"}${estimateText(Math.abs(change), units)}`
                    : ""}
                </Text>
              </View>
              <View className="w-24">
                <Sparkline
                  points={series.map((p) => ({ day: p.day, value: p.e1rmKg }))}
                  color={hue}
                  minSpan={5}
                />
              </View>
            </Pressable>
          );
        })}
      </View>

      <View className="gap-2">
        <SystemLabel>Recent records</SystemLabel>
        {!records.length && (
          <Text className="text-muted">Beat an earlier session and it lands here.</Text>
        )}
        {records.map((r) => (
          <Pressable
            key={`${r.workoutId}-${r.exerciseId}-${r.kind}`}
            accessibilityRole="button"
            onPress={() =>
              router.push({ pathname: "/session/[id]", params: { id: String(r.workoutId) } })
            }
            className="flex-row items-center gap-3 border-b border-separator py-2 active:opacity-60"
          >
            <SystemIcon name="trophy-outline" size={18} color="success" />
            <View className="flex-1">
              <Text className="text-sm font-medium" numberOfLines={1}>
                {byId(r.exerciseId).name}
              </Text>
              <Text className="text-sm text-muted" numberOfLines={1}>
                {shortDay(r.day, language)} · {r.kind === "e1rm" ? "est. 1RM" : "heaviest"}{" "}
                {r.kind === "e1rm" ? estimateText(r.valueKg, units) : loadText(r.valueKg, units)}{" "}
                (was{" "}
                {r.kind === "e1rm"
                  ? estimateText(r.previousKg, units)
                  : loadText(r.previousKg, units)}
                )
              </Text>
            </View>
          </Pressable>
        ))}
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/weight")}
        className="flex-row items-center gap-3 rounded-2xl bg-surface p-4 active:opacity-70"
      >
        <View className="flex-1 gap-1">
          <SystemLabel>Body weight</SystemLabel>
          <Text className="text-lg font-semibold">
            {weights[0] ? weightText(weights[0].weightKg, units) : "Add a weight"}
          </Text>
          {trend.length > 1 && (
            <Text className="text-xs text-muted">
              Trend {weightText(trend.at(-1)!.trend, units)} ·{" "}
              {shortDay(dayOf(trend[0].day), language)} to now
            </Text>
          )}
        </View>
        {trend.length > 1 && (
          <View className="w-24">
            <Sparkline
              points={trend.map((p) => ({ day: p.day, value: p.trend }))}
              color={hue}
              minSpan={1}
            />
          </View>
        )}
        <SystemIcon name="chevron-forward" color="muted" />
      </Pressable>

      <SystemButton variant="secondary" icon="time-outline" onPress={() => router.push("/history")}>
        All workouts
      </SystemButton>
    </Screen>
  );
}
