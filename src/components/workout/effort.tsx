import { Pressable, View } from "react-native";
import { twMerge } from "tailwind-merge";
import type { Effort, WorkoutSet } from "@/db";
import { useStore } from "@/lib/store";
import type { Message } from "@/lib/translations";
import { ActionMenu, SignalCell, Text, useHaptics, useSignalInk } from "@/vector";

/* How hard a set felt, as one to three bars in a colour: three red is 1 or fewer reps left, two amber 1–3,
   one green more. It stands in for reps in reserve; blank means "as prescribed". */

export const effortChoices: { value: Effort; label: Message; hint: Message }[] = [
  { value: "hard", label: "effortHard", hint: "effortHardHint" },
  { value: "good", label: "effortGood", hint: "effortGoodHint" },
  { value: "easy", label: "effortEasy", hint: "effortEasyHint" },
];

const effortLevel: Record<Effort, number> = { easy: 1, good: 2, hard: 3 };
/** The kit's status colours, which read at a glance mid-set; the bar count carries it without colour. */
const effortFill: Record<Effort, string> = {
  hard: "bg-danger",
  good: "bg-warning",
  easy: "bg-success",
};
const barHeights = ["h-1.5", "h-[9px]", "h-3"];

/**
 * Effort as ascending bars in its colour, the same mark as the Watch. Empty bars are outlined. In a selected
 * SignalCell the bars are signal ink, like the kit Text and Icon beside them.
 */
export function EffortMark({ effort }: { effort: Effort | null }) {
  const onSignal = useSignalInk();
  const level = effort ? effortLevel[effort] : 0;
  return (
    <View
      className="flex-row items-end gap-0.5"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {barHeights.map((height, i) => (
        <View
          key={height}
          className={twMerge(
            "w-[3px]",
            height,
            effort && i < level
              ? onSignal
                ? "bg-accent-foreground"
                : effortFill[effort]
              : onSignal
                ? "border border-accent-foreground"
                : "border border-border-strong"
          )}
        />
      ))}
    </View>
  );
}

/** A set's effort: the rating, or a typed reps-in-reserve read as a level. */
export function effortOf(row: Pick<WorkoutSet, "effort" | "rir">): Effort | null {
  if (row.effort) return row.effort;
  if (row.rir === null) return null;
  return row.rir <= 1 ? "hard" : row.rir <= 3 ? "good" : "easy";
}

/** The effort column of a set row: the mark, which opens the three choices. */
export function EffortDot({
  effort,
  label,
  onChange,
}: {
  effort: Effort | null;
  label: string;
  onChange: (effort: Effort | null) => void;
}) {
  const { t } = useStore();
  const chosen = effortChoices.find((c) => c.value === effort);
  return (
    <ActionMenu
      accessibilityLabel={
        chosen
          ? t("effortOfSetRated", {
              set: label,
              effort: t("effortWithHint", { label: t(chosen.label), hint: t(chosen.hint) }),
            })
          : t("effortOfSet", { set: label })
      }
      trigger={
        <Pressable className="h-11 w-11 items-center justify-center rounded-control border border-field-border bg-field active:bg-surface-secondary">
          <EffortMark effort={effort} />
        </Pressable>
      }
      sections={[
        {
          title: t("effortQuestion"),
          actions: effortChoices.map((c) => ({
            key: c.value,
            label: t("effortOption", { label: t(c.label), hint: t(c.hint) }),
            selected: effort === c.value,
            onPress: () => onChange(effort === c.value ? null : c.value),
          })),
        },
      ]}
    />
  );
}

/**
 * Three radio cells to rate the set just done, in one tap: kit SignalCells (signal fill, signal ink and a check
 * when selected) holding the effort mark beside each word, which the kit Choices' text-only cells cannot hold.
 */
export function EffortPicker({
  effort,
  onChange,
}: {
  effort: Effort | null;
  onChange: (effort: Effort) => void;
}) {
  const { t } = useStore();
  const haptics = useHaptics();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t("effortQuestion")}
      className="flex-1 flex-row gap-2"
    >
      {effortChoices.map((c) => (
        <SignalCell
          key={c.value}
          selected={effort === c.value}
          accessibilityRole="radio"
          accessibilityLabel={t("effortWithHint", { label: t(c.label), hint: t(c.hint) })}
          onPress={() => {
            haptics.selection();
            onChange(c.value);
          }}
          check
          className="flex-1 basis-0 gap-1.5"
        >
          <EffortMark effort={c.value} />
          <Text variant="h4" className="shrink">
            {t(c.label)}
          </Text>
        </SignalCell>
      ))}
    </View>
  );
}
