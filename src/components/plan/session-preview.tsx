import { View } from "react-native";
import { router, Stack } from "expo-router";
import { useThemeColor } from "heroui-native";
import { SystemButton, SystemLabel, SystemPanel, SystemText as Text } from "@/components/system";
import { Screen } from "@/components/ui";
import { useQuery, write } from "@/lib/data";
import { equipmentLabels, muscleLabels } from "@/lib/exercises";
import type { Muscle } from "@/lib/exercises/types";
import { useExercises } from "@/lib/exercise-store";
import { adviceText, loadText, rirText } from "@/lib/format";
import {
  activeMeso,
  isDeloadWeek,
  planSession,
  programDetail,
  programProgress,
  skipSession,
  unskipSession,
  type PlannedExercise,
  type SessionPlan,
} from "@/lib/programs";
import type { Units } from "@/lib/metrics";
import { useStore } from "@/lib/store";
import { activeWorkout, workoutDetail } from "@/lib/workouts";
import { useSessionContext, useStartSession } from "./use-start-session";

const targetText = (set: PlannedExercise["sets"][number], units: Units) =>
  set.weightKg ? `${loadText(set.weightKg, units)} × ${set.reps}` : `${set.reps} reps`;

/** Sets per primary muscle, most first: what the day trains. */
function musclesOf(plan: SessionPlan) {
  const totals = new Map<Muscle, number>();
  for (const { exercise, sets } of plan.exercises)
    for (const [m, w] of Object.entries(exercise.muscles) as [Muscle, number][])
      if (w === 1) totals.set(m, (totals.get(m) ?? 0) + sets.length);
  return [...totals].sort((a, b) => b[1] - a[1]);
}

/**
 * A program session before it starts: every exercise and set target, what it trains and what it
 * needs, to get ready ahead of the gym. Start logs exactly this.
 */
export function SessionPreview({ week, dayId }: { week: number; dayId: number }) {
  const { units, weights } = useStore();
  const { all, byId, settings } = useExercises();
  const background = useThemeColor("background");
  const foreground = useThemeColor("foreground");
  const contextFor = useSessionContext();
  const begin = useStartSession();
  const data = useQuery(() => {
    const meso = activeMeso();
    const detail = meso ? programDetail(meso.id) : undefined;
    const cell = detail?.days.some((d) => d.id === dayId)
      ? programProgress(detail)
          .flat()
          .find((c) => c.week === week && c.dayId === dayId)
      : undefined;
    if (!detail || !cell) return undefined;
    const context = contextFor(detail);
    const open = activeWorkout();
    return {
      detail,
      cell,
      context,
      // A workout with exercises in it has to finish first; an empty one is replaced.
      busy: !!open && !!workoutDetail(open.id)?.exercises.length,
      plan: planSession(detail, week, dayId, context),
    };
  }, [week, dayId, units, weights, all, byId, settings]);

  const header = (
    <Stack.Screen
      options={{
        headerShown: true,
        title: "Preview",
        headerBackButtonDisplayMode: "minimal",
        headerStyle: { backgroundColor: background },
        headerTintColor: foreground,
        contentStyle: { backgroundColor: background },
      }}
    />
  );
  if (!data)
    return (
      <Screen title="Preview" nativeHeader>
        {header}
        <Text className="text-muted">This session isn&apos;t in your program anymore.</Text>
      </Screen>
    );

  const { detail, cell, context, busy, plan } = data;
  const sets = plan.exercises.reduce((n, e) => n + e.sets.length, 0);
  const muscles = musclesOf(plan);
  const equipment = [...new Set(plan.exercises.map((e) => e.exercise.equipment))];
  const start = () => begin(detail, week, dayId, { replace: true });

  const footer =
    cell.state === "open" ? (
      <SystemButton icon="barbell" onPress={() => router.replace("/workout")}>
        Resume
      </SystemButton>
    ) : cell.state === "done" && cell.workoutId ? (
      <SystemButton
        variant="secondary"
        onPress={() =>
          router.replace({ pathname: "/session/[id]", params: { id: String(cell.workoutId) } })
        }
      >
        See what you did
      </SystemButton>
    ) : busy ? (
      <SystemButton icon="barbell" onPress={() => router.replace("/workout")}>
        Resume workout in progress
      </SystemButton>
    ) : cell.state === "skipped" ? (
      <SystemButton
        variant="secondary"
        onPress={() => write(() => unskipSession(detail.id, week, dayId))}
      >
        Unskip
      </SystemButton>
    ) : (
      <View className="flex-row gap-2">
        <SystemButton
          variant="secondary"
          onPress={() => {
            write(() => skipSession(detail.id, week, dayId));
            router.back();
          }}
        >
          Skip
        </SystemButton>
        <SystemButton icon="play" className="flex-1" onPress={start}>
          Start
        </SystemButton>
      </View>
    );

  return (
    <Screen title={plan.day.name} nativeHeader footer={footer}>
      {header}
      <View className="gap-1">
        <SystemLabel>
          {detail.name} · {isDeloadWeek(detail, week) ? "Deload" : `Week ${week + 1}`}
        </SystemLabel>
        <Text accessibilityRole="header" className="text-3xl font-semibold">
          {plan.day.name}
        </Text>
        <Text className="text-muted">
          {rirText(plan.rir)} on every set
          {context.gym ? ` · At ${context.gym.name}` : ""}
          {context.travel ? ", with stand-ins for what it doesn't have" : ""}
        </Text>
      </View>

      {busy && cell.state !== "open" && (
        <Text className="text-sm text-warning">
          Another workout is in progress. Finish it to start this one.
        </Text>
      )}
      {cell.state === "upcoming" && (
        <Text className="text-sm text-muted">
          Not next yet: targets can still change with what you log before then.
        </Text>
      )}
      {cell.state === "skipped" && (
        <Text className="text-sm text-muted">You skipped this session.</Text>
      )}

      <View className="flex-row gap-3">
        {[
          ["Exercises", String(plan.exercises.length)],
          ["Sets", String(sets)],
        ].map(([label, value]) => (
          <SystemPanel key={label} className="flex-1 gap-1 p-4">
            <SystemLabel>{label}</SystemLabel>
            <Text className="font-mono text-lg">{value}</Text>
          </SystemPanel>
        ))}
      </View>

      <SystemPanel className="gap-3">
        <View className="gap-1">
          <SystemLabel>Trains</SystemLabel>
          <Text>
            {muscles.map(([m, n]) => `${muscleLabels[m]} ${n}`).join(" · ") || "Nothing counted"}
          </Text>
        </View>
        <View className="gap-1">
          <SystemLabel>Equipment</SystemLabel>
          <Text>{equipment.map((e) => equipmentLabels[e]).join(", ")}</Text>
        </View>
      </SystemPanel>

      {plan.exercises.map(({ slot, exercise, reps, advice, sets: targets }) => {
        const why = adviceText(advice, units);
        return (
          <View key={slot.id} className="gap-1">
            <Text className="font-semibold">{exercise.name}</Text>
            {exercise.id !== slot.exerciseId && (
              <Text className="text-sm text-muted">Stands in for {byId(slot.exerciseId).name}</Text>
            )}
            <Text className="text-sm text-muted">
              {targets.length} {targets.length === 1 ? "set" : "sets"} · {reps[0]}–{reps[1]} reps
            </Text>
            {targets.map((s, i) => (
              <Text key={i} className="font-mono text-sm">
                {i + 1}
                {"  "}
                {targetText(s, units)}
              </Text>
            ))}
            {!!why && <Text className="text-sm text-muted">{why}</Text>}
          </View>
        );
      })}
    </Screen>
  );
}
