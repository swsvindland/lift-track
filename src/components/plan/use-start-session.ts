import { router } from "expo-router";
import { write } from "@/lib/data";
import { useExercises } from "@/lib/exercise-store";
import { startSession, type ProgramDetail } from "@/lib/programs";
import { useStore } from "@/lib/store";
import { trainingGym } from "@/lib/workouts";

/**
 * Starts a program session with prescriptions and opens the logger. It runs at the program's gym,
 * or the travel gym while away, with stand-ins for what that gym can't do.
 */
export function useStartSession() {
  const { units, weights } = useStore();
  const { all, byId, settings } = useExercises();
  return (detail: ProgramDetail, week: number, dayId: number) => {
    const { gym, travel } = trainingGym(units, detail.gymId);
    write(() =>
      startSession(detail, week, dayId, {
        gym,
        travel,
        bodyWeightKg: weights[0]?.weightKg ?? null,
        byId,
        exercises: all,
        settings,
      })
    );
    router.push("/workout");
  };
}
