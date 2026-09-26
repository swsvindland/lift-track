import { useState } from "react";
import { Pressable, View } from "react-native";
import { router, Stack } from "expo-router";
import { Switch, useThemeColor } from "heroui-native";
import { SystemButton, SystemLabel, SystemPanel, SystemText as Text } from "@/components/system";
import { Screen, SettingsSelect } from "@/components/ui";
import { useQuery } from "@/lib/data";
import { equipmentLabels, muscleLabels } from "@/lib/exercises";
import type { Muscle } from "@/lib/exercises/types";
import { archiveCustomExercise, saveExerciseSetting, useExercises } from "@/lib/exercise-store";
import { dayLabel, loadText, setText } from "@/lib/format";
import { defaultRest, formatClock } from "@/lib/rest-timer";
import { useStore } from "@/lib/store";
import { countsAsWork, e1rm } from "@/lib/strength";
import { exerciseHistory } from "@/lib/workouts";
import { CustomExerciseEditor } from "./custom-exercise-editor";

const restChoices = ["default", "60", "90", "120", "150", "180", "240", "300"] as const;

export function ExerciseScreen({ id }: { id: string }) {
  const { units, locale } = useStore();
  const { byId, settingFor } = useExercises();
  const background = useThemeColor("background");
  const foreground = useThemeColor("foreground");
  const [editing, setEditing] = useState(false);
  const exercise = byId(id);
  const setting = settingFor(id);
  const history = useQuery(() => {
    return exerciseHistory(id, { limit: 100 });
  }, [id]);
  const best = history
    .flatMap((p) => p.sets.filter((s) => countsAsWork(s.kind)).map((s) => ({ s, p })))
    .reduce<{ value: number; day: string } | null>((top, { s, p }) => {
      const value = e1rm(s.weightKg ?? 0, s.reps ?? 0, s.rir);
      return value > (top?.value ?? 0) ? { value, day: p.startedAt } : top;
    }, null);
  const muscles = Object.entries(exercise.muscles) as [Muscle, number][];
  const rest = setting?.restSeconds ? String(setting.restSeconds) : "default";

  return (
    <Screen title={exercise.name} nativeHeader>
      <Stack.Screen
        options={{
          headerShown: true,
          title: exercise.name,
          headerBackButtonDisplayMode: "minimal",
          headerStyle: { backgroundColor: background },
          headerTintColor: foreground,
          contentStyle: { backgroundColor: background },
        }}
      />
      <View className="gap-1">
        <Text className="text-muted">
          {equipmentLabels[exercise.equipment]}
          {exercise.unilateral ? " · one side at a time" : ""} · {exercise.reps[0]}–
          {exercise.reps[1]} reps
        </Text>
        <Text>
          {muscles
            .sort((a, b) => b[1] - a[1])
            .map(([m, w]) => `${muscleLabels[m]}${w === 0.5 ? " (½)" : ""}`)
            .join(", ")}
        </Text>
        {!!exercise.cue && <Text className="pt-2 text-muted">{exercise.cue}</Text>}
      </View>

      {best && (
        <SystemPanel className="gap-1">
          <SystemLabel>Best estimated 1RM</SystemLabel>
          <Text className="font-mono text-2xl">{loadText(best.value, units)}</Text>
          <Text className="text-sm text-muted">{dayLabel(best.day, locale)}</Text>
        </SystemPanel>
      )}

      <SystemPanel className="gap-4">
        <View className="flex-row items-center justify-between">
          <Text>Favorite</Text>
          <Switch
            accessibilityLabel="Favorite"
            isSelected={!!setting?.favorite}
            onSelectedChange={(favorite) => saveExerciseSetting(id, { favorite })}
          />
        </View>
        <View className="gap-1">
          <View className="flex-row items-center justify-between">
            <Text>Avoid</Text>
            <Switch
              accessibilityLabel="Avoid"
              isSelected={!!setting?.avoid}
              onSelectedChange={(avoid) => saveExerciseSetting(id, { avoid })}
            />
          </View>
          <Text className="text-sm text-muted">
            Left out of swap suggestions, e.g. when it hurts.
          </Text>
        </View>
        <View className="gap-2">
          <SystemLabel>Rest after a set</SystemLabel>
          <SettingsSelect
            title="Rest"
            values={restChoices}
            value={
              restChoices.includes(rest as never)
                ? (rest as (typeof restChoices)[number])
                : "default"
            }
            onChange={(value) =>
              saveExerciseSetting(id, { restSeconds: value === "default" ? null : Number(value) })
            }
            label={(value) =>
              value === "default"
                ? `Default (${formatClock(defaultRest(exercise))})`
                : formatClock(Number(value))
            }
          />
        </View>
      </SystemPanel>

      <View className="gap-2">
        <SystemLabel>History</SystemLabel>
        {!history.length && <Text className="text-muted">Not done yet.</Text>}
        {history.map((p) => (
          <Pressable
            key={p.block.id}
            accessibilityRole="button"
            onPress={() =>
              router.push({ pathname: "/session/[id]", params: { id: String(p.workoutId) } })
            }
            className="gap-1 border-b border-separator py-2 active:opacity-60"
          >
            <Text className="text-sm font-medium">{dayLabel(p.startedAt, locale)}</Text>
            <Text className="font-mono text-sm text-muted">
              {p.sets
                .filter((s) => countsAsWork(s.kind))
                .map((s) => setText(s, units))
                .join(",  ")}
            </Text>
          </Pressable>
        ))}
      </View>

      {exercise.custom && (
        <View className="gap-2">
          <SystemButton variant="secondary" icon="pencil" onPress={() => setEditing(true)}>
            Edit exercise
          </SystemButton>
          <SystemButton
            variant="ghost"
            icon={exercise.archived ? "arrow-undo" : "archive-outline"}
            onPress={() => archiveCustomExercise(id, !exercise.archived)}
          >
            {exercise.archived ? "Restore" : "Archive"}
          </SystemButton>
        </View>
      )}
      <CustomExerciseEditor open={editing} close={() => setEditing(false)} editing={exercise} />
    </Screen>
  );
}
