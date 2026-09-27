import { useMemo } from "react";
import { Alert, View } from "react-native";
import { router, Stack } from "expo-router";
import { useThemeColor } from "heroui-native";
import {
  SystemButton,
  SystemIcon,
  SystemLabel,
  SystemPanel,
  SystemText as Text,
} from "@/components/system";
import { Screen } from "@/components/ui";
import { syncHealthSoon } from "@/lib/health-schedule";
import { MuscleFeedback } from "./muscle-feedback";
import { SessionNote } from "./session-note";
import { write, useQuery } from "@/lib/data";
import { useExercises } from "@/lib/exercise-store";
import { dayLabel, duration, estimateText, loadText, setText, totalText } from "@/lib/format";
import { useStore } from "@/lib/store";
import { countsAsWork } from "@/lib/strength";
import {
  activeWorkout,
  discardWorkout,
  startWorkout,
  trainingGym,
  workoutDetail,
  workoutRecords,
} from "@/lib/workouts";

export function SessionScreen({ id, finished }: { id: number; finished: boolean }) {
  const { units, locale } = useStore();
  const { byId } = useExercises();
  const background = useThemeColor("background");
  const foreground = useThemeColor("foreground");
  const detail = useQuery(() => {
    return workoutDetail(id);
  }, [id]);
  const records = useMemo(() => (detail ? workoutRecords(detail) : []), [detail]);
  if (!detail) return null;
  const work = detail.exercises.flatMap((b) => b.sets).filter((s) => countsAsWork(s.kind));
  const volume = work.reduce((sum, s) => sum + (s.weightKg ?? 0) * (s.reps ?? 0), 0);
  const title = detail.name || "Workout";
  const show = (kind: "e1rm" | "weight", kg: number) =>
    kind === "e1rm" ? estimateText(kg, units) : loadText(kg, units);
  return (
    <Screen title={title} nativeHeader>
      <Stack.Screen
        options={{
          headerShown: true,
          title: finished ? "Workout done" : dayLabel(detail.startedAt, locale),
          headerBackButtonDisplayMode: "minimal",
          headerStyle: { backgroundColor: background },
          headerTintColor: foreground,
          contentStyle: { backgroundColor: background },
        }}
      />
      <View className="flex-row gap-3">
        {[
          ["Time", duration(detail.startedAt, detail.endedAt)],
          ["Sets", String(work.length)],
          ["Volume", totalText(volume, units)],
        ].map(([label, value]) => (
          <SystemPanel key={label} className="flex-1 gap-1 p-4">
            <SystemLabel>{label}</SystemLabel>
            <Text className="font-mono text-lg" numberOfLines={1} adjustsFontSizeToFit>
              {value}
            </Text>
          </SystemPanel>
        ))}
      </View>

      {records.length > 0 && (
        <SystemPanel className="gap-2 bg-success-soft">
          <View className="flex-row items-center gap-2">
            <SystemIcon name="trophy" color="success" />
            <Text className="font-semibold text-success-soft-foreground">
              {records.length === 1 ? "New record" : `${records.length} new records`}
            </Text>
          </View>
          {records.map((r) => (
            <Text key={`${r.exerciseId}-${r.kind}`} className="text-sm">
              {byId(r.exerciseId).name}: {r.kind === "e1rm" ? "est. 1RM" : "heaviest"}{" "}
              {show(r.kind, r.valueKg)} (was {show(r.kind, r.previousKg)})
            </Text>
          ))}
        </SystemPanel>
      )}

      {detail.mesoId !== null && !detail.deload && <MuscleFeedback detail={detail} />}

      <SessionNote key={detail.id} detail={detail} />

      {detail.exercises.map((block) => (
        <View key={block.id} className="gap-1">
          <Text className="font-semibold">{byId(block.exerciseId).name}</Text>
          {block.sets.map((s, i) => (
            <Text key={s.id} className="font-mono text-sm text-muted">
              {s.kind === "warmup" ? "W" : s.kind === "drop" ? "D" : s.kind === "myo" ? "M" : i + 1}
              {"  "}
              {setText(s, units)}
            </Text>
          ))}
        </View>
      ))}

      <View className="gap-2">
        {detail.mesoId === null && (
          <SystemButton
            variant="secondary"
            icon="repeat"
            isDisabled={!!activeWorkout()}
            onPress={() => {
              const { gym, travel } = trainingGym(units, detail.gymId);
              write(() => startWorkout({ gymId: gym.id, travel, from: detail.id }));
              router.replace("/workout");
            }}
          >
            Repeat this workout
          </SystemButton>
        )}
        <SystemButton
          variant="ghost"
          icon="pencil"
          onPress={() => router.push({ pathname: "/workout", params: { id: String(detail.id) } })}
        >
          Edit
        </SystemButton>
        <SystemButton
          variant="danger-soft"
          icon="trash-outline"
          onPress={() =>
            Alert.alert("Delete workout?", "This can't be undone.", [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: () => {
                  write(() => discardWorkout(detail.id));
                  void syncHealthSoon();
                  router.back();
                },
              },
            ])
          }
        >
          Delete workout
        </SystemButton>
      </View>
    </Screen>
  );
}
