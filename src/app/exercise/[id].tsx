import { useLocalSearchParams } from "expo-router";
import { ExerciseScreen } from "@/components/exercises/exercise-screen";

export default function ExerciseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ExerciseScreen id={id} />;
}
