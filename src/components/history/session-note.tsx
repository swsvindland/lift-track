import { useState } from "react";
import { View } from "react-native";
import { AiMark } from "@/components/ai-mark";
import {
  SystemIconButton,
  SystemLabel,
  SystemPanel,
  SystemText as Text,
} from "@/components/system";
import { ErrorText, Field } from "@/components/ui";
import { useQuery, write } from "@/lib/data";
import { muscleLabels } from "@/lib/exercises";
import { useExercises } from "@/lib/exercise-store";
import { setText } from "@/lib/format";
import { readSessionNote, type SessionSummary } from "@/lib/lift-ai";
import { trainedMuscles } from "@/lib/programs";
import { useStore } from "@/lib/store";
import { useModel } from "@/lib/use-model";
import {
  dismissNudges,
  nudgesFor,
  saveNudges,
  setWorkoutNote,
  type WorkoutDetail,
} from "@/lib/workouts";
import type { Exercise } from "@/lib/exercises";
import type { Units } from "@/lib/metrics";

function summarize(
  detail: WorkoutDetail,
  byId: (id: string) => Exercise,
  units: Units
): SessionSummary {
  const exercises = detail.exercises.flatMap((block) => {
    const done = block.sets.filter((s) => s.completedAt && s.kind !== "warmup");
    if (!done.length) return [];
    const exercise = byId(block.exerciseId);
    return [
      {
        id: exercise.id,
        name: exercise.name,
        muscles: (Object.keys(exercise.muscles) as SessionSummary["muscles"]).filter(
          (m) => exercise.muscles[m] === 1
        ),
        sets: done.map((s) => setText(s, units, true)).join(", "),
      },
    ];
  });
  return { exercises, muscles: trainedMuscles(detail, byId) };
}

/**
 * "How did it go?" after a session. The note is kept as written; where the phone has its own
 * model, it also reads it into nudges for next time (push or hold an exercise, a set more or
 * less for a muscle), listed here and applied on top of the progression method.
 */
export function SessionNote({ detail }: { detail: WorkoutDetail }) {
  const { units } = useStore();
  const { byId } = useExercises();
  const model = useModel({ prewarm: true });
  const [text, setTextValue] = useState(detail.note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nudges = useQuery(() => nudgesFor(detail.id).filter((n) => !n.dismissed), [detail.id]);
  const reads = model.available && !!detail.endedAt && !detail.deload;

  const save = async () => {
    const note = text.trim();
    if (note === detail.note) return;
    write(() => setWorkoutNote(detail.id, note));
    setError("");
    if (!note) {
      write(() => saveNudges(detail.id, { exercises: [], muscles: [], tired: false }));
      return;
    }
    if (!reads) return;
    setBusy(true);
    const reading = await readSessionNote(note, summarize(detail, byId, units), model.generate);
    setBusy(false);
    if (reading) write(() => saveNudges(detail.id, reading));
    else setError("The on-device model didn't answer. Your note is saved.");
  };

  return (
    <SystemPanel className="gap-3">
      <Field
        label="How did it go?"
        value={text}
        onChange={setTextValue}
        placeholder="Elbow was cranky on skull crushers, bench flew up"
        multiline
        onDone={() => void save()}
        accessory={reads ? <AiMark size={14} color="muted" /> : undefined}
      />
      {busy && (
        <View className="flex-row items-center gap-2">
          <AiMark size={16} color="muted" />
          <Text className="text-sm text-muted">Reading your note…</Text>
        </View>
      )}
      {!!error && <ErrorText message={error} />}
      {!busy && nudges.length > 0 && (
        <View className="gap-1">
          <View className="flex-row items-center gap-2">
            <AiMark size={16} color="muted" />
            <SystemLabel>Next time</SystemLabel>
          </View>
          {nudges.map((n) => (
            <View key={n.id} className="flex-row items-center gap-2">
              <Text className="flex-1 text-sm">
                <Text className="font-medium">
                  {n.exerciseId ? byId(n.exerciseId).name : muscleLabels[n.muscle!]}
                </Text>
                {": "}
                {n.exerciseId
                  ? n.value > 0
                    ? "a step further"
                    : "held where it was"
                  : n.value > 0
                    ? "1 more set"
                    : "1 set fewer"}
                <Text className="text-muted"> · {n.reason}</Text>
              </Text>
              <SystemIconButton
                icon="close"
                iconSize={18}
                color="muted"
                accessibilityLabel="Don't apply this"
                onPress={() => write(() => dismissNudges([n.id]))}
              />
            </View>
          ))}
        </View>
      )}
    </SystemPanel>
  );
}
