import { Alert, Pressable, View } from "react-native";
import { router } from "expo-router";
import { twMerge } from "tailwind-merge";
import type { Gym } from "@/db";
import { write } from "@/lib/data";
import { primaryMuscles, muscleLabels, type Exercise } from "@/lib/exercises";
import { platesPerSide } from "@/lib/loads";
import { weightUnit, type Units } from "@/lib/metrics";
import { defaultRest, startRest } from "@/lib/rest-timer";
import { useStore } from "@/lib/store";
import {
  addSet,
  completeSet,
  deleteSet,
  moveExercise,
  rateSet,
  removeExercise,
  restLabel,
  toggleSuperset,
  updateSet,
  type ExerciseBlock,
  type SetRow,
} from "@/lib/workouts";
import {
  ActionMenu,
  Heading,
  Icon,
  Label,
  LinkButton,
  Meta,
  Note,
  Panel,
  useHaptics,
  useKitFormat,
  useKitStrings,
} from "@/vector";
import { columns, fitted, SetRowView } from "./set-row";

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
  ai,
  standsInFor,
  missingAt,
  nextAfter,
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
  /** Why the targets are what they are. */
  advice?: string;
  /** What the phone's model changed from a note, with a way to take it back. */
  ai?: { reason: string; undo: () => void };
  /** The program's exercise this one replaces today, e.g. because the gym can't do it. */
  standsInFor?: string;
  /** The gym's name when it can't do this exercise and nothing stood in for it. */
  missingAt?: string;
  /** The exercise up next after a set, named in the rest timer. */
  nextAfter: (setId: number) => string | undefined;
}) {
  const { t } = useStore();
  const format = useKitFormat();
  const strings = useKitStrings();
  const haptics = useHaptics();
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

  const deleteRow = (row: SetRow | undefined) => {
    if (!row) return;
    const undo = write(() => deleteSet(row.id));
    onUndo(t("setDeleted"), () => write(undo));
  };

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
      Alert.alert(t("enterReps"), t("enterRepsBody"));
      return;
    }
    haptics.commit();
    if (restAfter && row.kind !== "warmup")
      startRest(
        restSeconds ?? defaultRest(exercise),
        restLabel(nextAfter(row.id) ?? exercise.name),
        row.id
      );
  };

  return (
    <Panel tone={block.supersetGroup !== null ? "live" : "default"} className="gap-2">
      <View className="flex-row items-start gap-2">
        <View className="flex-1 gap-0.5">
          <Pressable
            className="gap-0.5"
            accessibilityRole="link"
            onPress={() => router.push({ pathname: "/exercise/[id]", params: { id: exercise.id } })}
          >
            {block.supersetGroup !== null && <Label>{t("superset")}</Label>}
            <Heading level={3}>{exercise.name}</Heading>
            <Meta
              items={[
                format.list(primaryMuscles(exercise).map((m) => muscleLabels[m])),
                t("repRange", { range: format.range(block.repMin, block.repMax) }),
              ]}
            />
            {!!missingAt && <Note tone="warning">{t("notAtGym", { gym: missingAt })}</Note>}
            {!!standsInFor && <Note>{t("inPlaceOf", { name: standsInFor })}</Note>}
            {!!advice && <Note tone="tint">{advice}</Note>}
          </Pressable>
          {/* Outside the link, so screen readers reach Undo on its own. */}
          {ai && (
            <View className="flex-row items-center gap-1.5">
              <Icon name="analysis" size={16} tone="tint" />
              <Note tone="tint" className="flex-1">
                {ai.reason}
              </Note>
              <LinkButton accessibilityHint={t("undoModelChange")} onPress={ai.undo}>
                {strings.undo}
              </LinkButton>
            </View>
          )}
        </View>
        <ActionMenu
          accessibilityLabel={t("optionsFor", { name: exercise.name })}
          sections={[
            {
              actions: [
                {
                  key: "add",
                  label: t("addSet"),
                  icon: "add",
                  onPress: () => write(() => addSet(block.id)),
                },
                {
                  key: "warmup",
                  label: t("addWarmupSet"),
                  icon: "warmUp",
                  onPress: () => write(() => addSet(block.id, "warmup")),
                },
                {
                  key: "removeSet",
                  label: t("removeLastSet"),
                  icon: "remove",
                  disabled: !block.sets.length,
                  onPress: () => deleteRow(block.sets.at(-1)),
                },
              ],
            },
            {
              actions: [
                {
                  key: "swap",
                  label: t("swapExercise"),
                  icon: "swap",
                  onPress: onSwap,
                },
                {
                  key: "superset",
                  label: block.supersetGroup !== null ? t("splitSuperset") : t("supersetWithNext"),
                  icon: "link",
                  disabled: isLast && block.supersetGroup === null,
                  onPress: () => write(() => toggleSuperset(block.id)),
                },
                {
                  key: "up",
                  label: t("moveUp"),
                  icon: "moveUp",
                  disabled: isFirst,
                  onPress: () => write(() => moveExercise(block.id, -1)),
                },
                {
                  key: "down",
                  label: t("moveDown"),
                  icon: "moveDown",
                  disabled: isLast,
                  onPress: () => write(() => moveExercise(block.id, 1)),
                },
              ],
            },
            {
              actions: [
                {
                  key: "remove",
                  label: t("removeExercise"),
                  icon: "delete",
                  destructive: true,
                  onPress: () => {
                    const undo = write(() => removeExercise(block.id));
                    onUndo(t("removedExercise", { name: exercise.name }), () => write(undo));
                  },
                },
              ],
            },
          ]}
        />
      </View>

      {/* Fixed grid columns: each header stays on one line, shrinking a little before it clips. */}
      <View className="flex-row items-center gap-1.5 px-1">
        <Label className={columns.badge} {...fitted}>
          {t("setColumn")}
        </Label>
        <Label className={columns.previous} {...fitted}>
          {t("lastColumn")}
        </Label>
        <Label className={twMerge(columns.weight, "text-center")} {...fitted}>
          {bodyweight
            ? t("addedLoadUnit", { unit })
            : assisted
              ? t("assistLoadUnit", { unit })
              : unit}
        </Label>
        <Label className={twMerge(columns.reps, "text-center")} {...fitted}>
          {t("repsColumn")}
        </Label>
        <Label className={twMerge(columns.rir, "text-center")} {...fitted}>
          {t("feelColumn")}
        </Label>
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
          onDelete={() => deleteRow(row)}
        />
      ))}

      {plates && plates.length > 0 && (
        <View className="flex-row flex-wrap items-center gap-x-2 px-1">
          <Note>{t("perSide")}</Note>
          <Meta
            items={plates.map((p) => format.unit(p, gym!.unit === "kg" ? "kilogram" : "pound", 2))}
          />
        </View>
      )}
    </Panel>
  );
}
