import { useLocalSearchParams } from "expo-router";
import { WorkoutScreen } from "@/components/workout/workout-screen";

export default function Workout() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <WorkoutScreen workoutId={id ? Number(id) : undefined} />;
}
