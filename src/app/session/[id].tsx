import { useLocalSearchParams } from "expo-router";
import { SessionScreen } from "@/components/history/session-screen";

export default function Session() {
  const { id, finished } = useLocalSearchParams<{ id: string; finished?: string }>();
  return <SessionScreen id={Number(id)} finished={finished === "1"} />;
}
