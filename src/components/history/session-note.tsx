import { useState } from "react";
import { View } from "react-native";
import { useQuery, write } from "@/lib/data";
import { muscleLabels } from "@/lib/exercises";
import { useExercises } from "@/lib/exercise-store";
import { modelSetText } from "@/lib/format";
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
import {
  ErrorText,
  Field,
  Icon,
  IconButton,
  Label,
  Note,
  Panel,
  ProcessLine,
  Text,
} from "@/vector";

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
        // The model reads plain digits whatever the app language.
        sets: done.map((s) => modelSetText(s, units)).join(", "),
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
  const { units, t } = useStore();
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
    else setError(t("modelNoAnswer"));
  };

  return (
    <Panel>
      <Field
        label={t("howDidItGo")}
        value={text}
        onChange={setTextValue}
        placeholder={t("sessionNotePlaceholder")}
        multiline
        onDone={() => void save()}
        accessory={reads ? <Icon name="analysis" size={16} tone="muted" /> : undefined}
      />
      {busy && <ProcessLine label={t("readingYourNote")} />}
      <ErrorText message={error} />
      {!busy && nudges.length > 0 && (
        <View className="gap-2">
          <View className="flex-row items-center gap-2">
            <Icon name="analysis" size={16} tone="muted" />
            <Label accessibilityRole="header">{t("nextTime")}</Label>
          </View>
          {nudges.map((n) => {
            const change = t(
              n.exerciseId
                ? n.value > 0
                  ? "nudgeStepFurther"
                  : "nudgeHeld"
                : n.value > 0
                  ? "nudgeSetMore"
                  : "nudgeSetFewer"
            );
            return (
              <View key={n.id} className="flex-row items-center gap-2">
                <View className="flex-1 gap-0.5">
                  <Text variant="bodyStrong">
                    {n.exerciseId ? byId(n.exerciseId).name : muscleLabels[n.muscle!]}
                  </Text>
                  <Note>{n.reason ? t("nudgeLine", { change, reason: n.reason }) : change}</Note>
                </View>
                <IconButton
                  icon="close"
                  accessibilityLabel={t("dontApplyThis")}
                  onPress={() => write(() => dismissNudges([n.id]))}
                />
              </View>
            );
          })}
        </View>
      )}
    </Panel>
  );
}
