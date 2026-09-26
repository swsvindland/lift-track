import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { router, Stack } from "expo-router";
import { SystemButton, SystemIconButton, SystemText as Text } from "@/components/system";
import { ActionMenu, Editor, Field, Screen } from "@/components/ui";
import { ExercisePicker } from "@/components/exercises/exercise-picker";
import { write, useQuery } from "@/lib/data";
import type { Exercise } from "@/lib/exercises";
import { useExercises } from "@/lib/exercise-store";
import { duration } from "@/lib/format";
import { stopRest } from "@/lib/rest-timer";
import { useStore } from "@/lib/store";
import {
  activeWorkout,
  addExercise,
  discardWorkout,
  finishWorkout,
  gymById,
  lastPerformance,
  renameWorkout,
  replaceExercise,
  tidyWorkout,
  workoutDetail,
} from "@/lib/workouts";
import { ExerciseCard } from "./exercise-card";
import { RestBar } from "./rest-bar";

type Toast = { message: string; undo: () => void };

/** Logs the open workout, or edits a finished one when given its id. */
export function WorkoutScreen({ workoutId }: { workoutId?: number }) {
  const { units } = useStore();
  const { byId, settingFor } = useExercises();
  const [picker, setPicker] = useState<{ replacing?: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [, setTick] = useState(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

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
  useEffect(() => {
    if (editingPast || !detail) return;
    const timer = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(timer);
  }, [editingPast, detail]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const showUndo = (message: string, undo: () => void) => {
    clearTimeout(toastTimer.current);
    setToast({ message, undo });
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  };

  if (!detail) {
    return (
      <Screen title="Workout">
        <Stack.Screen options={{ headerShown: false }} />
        <Text className="text-muted">No workout is open.</Text>
        <SystemButton onPress={() => router.back()}>Back</SystemButton>
      </Screen>
    );
  }

  const open = detail.exercises.flatMap((b) => b.sets).filter((s) => !s.completedAt).length;
  const finish = () => {
    if (editingPast) {
      write(() => tidyWorkout(detail.id));
      router.back();
      return;
    }
    const done = () => {
      const id = write(() => finishWorkout(detail.id));
      stopRest();
      if (id)
        router.replace({ pathname: "/session/[id]", params: { id: String(id), finished: "1" } });
      else router.back();
    };
    if (!detail.exercises.some((b) => b.sets.some((s) => s.completedAt))) {
      Alert.alert("Nothing logged", "Finish and discard this empty workout?", [
        { text: "Keep going", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: done },
      ]);
    } else if (open) {
      Alert.alert(
        "Finish workout?",
        `${open} unchecked ${open === 1 ? "set" : "sets"} will be left out.`,
        [
          { text: "Keep going", style: "cancel" },
          { text: "Finish", onPress: done },
        ]
      );
    } else done();
  };

  const pick = (exercise: Exercise) => {
    const replacing = picker?.replacing;
    setPicker(null);
    if (replacing) write(() => replaceExercise(replacing, exercise));
    else write(() => addExercise(detail.id, exercise));
  };

  const groups = detail.exercises.map((b) => b.supersetGroup);
  const header = (
    <View className="flex-row items-center gap-1">
      <SystemIconButton
        icon="chevron-down"
        accessibilityLabel="Close workout"
        onPress={() => router.back()}
      />
      <View className="flex-1">
        <Text className="text-lg font-semibold" numberOfLines={1}>
          {detail.name || "Workout"}
        </Text>
        <Text className="font-mono text-xs text-muted">
          {editingPast ? "Editing" : duration(detail.startedAt)}
        </Text>
      </View>
      <ActionMenu
        accessibilityLabel="Workout options"
        sections={[
          {
            actions: [
              {
                key: "rename",
                label: "Rename",
                icon: "pencil",
                onPress: () => setRenaming(detail.name),
              },
              ...(editingPast
                ? []
                : [
                    {
                      key: "discard",
                      label: "Discard workout",
                      icon: "trash-outline" as const,
                      destructive: true,
                      onPress: () =>
                        Alert.alert("Discard workout?", "Everything logged in it is deleted.", [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Discard",
                            style: "destructive",
                            onPress: () => {
                              write(() => discardWorkout(detail.id));
                              stopRest();
                              router.back();
                            },
                          },
                        ]),
                    },
                  ]),
            ],
          },
        ]}
      />
      <SystemButton onPress={finish} className="px-4">
        {editingPast ? "Done" : "Finish"}
      </SystemButton>
    </View>
  );

  const footer = (
    <View className="gap-2">
      {toast && (
        <View className="flex-row items-center gap-3 rounded-2xl bg-foreground px-4 py-2">
          <Text className="flex-1 text-background">{toast.message}</Text>
          <SystemButton
            variant="ghost"
            labelClassName="text-accent"
            onPress={() => {
              toast.undo();
              setToast(null);
            }}
          >
            Undo
          </SystemButton>
        </View>
      )}
      {!editingPast && <RestBar />}
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: true }} />
      <Screen title="Workout" header={header} footer={footer} compact>
        {detail.exercises.map((block, index) => {
          const exercise = byId(block.exerciseId);
          const inGroup = block.supersetGroup !== null;
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
              restAfter={!inGroup || groups[index + 1] !== block.supersetGroup}
              onSwap={() => setPicker({ replacing: block.id })}
              onUndo={showUndo}
            />
          );
        })}
        {!detail.exercises.length && (
          <Text className="py-6 text-center text-muted">
            Add your first exercise. Sets fill in from last time.
          </Text>
        )}
        <SystemButton variant="secondary" icon="add" onPress={() => setPicker({})}>
          Add exercise
        </SystemButton>
      </Screen>
      <ExercisePicker
        open={!!picker}
        close={() => setPicker(null)}
        onPick={pick}
        title={picker?.replacing ? "Swap exercise" : "Add exercise"}
        replacing={
          picker?.replacing
            ? byId(detail.exercises.find((b) => b.id === picker.replacing)?.exerciseId ?? "")
            : undefined
        }
        equipment={gym?.equipment}
      />
      <Editor
        title="Rename workout"
        open={renaming !== null}
        close={() => setRenaming(null)}
        footer={
          <SystemButton
            onPress={() => {
              write(() => renameWorkout(detail.id, renaming ?? ""));
              setRenaming(null);
            }}
          >
            Save
          </SystemButton>
        }
      >
        <Field
          label="Name"
          value={renaming ?? ""}
          onChange={setRenaming}
          placeholder="Push, Upper A, Legs…"
          autoFocus
        />
      </Editor>
    </>
  );
}
