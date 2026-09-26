import { useState } from "react";
import { Pressable, View } from "react-native";
import { SystemButton, SystemIcon, SystemLabel, SystemText as Text } from "@/components/system";
import { Editor, ErrorText, Field } from "@/components/ui";
import { ExercisePicker } from "@/components/exercises/exercise-picker";
import { write } from "@/lib/data";
import { useExercises } from "@/lib/exercise-store";
import type { Exercise } from "@/lib/exercises";
import { setText } from "@/lib/format";
import { readWorkout, workoutDraft, type WorkoutDraftItem } from "@/lib/lift-ai";
import { useStore } from "@/lib/store";
import { modelNote, useModel } from "@/lib/use-model";
import { addLoggedExercise, exerciseUsage } from "@/lib/workouts";

type Props = { open: boolean; close: () => void; workoutId: number };

/**
 * Sets typed or dictated with the keyboard's microphone ("bench 225x5x3, incline db 30s for
 * 12 12 10") become a checked-off draft to confirm. Shorthand is read on any phone; the phone's
 * own model reads looser wording where it has one.
 */
export function DescribeSheet(props: Props) {
  return props.open ? <OpenSheet {...props} /> : null;
}

function OpenSheet({ open, close, workoutId }: Props) {
  const { units } = useStore();
  const { all } = useExercises();
  const model = useModel({ prewarm: true });
  const [text, setTextValue] = useState("");
  const [draft, setDraft] = useState<WorkoutDraftItem[] | null>(null);
  const [unread, setUnread] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [picking, setPicking] = useState<number | null>(null);

  const read = async () => {
    setBusy(true);
    setError("");
    try {
      const usage = exerciseUsage();
      const parsed = await readWorkout(text, model.generate);
      const items = workoutDraft(parsed, all, units, (e) =>
        Math.min(3, usage.get(e.id)?.count ?? 0)
      );
      if (!items.length)
        throw new Error("No sets found. Try the exercise, then load × reps × sets.");
      setDraft(items);
      setUnread(parsed.unread);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that.");
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    if (!draft) return;
    write(() => {
      for (const item of draft)
        if (item.exercise) addLoggedExercise(workoutId, item.exercise, item.sets);
    });
    close();
  };

  const ready = !!draft?.length && draft.every((d) => d.exercise);
  return (
    <>
      <Editor
        title="Type or say sets"
        open={open}
        close={close}
        footer={
          draft ? (
            <SystemButton isDisabled={!ready} onPress={add}>
              {`Add ${draft.length} ${draft.length === 1 ? "exercise" : "exercises"}, sets done`}
            </SystemButton>
          ) : (
            <SystemButton isDisabled={busy || !text.trim()} onPress={() => void read()}>
              {busy ? "Reading…" : "Read"}
            </SystemButton>
          )
        }
      >
        {!draft && (
          <>
            <Field
              label="What did you do?"
              value={text}
              onChange={setTextValue}
              placeholder="bench 225x5x3, incline db 30s for 12 12 10, pull ups bw 3x8"
              multiline
              autoFocus
            />
            <Text className="text-sm text-muted">
              Tap the keyboard&apos;s microphone to dictate. Loads without a unit are in{" "}
              {units === "metric" ? "kg" : "lb"}. It&apos;s read on this phone
              {model.available ? " with its own model" : ""}.
            </Text>
            {modelNote(model.status) && (
              <Text className="text-sm text-muted">{modelNote(model.status)}</Text>
            )}
          </>
        )}
        {draft?.map((item, i) => (
          <View key={i} className="gap-1 border-b border-separator pb-3">
            <View className="flex-row items-center gap-2">
              <Pressable
                className="flex-1"
                accessibilityRole="button"
                accessibilityHint="Choose a different exercise"
                onPress={() => setPicking(i)}
              >
                <Text className={item.exercise ? "font-semibold" : "font-semibold text-warning"}>
                  {item.exercise?.name ?? "Pick an exercise"}
                </Text>
                <Text className="text-sm text-muted">
                  “{item.said}”{!item.confident && item.exercise ? " · check this match" : ""}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.said}`}
                hitSlop={8}
                onPress={() => setDraft(draft.filter((_, j) => j !== i))}
              >
                <SystemIcon name="close-circle" color="muted" />
              </Pressable>
            </View>
            <Text className="font-mono text-sm">
              {item.sets.map((s) => setText({ ...s, weightKg: s.weightKg }, units)).join(",  ")}
            </Text>
          </View>
        ))}
        {draft && unread.length > 0 && (
          <View className="gap-1">
            <SystemLabel>Not read</SystemLabel>
            {unread.map((u) => (
              <Text key={u} className="text-sm text-muted">
                {u}
              </Text>
            ))}
          </View>
        )}
        {draft && (
          <SystemButton variant="ghost" onPress={() => setDraft(null)}>
            Edit the text
          </SystemButton>
        )}
        <ErrorText message={error} />
      </Editor>
      <ExercisePicker
        open={picking !== null}
        close={() => setPicking(null)}
        title="Which exercise?"
        replacing={picking !== null ? draft?.[picking]?.exercise : undefined}
        onPick={(exercise: Exercise) => {
          if (picking === null || !draft) return;
          setDraft(draft.map((d, j) => (j === picking ? { ...d, exercise, confident: true } : d)));
          setPicking(null);
        }}
      />
    </>
  );
}
