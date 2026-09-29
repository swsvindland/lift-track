import { useState } from "react";
import { Pressable, View } from "react-native";
import { ExercisePicker } from "@/components/exercises/exercise-picker";
import { write } from "@/lib/data";
import { useExercises } from "@/lib/exercise-store";
import type { Exercise } from "@/lib/exercises";
import { useLiftFormat } from "@/lib/format";
import { readWorkout, workoutDraft, type WorkoutDraftItem } from "@/lib/lift-ai";
import { useStore } from "@/lib/store";
import { modelNote, useModel } from "@/lib/use-model";
import { addLoggedExercise, exerciseUsage } from "@/lib/workouts";
import {
  Button,
  Editor,
  ErrorText,
  Field,
  IconButton,
  Label,
  Meta,
  Note,
  Text,
  useKitFormat,
} from "@/vector";

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
  const { units, t } = useStore();
  const format = useKitFormat();
  const { setText } = useLiftFormat();
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
      if (!items.length) throw new Error(t("noSetsFound"));
      setDraft(items);
      setUnread(parsed.unread);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("couldNotRead"));
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
        title={t("typeOrSaySets")}
        open={open}
        close={close}
        dirty={!!text.trim()}
        primary={
          draft
            ? {
                label: t(draft.length === 1 ? "addExerciseSetsDone" : "addExercisesSetsDone", {
                  n: format.number(draft.length),
                }),
                onPress: add,
                disabled: !ready,
              }
            : {
                label: busy ? t("reading") : t("read"),
                onPress: () => void read(),
                disabled: busy || !text.trim(),
              }
        }
      >
        {!draft && (
          <>
            <Field
              label={t("whatDidYouDo")}
              value={text}
              onChange={setTextValue}
              placeholder={t("describePlaceholder")}
              multiline
              autoFocus
            />
            <Note>
              {t(model.available ? "describeNoteModel" : "describeNote", {
                unit: units === "metric" ? "kg" : "lb",
              })}
            </Note>
            {modelNote(model.status) && <Note>{modelNote(model.status)}</Note>}
          </>
        )}
        {draft?.map((item, i) => (
          <View key={i} className="gap-1 border-b border-separator pb-3">
            <View className="flex-row items-center gap-2">
              <Pressable
                className="flex-1"
                accessibilityRole="button"
                accessibilityHint={t("chooseDifferentExercise")}
                onPress={() => setPicking(i)}
              >
                <Text variant="bodyStrong" tone={item.exercise ? "default" : "warning"}>
                  {item.exercise?.name ?? t("pickAnExercise")}
                </Text>
                <Meta
                  items={[
                    t("quoted", { text: item.said }),
                    !item.confident && item.exercise ? t("checkThisMatch") : "",
                  ]}
                />
              </Pressable>
              <IconButton
                icon="clear"
                accessibilityLabel={t("removeItem", { name: item.said })}
                onPress={() => setDraft(draft.filter((_, j) => j !== i))}
              />
            </View>
            <Meta
              tone="default"
              items={item.sets.map((s) => setText({ ...s, weightKg: s.weightKg }, units))}
            />
          </View>
        ))}
        {draft && unread.length > 0 && (
          <View className="gap-1">
            <Label>{t("notRead")}</Label>
            {unread.map((u) => (
              <Note key={u}>{u}</Note>
            ))}
          </View>
        )}
        {draft && (
          <Button variant="ghost" onPress={() => setDraft(null)}>
            {t("editTheText")}
          </Button>
        )}
        <ErrorText message={error} />
      </Editor>
      <ExercisePicker
        open={picking !== null}
        close={() => setPicking(null)}
        title={t("whichExercise")}
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
