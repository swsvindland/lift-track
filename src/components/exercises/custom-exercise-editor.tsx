import { useState } from "react";
import { Switch } from "heroui-native";
import { View } from "react-native";
import { Chip, SystemButton, SystemLabel, SystemText as Text } from "@/components/system";
import { Editor, ErrorText, Field, SettingsSelect } from "@/components/ui";
import { equipmentLabels, muscleLabels, type Exercise } from "@/lib/exercises";
import {
  equipment as equipmentList,
  muscles,
  patterns,
  type Equipment,
  type Muscle,
  type Pattern,
} from "@/lib/exercises/types";
import { saveCustomExercise } from "@/lib/exercise-store";

const patternLabel = (p: Pattern) =>
  p.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

type Props = {
  open: boolean;
  close: () => void;
  editing?: Exercise;
  onSaved?: (id: string) => void;
};

/** Create or edit one of the user's own exercises. */
export function CustomExerciseEditor(props: Props) {
  // Mounted only while open, so every opening starts from the exercise being edited.
  return props.open ? <OpenEditor {...props} /> : null;
}

function OpenEditor({ open, close, editing, onSaved }: Props) {
  const [name, setName] = useState(editing?.name ?? "");
  const [equipment, setEquipment] = useState<Equipment>(editing?.equipment ?? "machine");
  const [pattern, setPattern] = useState<Pattern>(editing?.pattern ?? "horizontalPress");
  const [weights, setWeights] = useState<Partial<Record<Muscle, 1 | 0.5>>>(editing?.muscles ?? {});
  const [repMin, setRepMin] = useState(String(editing?.reps[0] ?? 8));
  const [repMax, setRepMax] = useState(String(editing?.reps[1] ?? 12));
  const [unilateral, setUnilateral] = useState(!!editing?.unilateral);
  const [bodyweight, setBodyweight] = useState(editing?.load === "bodyweight");
  const [error, setError] = useState("");

  // Tapping a muscle cycles: not trained → primary → secondary → not trained.
  const cycle = (m: Muscle) =>
    setWeights((w) => {
      const next = { ...w };
      if (!next[m]) next[m] = 1;
      else if (next[m] === 1) next[m] = 0.5;
      else delete next[m];
      return next;
    });

  const save = () => {
    const min = Number(repMin);
    const max = Number(repMax);
    if (!name.trim()) return setError("Give it a name.");
    if (!Object.values(weights).includes(1)) return setError("Pick at least one primary muscle.");
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min || max > 100)
      return setError("Enter a rep range such as 8 to 12.");
    const id = saveCustomExercise({
      id: editing?.id,
      name,
      equipment,
      pattern,
      muscles: weights,
      unilateral,
      load: bodyweight ? "bodyweight" : undefined,
      reps: [min, max],
      cue: editing?.cue ?? "",
    });
    onSaved?.(id);
    close();
  };

  return (
    <Editor
      title={editing ? "Edit exercise" : "New exercise"}
      open={open}
      close={close}
      footer={<SystemButton onPress={save}>Save</SystemButton>}
    >
      <Field label="Name" value={name} onChange={setName} placeholder="Cable Y-Raise" />
      <View className="gap-2">
        <SystemLabel>Equipment</SystemLabel>
        <SettingsSelect
          title="Equipment"
          values={equipmentList}
          value={equipment}
          onChange={setEquipment}
          label={(e) => equipmentLabels[e]}
        />
      </View>
      <View className="gap-2">
        <SystemLabel>Movement</SystemLabel>
        <SettingsSelect
          title="Movement"
          values={patterns}
          value={pattern}
          onChange={setPattern}
          label={patternLabel}
        />
        <Text className="text-sm text-muted">Swaps suggest exercises with the same movement.</Text>
      </View>
      <View className="gap-2">
        <SystemLabel>Muscles</SystemLabel>
        <Text className="text-sm text-muted">
          Tap once for a primary muscle (a full set), twice for secondary (half a set).
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {muscles.map((m) => (
            <Chip
              key={m}
              label={`${muscleLabels[m]}${weights[m] === 0.5 ? " ½" : ""}`}
              selected={!!weights[m]}
              onPress={() => cycle(m)}
            />
          ))}
        </View>
      </View>
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Field label="Reps from" value={repMin} onChange={setRepMin} numeric />
        </View>
        <View className="flex-1">
          <Field label="to" value={repMax} onChange={setRepMax} numeric />
        </View>
      </View>
      <View className="flex-row items-center justify-between">
        <Text>One side at a time</Text>
        <Switch
          isSelected={unilateral}
          onSelectedChange={setUnilateral}
          accessibilityLabel="One side at a time"
        />
      </View>
      <View className="flex-row items-center justify-between">
        <Text>Body weight plus added load</Text>
        <Switch
          isSelected={bodyweight}
          onSelectedChange={setBodyweight}
          accessibilityLabel="Body weight plus added load"
        />
      </View>
      <ErrorText message={error} />
    </Editor>
  );
}
