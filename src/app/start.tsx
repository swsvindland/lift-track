import { useEffect, useRef } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { write } from "@/lib/data";
import { useExercises } from "@/lib/exercise-store";
import { activeMeso, nextSession, programDetail, startSession } from "@/lib/programs";
import { useStore } from "@/lib/store";
import { activeWorkout, startWorkout, trainingGym } from "@/lib/workouts";

/**
 * lifttrack://start (a quick action, Shortcuts or the Action Button): resume the open workout,
 * else start the program's next session, else an empty workout. `?empty=1` skips the program.
 */
export default function Start() {
  const { empty } = useLocalSearchParams<{ empty?: string }>();
  const { units, weights } = useStore();
  const { all, byId, settings } = useExercises();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!activeWorkout()) {
      const meso = empty ? undefined : activeMeso();
      const detail = meso ? programDetail(meso.id) : undefined;
      const next = detail ? nextSession(detail) : undefined;
      // A program session runs at the program's gym; a free workout at your main one.
      const { gym, travel } = trainingGym(units, next ? detail?.gymId : undefined);
      write(() =>
        detail && next
          ? startSession(detail, next.week, next.dayId, {
              gym,
              travel,
              bodyWeightKg: weights[0]?.weightKg ?? null,
              byId,
              exercises: all,
              settings,
            })
          : startWorkout({ gymId: gym.id, travel })
      );
    }
    router.replace("/workout");
  }, [empty, units, weights, all, byId, settings]);
  // The workout replaces this route within a frame, so a spinner would only flash.
  return <View className="flex-1 bg-background" />;
}
