import { Pressable, View } from "react-native";
import * as Haptics from "expo-haptics";
import { twMerge } from "tailwind-merge";
import { SystemText as Text } from "@/components/system";
import { ActionMenu } from "@/components/ui";
import type { Effort, WorkoutSet } from "@/db";

/* How hard a set felt, in three colors: red is 1 or fewer reps left, orange 1–3, green more.
   It stands in for reps in reserve; blank means "as prescribed". */

export const effortChoices: { value: Effort; label: string; hint: string; dot: string }[] = [
  { value: "hard", label: "Hard", hint: "0–1 reps left", dot: "bg-effort-hard" },
  { value: "good", label: "Good", hint: "1–3 left", dot: "bg-effort-good" },
  { value: "easy", label: "Easy", hint: "4+ left", dot: "bg-effort-easy" },
];

/** A set's effort: the rating, or a typed reps-in-reserve read as a color. */
export function effortOf(row: Pick<WorkoutSet, "effort" | "rir">): Effort | null {
  if (row.effort) return row.effort;
  if (row.rir === null) return null;
  return row.rir <= 1 ? "hard" : row.rir <= 3 ? "good" : "easy";
}

const dotOf = (effort: Effort | null) =>
  effortChoices.find((c) => c.value === effort)?.dot ?? "border-2 border-border";

/** The effort column of a set row: a dot that opens the three choices. */
export function EffortDot({
  effort,
  label,
  onChange,
}: {
  effort: Effort | null;
  label: string;
  onChange: (effort: Effort | null) => void;
}) {
  return (
    <ActionMenu
      accessibilityLabel={`${label} effort${effort ? `, ${effort}` : ""}`}
      trigger={
        <Pressable className="h-11 w-11 items-center justify-center rounded-xl bg-surface-secondary">
          <View className={twMerge("h-4 w-4 rounded-full", dotOf(effort))} />
        </Pressable>
      }
      sections={[
        {
          title: "How hard was it?",
          actions: effortChoices.map((c) => ({
            key: c.value,
            label: `${c.label} · ${c.hint}`,
            selected: effort === c.value,
            onPress: () => onChange(effort === c.value ? null : c.value),
          })),
        },
      ]}
    />
  );
}

/** Three colored buttons to rate the set just done, in one tap. */
export function EffortPicker({
  effort,
  onChange,
  inverted = false,
}: {
  effort: Effort | null;
  onChange: (effort: Effort) => void;
  /** On the dark rest bar. */
  inverted?: boolean;
}) {
  return (
    <View className="flex-row gap-2" accessibilityRole="radiogroup">
      {effortChoices.map((c) => {
        const selected = effort === c.value;
        return (
          <Pressable
            key={c.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`${c.label}, ${c.hint}`}
            onPress={() => {
              void Haptics.selectionAsync().catch(() => {});
              onChange(c.value);
            }}
            className={twMerge(
              "h-11 flex-1 flex-row items-center justify-center gap-2 rounded-2xl",
              inverted ? "border border-muted" : "bg-surface-secondary",
              selected && (inverted ? "border-2 border-background" : "border-2 border-foreground")
            )}
          >
            <View className={twMerge("h-3 w-3 rounded-full", c.dot)} />
            <Text className={twMerge("font-medium", inverted && "text-background")}>{c.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
