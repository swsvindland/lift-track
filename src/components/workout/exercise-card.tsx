import { Alert, Pressable, View } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { twMerge } from "tailwind-merge";
import { SystemButton, SystemLabel, SystemText as Text } from "@/components/system";
import { ActionMenu } from "@/components/ui";
import type { Gym } from "@/db";
import { write } from "@/lib/data";
import { primaryMuscles, muscleLabels, type Exercise } from "@/lib/exercises";
import { platesPerSide } from "@/lib/loads";
import { weightUnit, type Units } from "@/lib/metrics";
import { defaultRest, startRest } from "@/lib/rest-timer";
import {
  addSet,
  completeSet,
  deleteSet,
  moveExercise,
  rateSet,
  removeExercise,
  toggleSuperset,
  updateSet,
  type ExerciseBlock,
  type SetRow,
} from "@/lib/workouts";
import { columns, SetRowView } from "./set-row";

export function ExerciseCard({
  block,
  exercise,
  previous,
  units,
  gym,
  restSeconds,
  isFirst,
  isLast,
  restAfter,
  onSwap,
  onUndo,
  advice,
  nextName,
}: {
  block: ExerciseBlock;
  exercise: Exercise;
  /** Last time's sets of this exercise, matched to rows by position among the same kind. */
  previous: SetRow[];
  units: Units;
  gym: Gym | undefined;
  restSeconds: number | null | undefined;
  isFirst: boolean;
  isLast: boolean;
  /** False inside a superset until its last exercise, so you move straight to the next. */
  restAfter: boolean;
  onSwap: () => void;
  onUndo: (message: string, undo: () => void) => void;
  /** Why the targets are what they are, for program sessions. */
  advice?: string;
  /** The exercise after this one, named in the rest timer once this one is done. */
  nextName?: string;
}) {
  const bodyweight = exercise.load === "bodyweight";
  const assisted = exercise.load === "assisted";
  const unit = weightUnit(units);
  let working = 0;
  const numbers = block.sets.map((s) => (s.kind === "working" ? ++working : 0));
  const previousOf = (row: SetRow, index: number) => {
    const sameKind = block.sets.slice(0, index).filter((s) => s.kind === row.kind).length;
    return previous.filter((s) => s.kind === row.kind)[sameKind];
  };
  const nextOpen = block.sets.find((s) => !s.completedAt && s.kind !== "warmup");
  const nextLoad = nextOpen ? (nextOpen.weightKg ?? nextOpen.targetWeightKg) : null;
  const plates = gym && nextLoad ? platesPerSide(nextLoad, exercise.equipment, gym) : null;

  const complete = (row: SetRow, patch: Parameters<typeof updateSet>[1]) => {
    if (row.completedAt) {
      write(() => completeSet(row.id, false));
      return;
    }
    const ok = write(() => {
      updateSet(row.id, patch);
      return completeSet(row.id);
    });
    if (!ok) {
      Alert.alert("Enter reps", "Type how many reps you did, then check the set off.");
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (restAfter && row.kind !== "warmup")
      startRest(
        restSeconds ?? defaultRest(exercise),
        `Next: ${block.sets.some((s) => s.id !== row.id && !s.completedAt && s.kind !== "warmup") || !nextName ? exercise.name : nextName}`,
        row.id
      );
  };

  return (
    <View
      className={twMerge(
        "gap-2 rounded-3xl bg-surface p-4",
        block.supersetGroup !== null && "border-l-4 border-accent"
      )}
    >
      <View className="flex-row items-start gap-2">
        <Pressable
          className="flex-1 gap-0.5"
          accessibilityRole="link"
          onPress={() => router.push({ pathname: "/exercise/[id]", params: { id: exercise.id } })}
        >
          {block.supersetGroup !== null && (
            <SystemLabel className="text-accent-soft-foreground">Superset</SystemLabel>
          )}
          <Text className="text-lg font-semibold">{exercise.name}</Text>
          <Text className="text-sm text-muted">
            {primaryMuscles(exercise)
              .map((m) => muscleLabels[m])
              .join(", ")}{" "}
            · {block.repMin}–{block.repMax} reps
          </Text>
          {!!advice && <Text className="text-sm text-accent-soft-foreground">{advice}</Text>}
        </Pressable>
        <ActionMenu
          accessibilityLabel={`${exercise.name} options`}
          sections={[
            {
              actions: [
                { key: "swap", label: "Swap exercise", icon: "swap-horizontal", onPress: onSwap },
                {
                  key: "superset",
                  label: block.supersetGroup !== null ? "Split superset" : "Superset with next",
                  icon: "link-outline",
                  disabled: isLast && block.supersetGroup === null,
                  onPress: () => write(() => toggleSuperset(block.id)),
                },
                {
                  key: "warmup",
                  label: "Add warm-up set",
                  icon: "flame-outline",
                  onPress: () => write(() => addSet(block.id, "warmup")),
                },
                {
                  key: "up",
                  label: "Move up",
                  icon: "arrow-up",
                  disabled: isFirst,
                  onPress: () => write(() => moveExercise(block.id, -1)),
                },
                {
                  key: "down",
                  label: "Move down",
                  icon: "arrow-down",
                  disabled: isLast,
                  onPress: () => write(() => moveExercise(block.id, 1)),
                },
              ],
            },
            {
              actions: [
                {
                  key: "remove",
                  label: "Remove exercise",
                  icon: "trash-outline",
                  destructive: true,
                  onPress: () => {
                    const undo = write(() => removeExercise(block.id));
                    onUndo(`Removed ${exercise.name}`, () => write(undo));
                  },
                },
              ],
            },
          ]}
        />
      </View>

      <View className="flex-row items-center gap-1.5 px-1">
        <SystemLabel className={columns.badge}>Set</SystemLabel>
        <SystemLabel className={columns.previous}>Last</SystemLabel>
        <SystemLabel className={twMerge(columns.weight, "text-center")}>
          {bodyweight ? `+${unit}` : assisted ? `−${unit}` : unit}
        </SystemLabel>
        <SystemLabel className={twMerge(columns.reps, "text-center")}>Reps</SystemLabel>
        <SystemLabel className={twMerge(columns.rir, "text-center")}>Feel</SystemLabel>
        <View className={columns.done} />
      </View>

      {block.sets.map((row, index) => (
        <SetRowView
          key={row.id}
          row={row}
          number={numbers[index]}
          previous={previousOf(row, index)}
          units={units}
          onChange={(patch) => write(() => updateSet(row.id, patch))}
          onComplete={(patch) => complete(row, patch)}
          onKind={(kind) => write(() => updateSet(row.id, { kind }))}
          onEffort={(effort) => write(() => rateSet(row.id, effort))}
          onDelete={() => {
            const undo = write(() => deleteSet(row.id));
            onUndo("Set deleted", () => write(undo));
          }}
        />
      ))}

      {plates && plates.length > 0 && (
        <Text className="px-1 text-sm text-muted">
          Per side: {plates.join(" · ")} {gym!.unit}
        </Text>
      )}

      <SystemButton variant="ghost" icon="add" onPress={() => write(() => addSet(block.id))}>
        Add set
      </SystemButton>
    </View>
  );
}
