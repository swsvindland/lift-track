import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { ExercisePicker } from "@/components/exercises/exercise-picker";
import { write, useQuery } from "@/lib/data";
import { canDoAt, type Exercise } from "@/lib/exercises";
import { useExercises } from "@/lib/exercise-store";
import { useLiftFormat } from "@/lib/format";
import { isDeloadWeek, programDetail, swapInSession, undoAi, weekRir } from "@/lib/programs";
import { stopRest } from "@/lib/rest-timer";
import { syncHealthSoon } from "@/lib/health-schedule";
import { useStore } from "@/lib/store";
import { useCount } from "@/lib/use-count";
import {
  activeWorkout,
  addExercise,
  discardWorkout,
  finishWorkout,
  gymById,
  lastPerformance,
  renameWorkout,
  replaceExercise,
  restsAfter,
  tidyWorkout,
  workoutDetail,
} from "@/lib/workouts";
import {
  Button,
  DetailScreen,
  Editor,
  Field,
  Meta,
  SystemState,
  Text,
  Value,
  useKitFormat,
  useKitStrings,
  useUndo,
} from "@/vector";
import { ExerciseCard } from "./exercise-card";
import { RestBar } from "./rest-bar";
import { DescribeSheet } from "./describe-sheet";

/** Leaves the workout; opened from a link with nothing under it, it goes to the tabs instead. */
const leave = () => (router.canGoBack() ? router.back() : router.replace("/"));

/**
 * Logs the open workout, or edits a finished one when given its id. The kit's Undo stacks above the rest strip
 * (DockProvider wraps the root Stack), so both stay in reach. It belongs to this screen: leaving it by any route,
 * or the workout ending elsewhere, makes the last removal final.
 */
