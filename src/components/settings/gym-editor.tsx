import { useState } from "react";
import { View } from "react-native";
import { Chip, SystemButton, SystemLabel, SystemText as Text } from "@/components/system";
import { Choices, Editor, ErrorText, Field } from "@/components/ui";
import type { Gym } from "@/db";
import { write } from "@/lib/data";
import { equipmentLabels } from "@/lib/exercises";
import { equipment as allEquipment, type Equipment } from "@/lib/exercises/types";
import { defaultGym } from "@/lib/loads";
import { parseNumber } from "@/lib/metrics";
import { updateGym } from "@/lib/workouts";

const plateOptions = {
  kg: [50, 25, 20, 15, 10, 5, 2.5, 2, 1.25, 1, 0.5],
  lb: [100, 55, 45, 35, 25, 10, 5, 2.5, 1.25],
};

type Props = { open: boolean; close: () => void; gym: Gym };

/** The gym's bar, plates and steps; loads round to what it can actually make. */
export function GymEditor(props: Props) {
  // Mounted only while open, so every opening starts from the saved gym.
  return props.open ? <OpenGymEditor {...props} /> : null;
}

function OpenGymEditor({ open, close, gym }: Props) {
  const [name, setName] = useState(gym.name);
  const [unit, setUnit] = useState(gym.unit);
  const [bar, setBar] = useState(String(gym.barWeight));
  const [plates, setPlates] = useState(gym.plates);
  const [dbStep, setDbStep] = useState(String(gym.dumbbellStep));
  const [dbMax, setDbMax] = useState(String(gym.dumbbellMax));
  const [machineStep, setMachineStep] = useState(String(gym.machineStep));
  const [equipment, setEquipment] = useState<Equipment[]>(gym.equipment);
  const [error, setError] = useState("");

  const switchUnit = (next: "kg" | "lb") => {
    if (next === unit) return;
    // Plates don't convert: a lb gym has different plates, so start from typical ones.
    const typical = defaultGym(next);
    setUnit(next);
    setBar(String(typical.barWeight));
    setPlates(typical.plates);
    setDbStep(String(typical.dumbbellStep));
    setDbMax(String(typical.dumbbellMax));
    setMachineStep(String(typical.machineStep));
  };

  const save = () => {
    const values = [bar, dbStep, dbMax, machineStep].map(parseNumber);
    if (values.some((v) => !Number.isFinite(v)) || values.slice(1).some((v) => v <= 0))
      return setError("Enter the bar weight and steps as numbers.");
    if (!plates.length) return setError("Pick at least one plate size.");
    write(() =>
      updateGym(gym.id, {
        name: name.trim() || "My gym",
        unit,
        barWeight: values[0],
        plates: [...plates].sort((a, b) => b - a),
        dumbbellStep: values[1],
        dumbbellMax: values[2],
        machineStep: values[3],
        equipment,
      })
    );
    close();
  };

  return (
    <Editor
      title="Gym & plates"
      open={open}
      close={close}
      footer={<SystemButton onPress={save}>Save</SystemButton>}
    >
      <Field label="Name" value={name} onChange={setName} />
      <View className="gap-2">
        <SystemLabel>Plates are in</SystemLabel>
        <Choices
          values={["kg", "lb"] as const}
          value={unit}
          onChange={switchUnit}
          label={(u) => u}
        />
      </View>
      <Field label={`Barbell (${unit})`} value={bar} onChange={setBar} numeric />
      <View className="gap-2">
        <SystemLabel>Plates you have ({unit})</SystemLabel>
        <View className="flex-row flex-wrap gap-2">
          {plateOptions[unit].map((p) => (
            <Chip
              key={p}
              label={String(p)}
              selected={plates.includes(p)}
              onPress={() =>
                setPlates(plates.includes(p) ? plates.filter((x) => x !== p) : [...plates, p])
              }
            />
          ))}
        </View>
      </View>
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Field label={`Dumbbell step (${unit})`} value={dbStep} onChange={setDbStep} numeric />
        </View>
        <View className="flex-1">
          <Field label={`Heaviest dumbbell`} value={dbMax} onChange={setDbMax} numeric />
        </View>
      </View>
      <Field
        label={`Machine & cable step (${unit})`}
        value={machineStep}
        onChange={setMachineStep}
        numeric
      />
      <View className="gap-2">
        <SystemLabel>Equipment here</SystemLabel>
        <Text className="text-sm text-muted">Swap suggestions only offer what this gym has.</Text>
        <View className="flex-row flex-wrap gap-2">
          {allEquipment.map((e) => (
            <Chip
              key={e}
              label={equipmentLabels[e]}
              selected={equipment.includes(e)}
              onPress={() =>
                setEquipment(
                  equipment.includes(e) ? equipment.filter((x) => x !== e) : [...equipment, e]
                )
              }
            />
          ))}
        </View>
      </View>
      <ErrorText message={error} />
    </Editor>
  );
}
