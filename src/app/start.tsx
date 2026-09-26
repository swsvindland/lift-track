import { useEffect, useRef } from "react";
import { ActivityIndicator, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { write } from "@/lib/data";
import { useExercises } from "@/lib/exercise-store";
import { activeMeso, nextSession, programDetail, startSession } from "@/lib/programs";
import { useStore } from "@/lib/store";
import { activeGym, activeWorkout, startWorkout } from "@/lib/workouts";

/**
 * lifttrack://start (a quick action, Shortcuts or the Action Button): resume the open workout,
 * else start the program's next session, else an empty workout. `?empty=1` skips the program.
 */
export default function Start() {
  const { empty } = useLocalSearchParams<{ empty?: string }>();
  const { units, weights } = useStore();
  const { byId } = useExercises();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!activeWorkout()) {
      const meso = empty ? undefined : activeMeso();
      const detail = meso ? programDetail(meso.id) : undefined;
      const next = detail ? nextSession(detail) : undefined;
      const gym = activeGym(units);
      write(() =>
        detail && next
          ? startSession(detail, next.week, next.dayId, {
              gym,
              bodyWeightKg: weights[0]?.weightKg ?? null,
              byId,
            })
          : startWorkout({ gymId: gym.id })
      );
    }
    router.replace("/workout");
  }, [empty, units, weights, byId]);
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <ActivityIndicator />
    </View>
  );
}
