import { useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { Switch } from "heroui-native";
import {
  Chip,
  SystemButton,
  SystemIcon,
  SystemLabel,
  SystemPanel,
  SystemText as Text,
} from "@/components/system";
import { Choices, Editor, ErrorText, Field, SearchInput } from "@/components/ui";
import { write } from "@/lib/data";
import { equipmentLabels, searchExercises, type Exercise } from "@/lib/exercises";
import { equipment as allEquipment, type Equipment } from "@/lib/exercises/types";
import { useExercises } from "@/lib/exercise-store";
import { defaultGym, type NewGym } from "@/lib/loads";
import { parseNumber } from "@/lib/metrics";
import { addGym, archiveGym, setMainGym, updateGym } from "@/lib/workouts";

const plateOptions = {
  kg: [50, 25, 20, 15, 10, 5, 2.5, 2, 1.25, 1, 0.5],
  lb: [100, 55, 45, 35, 25, 10, 5, 2.5, 1.25],
};

const LIMIT = 60;

/** A saved gym, or a new one from a preset that is saved on the first Save. */
export type EditableGym = NewGym & { id?: number };

type Props = {
  open: boolean;
  close: () => void;
  gym: EditableGym;
  /** Workouts start here unless a program names another gym or you're traveling. */
  isMain?: boolean;
  /** Called with the gym's id after a save. */
  onSaved?: (id: number) => void;
};

/** A gym's name, plates and steps, its equipment, and the exercises it can or can't do. */
export function GymEditor(props: Props) {
  // Mounted only while open, so every opening starts from the saved gym.
  return props.open ? <OpenGymEditor {...props} /> : null;
}

function OpenGymEditor({ open, close, gym, isMain = false, onSaved }: Props) {
  const [name, setName] = useState(gym.name);
  const [unit, setUnit] = useState(gym.unit);
  const [bar, setBar] = useState(String(gym.barWeight));
  const [plates, setPlates] = useState(gym.plates);
  const [dbStep, setDbStep] = useState(String(gym.dumbbellStep));
  const [dbMax, setDbMax] = useState(String(gym.dumbbellMax));
  const [machineStep, setMachineStep] = useState(String(gym.machineStep));
  const [equipment, setEquipment] = useState<Equipment[]>(gym.equipment);
  const [excluded, setExcluded] = useState<string[]>(gym.excluded);
  const [included, setIncluded] = useState<string[]>(gym.included);
  const [main, setMain] = useState(isMain);
  const [picking, setPicking] = useState<"excluded" | "included" | null>(null);
  const [error, setError] = useState("");
  const scrollRef = useRef<ScrollView>(null);
  const { all, byId } = useExercises();

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
    const has = (id: string) => equipment.includes(byId(id).equipment);
    const row = {
      name: name.trim() || "My gym",
      unit,
      barWeight: values[0],
      plates: [...plates].sort((a, b) => b - a),
      dumbbellStep: values[1],
      dumbbellMax: values[2],
      machineStep: values[3],
      equipment,
      // Exceptions only matter against the equipment; drop ones it no longer changes.
      excluded: excluded.filter(has),
      included: included.filter((id) => !has(id)),
    };
    const id = write(() => {
      const saved = gym.id ?? addGym(row);
      if (gym.id) updateGym(gym.id, row);
      if (main && !isMain) setMainGym(saved);
      return saved;
    });
    onSaved?.(id);
    close();
  };

  const remove = () => {
    if (!gym.id) return close();
    Alert.alert(`Remove ${gym.name}?`, "Workouts you did there stay in History.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          if (write(() => archiveGym(gym.id!))) close();
          else setError("Keep at least one gym.");
        },
      },
    ]);
  };

  const pickList = (which: "excluded" | "included" | null) => {
    setPicking(which);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  if (picking)
    return (
      <Editor
        title={picking === "excluded" ? "Not at this gym" : "Also at this gym"}
        open={open}
        close={() => pickList(null)}
        scrollRef={scrollRef}
        compact
        footer={<SystemButton onPress={() => pickList(null)}>Done</SystemButton>}
      >
        <ExerciseToggles
          note={
            picking === "excluded"
              ? "Exercises this gym has the equipment for but can't do, like a leg press it doesn't have."
              : "Exercises this gym can do although their equipment isn't turned on, like its one cable station."
          }
          options={all.filter(
            (e) => !e.archived && equipment.includes(e.equipment) === (picking === "excluded")
          )}
          selected={picking === "excluded" ? excluded : included}
          onChange={picking === "excluded" ? setExcluded : setIncluded}
        />
      </Editor>
    );

  const names = (ids: string[]) =>
    ids
      .slice(0, 4)
      .map((id) => byId(id).name)
      .join(", ") + (ids.length > 4 ? ` and ${ids.length - 4} more` : "");
  const shownExcluded = excluded.filter((id) => equipment.includes(byId(id).equipment));
  const shownIncluded = included.filter((id) => !equipment.includes(byId(id).equipment));

  return (
    <Editor
      title={gym.id ? gym.name : `New ${gym.name.toLowerCase()}`}
      open={open}
      close={close}
      scrollRef={scrollRef}
      footer={<SystemButton onPress={save}>Save</SystemButton>}
    >
      <Field label="Name" value={name} onChange={setName} />
      <View className="flex-row items-center justify-between gap-4">
        <View className="flex-1 gap-0.5">
          <Text>Main gym</Text>
          <Text className="text-sm text-muted">
            {isMain
              ? "Workouts start here. Make another gym your main one to change it."
              : "Workouts start here unless a program names another gym or you're traveling."}
          </Text>
        </View>
        <Switch
          accessibilityLabel="Main gym"
          isSelected={main}
          isDisabled={isMain}
          onSelectedChange={setMain}
        />
      </View>
      <View className="gap-2">
        <SystemLabel>Equipment here</SystemLabel>
        <Text className="text-sm text-muted">
          Programs and swaps only use what this gym has. Loads round to its plates and steps.
        </Text>
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
      <View className="gap-2">
        <SystemLabel>Exercises</SystemLabel>
        <SystemPanel className="gap-3">
          <ListRow
            label="Not at this gym"
            detail={shownExcluded.length ? names(shownExcluded) : "Nothing left out"}
            onPress={() => pickList("excluded")}
          />
          <ListRow
            label="Also at this gym"
            detail={shownIncluded.length ? names(shownIncluded) : "Nothing added"}
            onPress={() => pickList("included")}
          />
        </SystemPanel>
      </View>
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
      <ErrorText message={error} />
      {!!gym.id && !isMain && (
        <SystemButton variant="danger-soft" icon="trash-outline" onPress={remove}>
          Remove gym
        </SystemButton>
      )}
    </Editor>
  );
}

