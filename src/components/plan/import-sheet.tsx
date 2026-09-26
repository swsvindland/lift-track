import { useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import { SystemButton, SystemIcon, SystemLabel, SystemText as Text } from "@/components/system";
import { Editor, ErrorText, Field } from "@/components/ui";
import { ExercisePicker } from "@/components/exercises/exercise-picker";
import { setPendingDraft } from "@/lib/draft-store";
import { matchExercise, type Exercise } from "@/lib/exercises";
import { useExercises } from "@/lib/exercise-store";
import { readProgram } from "@/lib/lift-ai";
import { linesToText, recognizeText, textRecognitionAvailable } from "@/lib/local-ai";
import { rirPlan } from "@/lib/progression";
import { modelNote, useModel } from "@/lib/use-model";

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
    if (!permission.granted)
      return setError("Allow camera access in Settings to photograph a page.");
    const result = camera
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled) return;
    const uri = result.assets[0].uri;
    setBusy("photo");
    try {
      const lines = await recognizeText(uri);
      const read = linesToText(lines);
      if (!read.trim()) throw new Error("No text found. Try a flatter, closer photo.");
      setText((current) => (current.trim() ? `${current}\n${read}` : read));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that photo.");
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
      if (!parsed.days.length)
        throw new Error("No exercises with sets and reps found, like “Bench Press 3x6-8”.");
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
      setError(e instanceof Error ? e.message : "Couldn't read that.");
    } finally {
      setBusy("");
    }
  };

  const ready =
    !!days?.length && days.every((d) => d.slots.length && d.slots.every((s) => s.exercise));
  const openEditor = () => {
    if (!days) return;
    setPendingDraft({
      name: "Imported program",
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
        title="Import a program"
        open={open}
        close={close}
        footer={
          days ? (
            <SystemButton isDisabled={!ready} onPress={openEditor}>
              Review in the editor
            </SystemButton>
          ) : (
            <SystemButton isDisabled={!!busy || !text.trim()} onPress={() => void read()}>
              {busy === "read" ? "Reading…" : "Read program"}
            </SystemButton>
          )
        }
      >
        {!days && (
          <>
            {textRecognitionAvailable() && (
              <View className="flex-row gap-2">
                <SystemButton
                  variant="secondary"
                  icon="camera-outline"
                  className="flex-1"
                  isDisabled={!!busy}
                  onPress={() => void photo(true)}
                >
                  Photograph
                </SystemButton>
                <SystemButton
                  variant="secondary"
                  icon="image-outline"
                  className="flex-1"
                  isDisabled={!!busy}
                  onPress={() => void photo(false)}
                >
                  Choose photo
                </SystemButton>
              </View>
            )}
            {busy === "photo" && <Text className="text-muted">Reading the page…</Text>}
            <Field
              label="Program"
              value={text}
              onChange={setText}
              placeholder={
                "Day 1 – Upper\nBench Press 3x6-8\nChest-Supported Row 3x8-12\n\nDay 2 – Lower\nSquat 4x5"
              }
              multiline
            />
            <Text className="text-sm text-muted">
              Paste or photograph it; it&apos;s read on this phone. Loads come from your own history
              once you train, not from the page.
            </Text>
            {modelNote(model.status) && (
              <Text className="text-sm text-muted">{modelNote(model.status)}</Text>
            )}
          </>
        )}
        {days?.map((day, d) => (
          <View key={d} className="gap-2">
            <SystemLabel>{day.name}</SystemLabel>
            {day.slots.map((slot, s) => (
              <View key={s} className="flex-row items-center gap-2 border-b border-separator pb-2">
                <Pressable
                  className="flex-1"
                  accessibilityRole="button"
                  onPress={() => setPicking({ day: d, slot: s })}
                >
                  <Text className={slot.exercise ? "font-medium" : "font-medium text-warning"}>
                    {slot.exercise?.name ?? "Pick an exercise"}
                  </Text>
                  <Text className="text-sm text-muted">
                    “{slot.said}” · {slot.sets} × {slot.reps[0]}
                    {slot.reps[1] !== slot.reps[0] ? `–${slot.reps[1]}` : ""}
                    {!slot.confident && slot.exercise ? " · check this match" : ""}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${slot.said}`}
                  hitSlop={8}
                  onPress={() =>
                    setDays(
                      days.map((x, i) =>
                        i === d ? { ...x, slots: x.slots.filter((_, j) => j !== s) } : x
                      )
                    )
                  }
                >
                  <SystemIcon name="close-circle" color="muted" />
                </Pressable>
              </View>
            ))}
          </View>
        ))}
        {days && (
          <SystemButton variant="ghost" onPress={() => setDays(null)}>
            Edit the text
          </SystemButton>
        )}
        <ErrorText message={error} />
      </Editor>
      <ExercisePicker
        open={!!picking}
        close={() => setPicking(null)}
        title="Which exercise?"
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
