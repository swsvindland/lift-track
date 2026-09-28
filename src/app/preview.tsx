import { useLocalSearchParams } from "expo-router";
import { SessionPreview } from "@/components/plan/session-preview";

export default function Preview() {
  const { week, day } = useLocalSearchParams<{ week: string; day: string }>();
  return <SessionPreview week={Number(week)} dayId={Number(day)} />;
}