function ListRow({
  label,
  detail,
  onPress,
}: {
  label: string;
  detail: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="min-h-11 flex-row items-center gap-3 active:opacity-60"
    >
      <View className="flex-1 gap-0.5">
        <Text>{label}</Text>
        <Text className="text-sm text-muted" numberOfLines={2}>
          {detail}
        </Text>
      </View>
      <SystemIcon name="chevron-forward" size={18} color="muted" />
    </Pressable>
  );
}

/** A searchable list of exercises, each toggled in or out of `selected`; chosen ones first. */
function ExerciseToggles({
  note,
  options,
  selected,
  onChange,
}: {
  note: string;
  options: Exercise[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  // Order is fixed when the list opens, so a row doesn't jump away as it's tapped.
  const [first] = useState(() => new Set(selected));
  const results = useMemo(
    () => searchExercises(options, query, (e) => (first.has(e.id) ? 100 : 0)),
    [options, query, first]
  );
  return (
    <>
      <Text className="text-sm text-muted">{note}</Text>
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Search exercises"
        accessibilityLabel="Search exercises"
      />
      <View>
        {results.slice(0, LIMIT).map((e) => {
          const on = selected.includes(e.id);
          return (
            <Pressable
              key={e.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              onPress={() =>
                onChange(on ? selected.filter((x) => x !== e.id) : [...selected, e.id])
              }
              className="flex-row items-center gap-3 border-b border-separator py-3 active:opacity-60"
            >
              <View className="flex-1 gap-0.5">
                <Text className="font-medium" numberOfLines={1}>
                  {e.name}
                </Text>
                <Text className="text-sm text-muted">{equipmentLabels[e.equipment]}</Text>
              </View>
              <SystemIcon
                name={on ? "checkmark-circle" : "ellipse-outline"}
                size={22}
                color={on ? "accent" : "muted"}
              />
            </Pressable>
          );
        })}
        {results.length > LIMIT && (
          <Text className="py-4 text-center text-sm text-muted">
            {results.length - LIMIT} more · keep typing to narrow
          </Text>
        )}
        {!results.length && (
          <Text className="py-6 text-center text-muted">
            {options.length ? "No exercise matches." : "Nothing to pick with this equipment."}
          </Text>
        )}
      </View>
    </>
  );
}
