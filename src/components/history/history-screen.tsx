import { useState } from "react";
import { Pressable, View } from "react-native";
import { router, Stack } from "expo-router";
import { useThemeColor } from "heroui-native";
import { SystemButton, SystemIcon, SystemLabel, SystemText as Text } from "@/components/system";
import { Screen } from "@/components/ui";
import { useQuery } from "@/lib/data";
import { useExercises } from "@/lib/exercise-store";
import { dayLabel, duration } from "@/lib/format";
import { useStore } from "@/lib/store";
import { weekStart } from "@/lib/volume";
import { finishedWorkouts, type WorkoutSummary } from "@/lib/workouts";

export function HistoryScreen() {
  const { locale } = useStore();
  const { byId } = useExercises();
  const [limit, setLimit] = useState(40);
  const background = useThemeColor("background");
  const foreground = useThemeColor("foreground");
  const list = useQuery(() => {
    return finishedWorkouts(limit + 1);
  }, [limit]);
  const weeks = new Map<string, WorkoutSummary[]>();
  for (const w of list.slice(0, limit)) {
    const key = weekStart(new Date(w.startedAt)).toISOString();
    weeks.set(key, [...(weeks.get(key) ?? []), w]);
  }
  return (
    <Screen title="History" nativeHeader>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "All workouts",
          headerBackButtonDisplayMode: "minimal",
          headerStyle: { backgroundColor: background },
          headerTintColor: foreground,
          contentStyle: { backgroundColor: background },
        }}
      />
      {!list.length && (
        <Text className="py-8 text-center text-muted">Finished workouts show up here.</Text>
      )}
      {[...weeks].map(([week, items]) => (
        <View key={week} className="gap-2">
          <SystemLabel>
            Week of {new Date(week).toLocaleDateString(locale, { month: "short", day: "numeric" })}{" "}
            · {items.length} {items.length === 1 ? "workout" : "workouts"}
          </SystemLabel>
          {items.map((w) => (
            <Pressable
              key={w.id}
              accessibilityRole="button"
              onPress={() =>
                router.push({ pathname: "/session/[id]", params: { id: String(w.id) } })
              }
              className="flex-row items-center gap-3 rounded-2xl bg-surface p-4 active:opacity-70"
            >
              <View className="flex-1 gap-1">
                <Text className="font-semibold" numberOfLines={1}>
                  {w.name || dayLabel(w.startedAt, locale)}
                </Text>
                <Text className="text-sm text-muted" numberOfLines={1}>
                  {w.name ? `${dayLabel(w.startedAt, locale)} · ` : ""}
                  {duration(w.startedAt, w.endedAt)} · {w.setCount} sets
                </Text>
                <Text className="text-sm text-muted" numberOfLines={1}>
                  {[...new Set(w.exerciseIds)].map((id) => byId(id).name).join(", ")}
                </Text>
              </View>
              <SystemIcon name="chevron-forward" color="muted" />
            </Pressable>
          ))}
        </View>
      ))}
      {list.length > limit && (
        <SystemButton variant="ghost" onPress={() => setLimit(limit + 40)}>
          Show older
        </SystemButton>
      )}
    </Screen>
  );
}
