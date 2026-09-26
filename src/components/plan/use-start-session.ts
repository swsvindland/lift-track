import { router } from "expo-router";
import { write } from "@/lib/data";
import { useExercises } from "@/lib/exercise-store";
import { startSession, type ProgramDetail } from "@/lib/programs";
import { useStore } from "@/lib/store";
import { activeGym } from "@/lib/workouts";

/** Starts a program session with prescriptions and opens the logger. */
export function useStartSession() {
  const { units, weights } = useStore();
  const { byId } = useExercises();
  return (detail: ProgramDetail, week: number, dayId: number) => {
    write(() =>
      startSession(detail, week, dayId, {
        gym: activeGym(units),
        bodyWeightKg: weights[0]?.weightKg ?? null,
        byId,
      })
    );
    router.push("/workout");
  };
}
