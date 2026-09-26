import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import {
  MiniBar,
  SystemButton,
  SystemIcon,
  SystemLabel,
  SystemPanel,
  SystemText as Text,
} from "@/components/system";
import { Screen } from "@/components/ui";
import { write, useQuery } from "@/lib/data";
import { muscleLabels } from "@/lib/exercises";
import type { Muscle } from "@/lib/exercises/types";
import { useExercises } from "@/lib/exercise-store";
import { dayLabel, duration, loadText, rirText } from "@/lib/format";
import { activeMeso, isDeloadWeek, nextSession, programDetail, weekRir } from "@/lib/programs";
import { useStartSession } from "@/components/plan/use-start-session";
import { useStore } from "@/lib/store";
import { setsPerMuscle, weekStart } from "@/lib/volume";
import {
  activeGym,
  activeWorkout,
  finishedWorkouts,
  startWorkout,
  workoutDetail,
  workoutsBetween,
} from "@/lib/workouts";

/** Refreshes elapsed time once a minute while a workout is open. */
function useMinuteClock(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(timer);
  }, [active]);
}

export function TodayScreen() {
  const { units, weights, locale } = useStore();
  const { byId } = useExercises();
  const data = useQuery(() => {
    const open = activeWorkout();
    const openDetail = open ? workoutDetail(open.id) : undefined;
    const start = weekStart();
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    const week = workoutsBetween(start.toISOString(), end.toISOString());
    // Recent workouts to repeat, one per distinct name or exercise list.
    const seen = new Set<string>();
    const repeat = finishedWorkouts(30)
      .filter((w) => {
        const key = w.name || w.exerciseIds.join(",");
        if (!w.exerciseIds.length || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 4);
    const meso = activeMeso();
    const program = meso ? programDetail(meso.id) : undefined;
    const next = program ? nextSession(program) : undefined;
    return { open, openDetail, week, repeat, program, next };
  }, []);
  useMinuteClock(!!data.open);

  const weekly = setsPerMuscle(data.week, byId);
  const muscles = (Object.entries(weekly) as [Muscle, number][])
    .filter(([, sets]) => sets > 0)
    .sort((a, b) => b[1] - a[1]);
  const maxSets = Math.max(10, ...muscles.map(([, s]) => s));
  const openSets = data.openDetail?.exercises.flatMap((b) => b.sets) ?? [];
  const done = openSets.filter((s) => s.completedAt).length;

  const startProgramSession = useStartSession();
  const begin = (from?: number) => {
    write(() => startWorkout({ gymId: activeGym(units).id, from }));
    router.push("/workout");
  };

  return (
    <Screen
      title="Today"
      subtitle={new Date().toLocaleDateString(locale, {
        weekday: "long",
        month: "long",
        day: "numeric",
      })}
    >
      {data.open ? (
        <SystemPanel className="gap-3 bg-accent-soft">
          <SystemLabel className="text-accent-soft-foreground">Workout in progress</SystemLabel>
          <Text className="text-xl font-semibold">
            {data.open.name || "Workout"} · {duration(data.open.startedAt)}
          </Text>
          <Text className="text-muted">
            {done} of {openSets.length} sets done
          </Text>
          <SystemButton icon="play" onPress={() => router.push("/workout")}>
            Resume
          </SystemButton>
        </SystemPanel>
      ) : data.program && data.next ? (
        <SystemPanel className="gap-3 bg-accent-soft">
          <SystemLabel className="text-accent-soft-foreground">
            {data.program.name} ·{" "}
            {isDeloadWeek(data.program, data.next.week) ? "Deload" : `Week ${data.next.week + 1}`}
          </SystemLabel>
          <Text className="text-xl font-semibold">
            {data.program.days.find((d) => d.id === data.next!.dayId)?.name}
          </Text>
          <Text className="text-muted">
            {rirText(weekRir(data.program, data.next.week))} on every set
          </Text>
          <SystemButton
            icon="play"
            onPress={() => startProgramSession(data.program!, data.next!.week, data.next!.dayId)}
          >
            Start
          </SystemButton>
          <SystemButton variant="ghost" onPress={() => begin()}>
            Empty workout instead
          </SystemButton>
        </SystemPanel>
      ) : (
        <SystemButton icon="add" onPress={() => begin()}>
          Start workout
        </SystemButton>
      )}

      {!data.open && !data.program && data.repeat.length > 0 && (
        <View className="gap-2">
          <SystemLabel>Repeat</SystemLabel>
          {data.repeat.map((w) => (
            <Pressable
              key={w.id}
              accessibilityRole="button"
              accessibilityLabel={`Repeat ${w.name || "workout"} from ${dayLabel(w.startedAt, locale)}`}
              onPress={() => begin(w.id)}
              className="flex-row items-center gap-3 rounded-2xl bg-surface p-4 active:opacity-70"
            >
              <View className="flex-1 gap-1">
                <Text className="font-semibold" numberOfLines={1}>
                  {w.name ||
                    w.exerciseIds
                      .slice(0, 3)
                      .map((id) => byId(id).name)
                      .join(", ")}
                </Text>
                <Text className="text-sm text-muted" numberOfLines={1}>
                  {dayLabel(w.startedAt, locale)} · {w.exerciseIds.length} exercises · {w.setCount}{" "}
                  sets
                </Text>
              </View>
              <SystemIcon name="repeat" color="muted" />
            </Pressable>
          ))}
        </View>
      )}

      <SystemPanel className="gap-3">
        <View className="flex-row items-baseline justify-between">
          <SystemLabel>This week</SystemLabel>
          <Text className="text-sm text-muted">
            {data.week.length} {data.week.length === 1 ? "workout" : "workouts"}
          </Text>
        </View>
        {muscles.length ? (
          muscles.map(([muscle, sets]) => (
            <View key={muscle} className="gap-1">
              <View className="flex-row justify-between">
                <Text className="text-sm">{muscleLabels[muscle]}</Text>
                <Text className="font-mono text-sm tabular-nums text-muted">
                  {Math.round(sets * 10) / 10} {sets === 1 ? "set" : "sets"}
                </Text>
              </View>
              <MiniBar value={sets} max={maxSets} />
            </View>
          ))
        ) : (
          <Text className="text-muted">Sets per muscle show up here as you train.</Text>
        )}
      </SystemPanel>

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/weight")}
        className="flex-row items-center justify-between rounded-2xl bg-surface p-4 active:opacity-70"
      >
        <View className="gap-1">
          <SystemLabel>Body weight</SystemLabel>
          <Text className="text-lg font-semibold">
            {weights[0] ? loadText(weights[0].weightKg, units) : "Add a weight"}
          </Text>
        </View>
        <SystemIcon name="chevron-forward" color="muted" />
      </Pressable>
    </Screen>
  );
}