export function WorkoutScreen({ workoutId }: { workoutId?: number }) {
  const { units, t } = useStore();
  const strings = useKitStrings();
  const format = useKitFormat();
  const { adviceText, duration, rirText } = useLiftFormat();
  const count = useCount();
  const undo = useUndo();
  const { byId, settingFor } = useExercises();
  const [picker, setPicker] = useState<{ replacing?: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [describing, setDescribing] = useState(false);
  const [, setTick] = useState(0);

  const { detail, gym } = useQuery(() => {
    const id = workoutId ?? activeWorkout()?.id;
    const detail = id ? workoutDetail(id) : undefined;
    return { detail, gym: detail?.gymId ? gymById(detail.gymId) : undefined };
  }, [workoutId]);
  // Last time's sets, looked up once per exercise.
  const previous = useMemo(() => {
    const map = new Map<string, ReturnType<typeof lastPerformance>>();
    for (const block of detail?.exercises ?? [])
      if (!map.has(block.exerciseId))
        map.set(block.exerciseId, lastPerformance(block.exerciseId, block.workoutId));
    return map;
  }, [detail]);

  const editingPast = !!detail?.endedAt;
  const program = useQuery(() => {
    if (!detail?.mesoId) return undefined;
    const meso = programDetail(detail.mesoId);
    return meso
      ? {
          deload: isDeloadWeek(meso, detail.mesoWeek ?? 0),
          rir: weekRir(meso, detail.mesoWeek ?? 0),
          // What each slot plans, to name the exercise a stand-in replaces.
          planned: new Map(meso.days.flatMap((d) => d.slots).map((s) => [s.id, s.exerciseId])),
        }
      : undefined;
  }, [detail?.mesoId, detail?.mesoWeek]);
  useEffect(() => {
    if (editingPast || !detail) return;
    const timer = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(timer);
  }, [editingPast, detail]);

  // The root DockProvider draws the Undo on whichever screen is focused, so drop it on blur (Back, a pushed
  // exercise page, a tab) and once the workout is gone (finished on the Watch, deleted, restored over).
  const dismissUndo = useRef(undo.dismiss);
  useEffect(() => {
    dismissUndo.current = undo.dismiss;
  }, [undo]);
  useFocusEffect(useCallback(() => () => dismissUndo.current(), []));
  const missing = !detail;
  useEffect(() => {
    if (missing) dismissUndo.current();
  }, [missing]);

  if (!detail) {
    return (
      <DetailScreen title={t("workout")}>
        <SystemState
          kind="empty"
          message={t("noWorkoutOpen")}
          action={{ label: strings.back, onPress: leave }}
        />
      </DetailScreen>
    );
  }

  const open = detail.exercises.flatMap((b) => b.sets).filter((s) => !s.completedAt).length;
  // Finish and Discard dismiss before they write and navigate, so the Undo never reaches the next screen.
  const finish = () => {
    if (editingPast) {
      undo.dismiss();
      write(() => tidyWorkout(detail.id));
      void syncHealthSoon();
      leave();
      return;
    }
    const done = () => {
      undo.dismiss();
      const id = write(() => finishWorkout(detail.id));
      stopRest();
      if (id) void syncHealthSoon();
      if (id)
        router.replace({ pathname: "/session/[id]", params: { id: String(id), finished: "1" } });
      else leave();
    };
    if (!detail.exercises.some((b) => b.sets.some((s) => s.completedAt))) {
      // vector: irreversible
      Alert.alert(t("nothingLogged"), t("discardEmptyWorkout"), [
        { text: t("keepGoing"), style: "cancel" },
        { text: t("discard"), style: "destructive", onPress: done },
      ]);
    } else if (open) {
      // vector: irreversible
      Alert.alert(
        t("finishWorkoutQuestion"),
        count(open, "uncheckedSetLeftOut", "uncheckedSetsLeftOut"),
        [
          { text: t("keepGoing"), style: "cancel" },
          { text: t("finish"), onPress: done },
        ]
      );
    } else done();
  };

  const pick = (exercise: Exercise) => {
    const replacing = picker?.replacing;
    setPicker(null);
    if (!replacing) {
      write(() => addExercise(detail.id, exercise));
      return;
    }
    const block = detail.exercises.find((b) => b.id === replacing);
    const context = { gym, bodyWeightKg: detail.bodyWeightKg };
    if (block?.slotId == null || !detail.mesoId) {
      write(() => replaceExercise(replacing, exercise));
      return;
    }
    Alert.alert(t("swapTo", { name: exercise.name }), undefined, [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("justToday"),
        onPress: () => write(() => swapInSession(replacing, exercise, false, context)),
      },
      {
        text: t("restOfProgram"),
        onPress: () => write(() => swapInSession(replacing, exercise, true, context)),
      },
    ]);
  };

  const discard = () => {
    // vector: irreversible
    Alert.alert(t("discardWorkoutQuestion"), t("discardWorkoutBody"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("discard"),
        style: "destructive",
        onPress: () => {
          undo.dismiss();
          write(() => discardWorkout(detail.id));
          stopRest();
          leave();
        },
      },
    ]);
  };

  return (
    <>
      <DetailScreen
        title={detail.name || t("workout")}
        action={{
          icon: "check",
          accessibilityLabel: editingPast ? strings.done : t("finishWorkout"),
          onPress: finish,
        }}
        menu={{
          accessibilityLabel: t("workoutOptions"),
          sections: [
            {
              actions: [
                {
                  key: "rename",
                  label: t("rename"),
                  icon: "edit",
                  onPress: () => setRenaming(detail.name),
                },
                ...(editingPast
                  ? []
                  : [
                      {
                        key: "discard",
                        label: t("discardWorkout"),
                        icon: "delete" as const,
                        destructive: true,
                        onPress: discard,
                      },
                    ]),
              ],
            },
          ],
        }}
        footer={editingPast ? undefined : <RestBar />}
        compact
      >
        {/* The title is in the native bar; the program week, gym and the live duration lead the content. */}
        <View className="flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <Meta
            items={[
              program
                ? program.deload
                  ? t("deload")
                  : t("weekN", { n: format.number((detail.mesoWeek ?? 0) + 1) })
                : "",
              program ? rirText(program.rir) : "",
              detail.travel && gym ? t("atGym", { gym: gym.name }) : "",
              editingPast ? t("editing") : "",
            ]}
          />
          {!editingPast && <Value size="xs" tone="muted" value={duration(detail.startedAt)} />}
        </View>
        {detail.exercises.map((block, index) => {
          const exercise = byId(block.exerciseId);
          // Past sessions may predate a permanent swap, so only the open one names its plan.
          const planned =
            !editingPast && block.slotId !== null ? program?.planned.get(block.slotId) : undefined;
          return (
            <ExerciseCard
              key={block.id}
              block={block}
              exercise={exercise}
              previous={previous.get(block.exerciseId)?.sets ?? []}
              units={units}
              gym={gym}
              restSeconds={settingFor(exercise.id)?.restSeconds}
              isFirst={index === 0}
              isLast={index === detail.exercises.length - 1}
              restAfter={restsAfter(detail.exercises, index)}
              onSwap={() => setPicker({ replacing: block.id })}
              advice={adviceText(block.advice, units)}
              ai={
                block.advice?.aiReason && !editingPast
                  ? {
                      reason: block.advice.aiReason,
                      undo: () => write(() => undoAi(block.id, byId)),
                    }
                  : undefined
              }
              standsInFor={planned && planned !== block.exerciseId ? byId(planned).name : undefined}
              missingAt={!editingPast && gym && !canDoAt(exercise, gym) ? gym.name : undefined}
              nextName={
                detail.exercises[index + 1]
                  ? byId(detail.exercises[index + 1].exerciseId).name
                  : undefined
              }
              onUndo={(message, onUndo) => undo.show({ message, onUndo })}
            />
          );
        })}
        {!detail.exercises.length && <Text tone="muted">{t("addFirstExercise")}</Text>}
        <View className="flex-row gap-2">
          <Button variant="secondary" icon="add" className="flex-1" onPress={() => setPicker({})}>
            {t("addExercise")}
          </Button>
          <Button
            variant="secondary"
            icon="mic"
            className="flex-1"
            onPress={() => setDescribing(true)}
          >
            {t("typeOrSay")}
          </Button>
        </View>
      </DetailScreen>
      <ExercisePicker
        open={!!picker}
        close={() => setPicker(null)}
        onPick={pick}
        title={picker?.replacing ? t("swapExercise") : t("addExercise")}
        replacing={
          picker?.replacing
            ? byId(detail.exercises.find((b) => b.id === picker.replacing)?.exerciseId ?? "")
            : undefined
        }
        gym={gym}
      />
      <DescribeSheet open={describing} close={() => setDescribing(false)} workoutId={detail.id} />
      <Editor
        title={t("renameWorkout")}
        open={renaming !== null}
        close={() => setRenaming(null)}
        dirty={renaming !== null && renaming !== detail.name}
        primary={{
          label: strings.save,
          onPress: () => {
            write(() => renameWorkout(detail.id, renaming ?? ""));
            setRenaming(null);
          },
        }}
      >
        <Field
          label={t("name")}
          value={renaming ?? ""}
          onChange={setRenaming}
          placeholder={t("workoutNamePlaceholder")}
          autoFocus
        />
      </Editor>
    </>
  );
}
