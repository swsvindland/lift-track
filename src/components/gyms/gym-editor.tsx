import { useMemo, useRef, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, View } from "react-native";
import { write } from "@/lib/data";
import { equipmentLabels, searchExercises, type Exercise } from "@/lib/exercises";
import { equipment as allEquipment, type Equipment } from "@/lib/exercises/types";
import { useExercises } from "@/lib/exercise-store";
import { defaultGym, type NewGym } from "@/lib/loads";
import { parseNumber } from "@/lib/metrics";
import { useStore } from "@/lib/store";
import { useCount } from "@/lib/use-count";
import { addGym, archiveGym, setMainGym, updateGym } from "@/lib/workouts";
import {
  ChipRow,
  Choices,
  Editor,
  ErrorText,
  Field,
  Icon,
  Label,
  ListRow,
  Note,
  Panel,
  SearchInput,
  SettingsSection,
  SystemState,
  Text,
  useKitFormat,
  useKitStrings,
} from "@/vector";

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
  const { t } = useStore();
  const strings = useKitStrings();
  const format = useKitFormat();
  const count = useCount();
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

  // A new gym is unsaved by definition; a saved one only once something differs from it.
  const dirty =
    !gym.id ||
    JSON.stringify([
      name,
      unit,
      bar,
      plates,
      dbStep,
      dbMax,
      machineStep,
      equipment,
      excluded,
      included,
      main,
    ]) !==
      JSON.stringify([
        gym.name,
        gym.unit,
        String(gym.barWeight),
        gym.plates,
        String(gym.dumbbellStep),
        String(gym.dumbbellMax),
        String(gym.machineStep),
        gym.equipment,
        gym.excluded,
        gym.included,
        isMain,
      ]);

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
      return setError(t("gymNumbersError"));
    if (!plates.length) return setError(t("pickPlateError"));
    const has = (id: string) => equipment.includes(byId(id).equipment);
    const row = {
      name: name.trim() || t("myGym"),
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
    // vector: irreversible
    Alert.alert(t("removeNamed", { name: gym.name }), t("workoutsThereStayInHistory"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("remove"),
        style: "destructive",
        onPress: () => {
          if (write(() => archiveGym(gym.id!))) close();
          else setError(t("keepOneGym"));
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
        title={picking === "excluded" ? t("notAtThisGym") : t("alsoAtThisGym")}
        open={open}
        close={() => pickList(null)}
        // Cancel, Done and Android back all lead back to the gym, which may hold unsaved changes, so only the
        // iOS swipe, which would take the whole sheet away, is held.
        dirty={Platform.OS === "ios"}
        scrollRef={scrollRef}
        compact
        primary={{ label: strings.done, onPress: () => pickList(null) }}
      >
        <ExerciseToggles
          note={picking === "excluded" ? t("notAtThisGymNote") : t("alsoAtThisGymNote")}
          options={all.filter(
            (e) => !e.archived && equipment.includes(e.equipment) === (picking === "excluded")
          )}
          selected={picking === "excluded" ? excluded : included}
          onChange={picking === "excluded" ? setExcluded : setIncluded}
        />
      </Editor>
    );

  /** Up to four names, then "and n more", as one locale list. */
  const names = (ids: string[]) =>
    format.list([
      ...ids.slice(0, 4).map((id) => byId(id).name),
      ...(ids.length > 4 ? [count(ids.length - 4, "nMoreOne", "nMore")] : []),
    ]);
  const shownExcluded = excluded.filter((id) => equipment.includes(byId(id).equipment));
  const shownIncluded = included.filter((id) => !equipment.includes(byId(id).equipment));
  const intlUnit = unit === "kg" ? "kilogram" : "pound";

  return (
    <Editor
      // A new gym is named by its preset in the eyebrow, never by lowercasing it into a sentence.
      title={gym.id ? gym.name : t("newGym")}
      eyebrow={gym.id ? undefined : gym.name}
      open={open}
      close={close}
      dirty={dirty}
      scrollRef={scrollRef}
      primary={{ label: strings.save, onPress: save }}
      destructive={gym.id && !isMain ? { label: t("removeGym"), onPress: remove } : undefined}
    >
      <Field label={t("name")} value={name} onChange={setName} />
      <Panel inset="none">
        {isMain ? (
          // The main gym changes by making another one main, so here it is a fact, not a switch.
          <ListRow title={t("mainGym")} description={t("mainGymIsMain")} trailing="check" />
        ) : (
          <ListRow
            title={t("mainGym")}
            description={t("mainGymNote")}
            trailing="toggle"
            toggleValue={main}
            onToggle={setMain}
          />
        )}
      </Panel>
      <View className="gap-2">
        <Label accessibilityRole="header">{t("equipmentHere")}</Label>
        <Note>{t("equipmentHereNote")}</Note>
        <ChipRow
          multiple
          values={allEquipment}
          value={equipment}
          onChange={setEquipment}
          label={(e) => equipmentLabels[e]}
          accessibilityLabel={t("equipmentHere")}
        />
      </View>
      <SettingsSection eyebrow={t("exercises")}>
        <ListRow
          title={t("notAtThisGym")}
          description={shownExcluded.length ? names(shownExcluded) : t("nothingLeftOut")}
          onPress={() => pickList("excluded")}
        />
        <ListRow
          title={t("alsoAtThisGym")}
          description={shownIncluded.length ? names(shownIncluded) : t("nothingAdded")}
          onPress={() => pickList("included")}
        />
      </SettingsSection>
      <View className="gap-2">
        <Label accessibilityRole="header">{t("platesAreIn")}</Label>
        <Choices
          values={["kg", "lb"] as const}
          value={unit}
          onChange={switchUnit}
          label={(u) => u}
          accessibilityLabel={t("platesAreIn")}
        />
      </View>
      <Field label={t("barbell")} value={bar} onChange={setBar} unit={unit} numeric />
      <View className="gap-2">
        <Label accessibilityRole="header">{t("platesYouHave")}</Label>
        <ChipRow
          multiple
          values={plateOptions[unit].map(String)}
          value={plates.map(String)}
          onChange={(on) => setPlates(on.map(Number))}
          label={(p) => format.unit(Number(p), intlUnit, 2)}
          accessibilityLabel={t("platesYouHave")}
        />
      </View>
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Field
            label={t("dumbbellStep")}
            value={dbStep}
            onChange={setDbStep}
            unit={unit}
            numeric
          />
        </View>
        <View className="flex-1">
          <Field
            label={t("heaviestDumbbell")}
            value={dbMax}
            onChange={setDbMax}
            unit={unit}
            numeric
          />
        </View>
      </View>
      <Field
        label={t("machineCableStep")}
        value={machineStep}
        onChange={setMachineStep}
        unit={unit}
        numeric
      />
      <ErrorText message={error} />
    </Editor>
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
  const { t } = useStore();
  const format = useKitFormat();
  const [query, setQuery] = useState("");
  // Order is fixed when the list opens, so a row doesn't jump away as it's tapped.
  const [first] = useState(() => new Set(selected));
  const results = useMemo(
    () => searchExercises(options, query, (e) => (first.has(e.id) ? 100 : 0)),
    [options, query, first]
  );
  return (
    <>
      <Note>{note}</Note>
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder={t("searchExercises")}
        accessibilityLabel={t("searchExercises")}
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
              className="min-h-14 flex-row items-center gap-3 border-b border-separator py-3 active:bg-surface-secondary"
            >
              <View className="flex-1 gap-0.5">
                <Text variant="bodyStrong">{e.name}</Text>
                <Note>{equipmentLabels[e.equipment]}</Note>
              </View>
              {/* Reserved, so checking never shifts the row. */}
              <View className={on ? "" : "opacity-0"}>
                <Icon name="check" size={20} tone="tint" />
              </View>
            </Pressable>
          );
        })}
        {results.length > LIMIT && (
          <Note className="py-4">
            {t("moreKeepTyping", { n: format.number(results.length - LIMIT) })}
          </Note>
        )}
        {!results.length && (
          <SystemState
            kind="empty"
            message={options.length ? t("noExerciseMatches") : t("nothingToPick")}
          />
        )}
      </View>
    </>
  );
}
