import { useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import { ExercisePicker } from "@/components/exercises/exercise-picker";
import { setPendingDraft } from "@/lib/draft-store";
import { matchExercise, type Exercise } from "@/lib/exercises";
import { useExercises } from "@/lib/exercise-store";
import { readProgram } from "@/lib/lift-ai";
import { linesToText, recognizeText, textRecognitionAvailable } from "@/lib/local-ai";
import { rirPlan } from "@/lib/progression";
import { useStore } from "@/lib/store";
import { modelNote, useModel } from "@/lib/use-model";
import {
  Button,
  Editor,
  ErrorText,
  Field,
  IconButton,
  Label,
  Meta,
  Note,
  ProcessLine,
  Text,
  useKitFormat,
} from "@/vector";

type Slot = {
  said: string;
  exercise?: Exercise;
  confident: boolean;
  sets: number;
  reps: [number, number];
};
type Day = { name: string; slots: Slot[] };
type Props = { open: boolean; close: () => void };

/**
 * A program from a coach, a book or a spreadsheet: paste it, or photograph it and the phone reads
 * the text. Lines like "Bench Press 3x6-8" are read directly; messier pages go to the phone's
 * own model. Every match is shown before it becomes a program.
 */
export function ImportSheet(props: Props) {
  return props.open ? <OpenImport {...props} /> : null;
}

function OpenImport({ open, close }: Props) {
  const { t } = useStore();
  const format = useKitFormat();
  const { all } = useExercises();
  const model = useModel({ prewarm: true });
  const [text, setText] = useState("");
  const [days, setDays] = useState<Day[] | null>(null);
  const [busy, setBusy] = useState<"" | "photo" | "read">("");
  const [error, setError] = useState("");
  const [picking, setPicking] = useState<{ day: number; slot: number } | null>(null);

  const photo = async (camera: boolean) => {
    setError("");
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.9 };
    const permission = camera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : { granted: true };
    if (!permission.granted) return setError(t("allowCameraProgram"));
    const result = camera
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled) return;
    const uri = result.assets[0].uri;
    setBusy("photo");
    try {
      const lines = await recognizeText(uri);
      const read = linesToText(lines);
      if (!read.trim()) throw new Error(t("noTextFound"));
      setText((current) => (current.trim() ? `${current}\n${read}` : read));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("couldNotReadPhoto"));
    } finally {
      // The photo was only needed for its text.
      const file = new File(uri);
      if (file.exists) file.delete();
      setBusy("");
    }
  };

  const read = async () => {
    setBusy("read");
    setError("");
    try {
      const parsed = await readProgram(text, model.generate);
      if (!parsed.days.length) throw new Error(t("noProgramFound"));
      setDays(
        parsed.days.map((d) => ({
          name: d.name,
          slots: d.slots.map((s) => {
            const { exercise, confident } = matchExercise(all, s.name);
            return { said: s.name, exercise, confident, sets: s.sets, reps: [s.repMin, s.repMax] };
          }),
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("couldNotRead"));
    } finally {
      setBusy("");
    }
  };

  const ready =
    !!days?.length && days.every((d) => d.slots.length && d.slots.every((s) => s.exercise));
  const openEditor = () => {
    if (!days) return;
    setPendingDraft({
      name: t("importedProgram"),
      rir: rirPlan(5),
      days: days.map((d) => ({
        name: d.name,
        slots: d.slots.map((s) => ({ exerciseId: s.exercise!.id, sets: s.sets, reps: s.reps })),
      })),
    });
    close();
    router.push("/program");
  };

  return (
    <>
      <Editor
        title={t("importProgram")}
        open={open}
        close={close}
        dirty={!!text.trim() || !!days}
        primary={
          days
            ? { label: t("reviewInEditor"), onPress: openEditor, disabled: !ready }
            : {
                label: t("readProgram"),
                onPress: () => void read(),
                disabled: !!busy || !text.trim(),
                loading: busy === "read",
                loadingLabel: t("reading"),
              }
        }
      >
        {!days && (
          <>
            {textRecognitionAvailable() && (
              <View className="flex-row gap-2">
                <Button
                  variant="secondary"
                  icon="camera"
                  className="flex-1"
                  disabled={!!busy}
                  onPress={() => void photo(true)}
                >
                  {t("photograph")}
                </Button>
                <Button
                  variant="secondary"
                  icon="photo"
                  className="flex-1"
                  disabled={!!busy}
                  onPress={() => void photo(false)}
                >
                  {t("choosePhoto")}
                </Button>
              </View>
            )}
            {busy === "photo" && <ProcessLine label={t("readingPage")} />}
            <Field
              label={t("programField")}
              value={text}
              onChange={setText}
              placeholder={t("importPlaceholder")}
              multiline
            />
            <Note>{t("importNote")}</Note>
            {modelNote(model.status) && <Note>{modelNote(model.status)}</Note>}
          </>
        )}
        {days?.map((day, d) => (
          <View key={d} className="gap-2">
            <Label accessibilityRole="header">{day.name}</Label>
            {day.slots.map((slot, s) => (
              <View key={s} className="flex-row items-center gap-2 border-b border-separator pb-2">
                <Pressable
                  className="flex-1"
                  accessibilityRole="button"
                  accessibilityHint={t("chooseDifferentExercise")}
                  onPress={() => setPicking({ day: d, slot: s })}
                >
                  <Text variant="bodyStrong" tone={slot.exercise ? "default" : "warning"}>
                    {slot.exercise?.name ?? t("pickAnExercise")}
                  </Text>
                  <Meta
                    items={[
                      t("quoted", { text: slot.said }),
                      t("setsTimesReps", {
                        sets: format.number(slot.sets),
                        reps:
                          slot.reps[1] !== slot.reps[0]
                            ? format.range(slot.reps[0], slot.reps[1])
                            : format.number(slot.reps[0]),
                      }),
                      !slot.confident && slot.exercise ? t("checkThisMatch") : "",
                    ]}
                  />
                </Pressable>
                <IconButton
                  icon="clear"
                  accessibilityLabel={t("removeItem", { name: slot.said })}
                  onPress={() =>
                    setDays(
                      days.map((x, i) =>
                        i === d ? { ...x, slots: x.slots.filter((_, j) => j !== s) } : x
                      )
                    )
                  }
                />
              </View>
            ))}
          </View>
        ))}
        {days && (
          <Button variant="ghost" className="self-start" onPress={() => setDays(null)}>
            {t("editTheText")}
          </Button>
        )}
        <ErrorText message={error} />
      </Editor>
      <ExercisePicker
        open={!!picking}
        close={() => setPicking(null)}
        title={t("whichExercise")}
        replacing={picking ? days?.[picking.day].slots[picking.slot].exercise : undefined}
        onPick={(exercise) => {
          if (!picking || !days) return;
          setDays(
            days.map((x, i) =>
              i === picking.day
                ? {
                    ...x,
                    slots: x.slots.map((s, j) =>
                      j === picking.slot ? { ...s, exercise, confident: true } : s
                    ),
                  }
                : x
            )
          );
          setPicking(null);
        }}
      />
    </>
  );
}
