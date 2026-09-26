import { useLocalSearchParams } from "expo-router";
import { ProgramEditor } from "@/components/plan/program-editor";

export default function Program() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <ProgramEditor programId={id ? Number(id) : undefined} />;
}
