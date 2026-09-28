import { router } from "expo-router";
import { write } from "@/lib/data";
import { useExercises } from "@/lib/exercise-store";
import { startSession, type ProgramDetail, type SessionContext } from "@/lib/programs";
import { useStore } from "@/lib/store";
import { trainingGym } from "@/lib/workouts";

/**
 * What a program session is planned against: the program's gym, or the travel gym while away,
 * with stand-ins for what that gym can't do.
 */
export function useSessionContext() {
  const { units, weights } = useStore();
  const { all, byId, settings } = useExercises();
  return (detail: ProgramDetail): SessionContext => {
    const { gym, travel } = trainingGym(units, detail.gymId);
    return {
      gym,
      travel,
      bodyWeightKg: weights[0]?.weightKg ?? null,
      byId,
      exercises: all,
      settings,
    };
  };
}

/** Starts a program session with prescriptions and opens the logger. */
export function useStartSession() {
  const contextFor = useSessionContext();
  return (detail: ProgramDetail, week: number, dayId: number, { replace = false } = {}) => {
    write(() => startSession(detail, week, dayId, contextFor(detail)));
    if (replace) router.replace("/workout");
    else router.push("/workout");
  };
}

/** Opens a session's preview: every set's target, before starting it. */
export const previewSession = (week: number, dayId: number) =>
  router.push({ pathname: "/preview", params: { week: String(week), day: String(dayId) } });
