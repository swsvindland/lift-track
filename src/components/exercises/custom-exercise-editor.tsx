import { useState, type ReactNode } from "react";
import { View } from "react-native";
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
import { useStore } from "@/lib/store";
import {
  Editor,
  ErrorText,
  Field,
  ListRow,
  Panel,
  Select,
  SignalCell,
  Text,
  useHaptics,
} from "@/vector";

const patternLabel = (p: Pattern) =>
  p.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

type Props = {
  open: boolean;
  close: () => void;
  editing?: Exercise;
  onSaved?: (id: string) => void;
};

/**
 * A field label (the kit's field look) over a control with a hint below: the movement Select and the muscle
 * cells. Select's own `showTitle` has no hint slot, so only the equipment Select (no hint) uses it.
 */
function Labeled({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View className="gap-2">
      <Text variant="fieldLabel" tone="secondary">
        {label}
      </Text>
      {children}
      {hint ? (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** Create or edit one of the user's own exercises. */
export function CustomExerciseEditor(props: Props) {
  // Mounted only while open, so every opening starts from the exercise being edited.
  return props.open ? <OpenEditor {...props} /> : null;
}

function OpenEditor({ open, close, editing, onSaved }: Props) {
  const { t } = useStore();
  const haptics = useHaptics();
  const [initial] = useState(() => ({
    name: editing?.name ?? "",
    equipment: editing?.equipment ?? ("machine" as Equipment),
    pattern: editing?.pattern ?? ("horizontalPress" as Pattern),
    weights: (editing?.muscles ?? {}) as Partial<Record<Muscle, 1 | 0.5>>,
    repMin: String(editing?.reps[0] ?? 8),
    repMax: String(editing?.reps[1] ?? 12),
    unilateral: !!editing?.unilateral,
    bodyweight: editing?.load === "bodyweight",
  }));
  const [name, setName] = useState(initial.name);
  const [equipment, setEquipment] = useState<Equipment>(initial.equipment);
  const [pattern, setPattern] = useState<Pattern>(initial.pattern);
  const [weights, setWeights] = useState(initial.weights);
  const [repMin, setRepMin] = useState(initial.repMin);
  const [repMax, setRepMax] = useState(initial.repMax);
  const [unilateral, setUnilateral] = useState(initial.unilateral);
  const [bodyweight, setBodyweight] = useState(initial.bodyweight);
  const [error, setError] = useState("");
  const dirty =
    name !== initial.name ||
    equipment !== initial.equipment ||
    pattern !== initial.pattern ||
    repMin !== initial.repMin ||
    repMax !== initial.repMax ||
    unilateral !== initial.unilateral ||
    bodyweight !== initial.bodyweight ||
    muscles.some((m) => weights[m] !== initial.weights[m]);

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
    if (!name.trim()) return setError(t("giveItAName"));
    if (!Object.values(weights).includes(1)) return setError(t("pickPrimaryMuscle"));
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min || max > 100)
      return setError(t("enterRepRange"));
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
      title={t(editing ? "editExercise" : "newExercise")}
      open={open}
      close={close}
      dirty={dirty}
      primary={{ label: t("save"), onPress: save }}
    >
      <Field
        label={t("name")}
        value={name}
        onChange={setName}
        placeholder={t("customExercisePlaceholder")}
      />
      <Select
        title={t("equipment")}
        showTitle
        values={equipmentList}
        value={equipment}
        onChange={setEquipment}
        label={(e) => equipmentLabels[e]}
      />
      <Labeled label={t("movement")} hint={t("movementHint")}>
        <Select
          title={t("movement")}
          values={patterns}
          value={pattern}
          onChange={setPattern}
          label={patternLabel}
        />
      </Labeled>
      <Labeled label={t("muscles")} hint={t("musclesHint")}>
        {/* Three states per muscle (off, primary, secondary), so cells rather than a ChipRow's on/off chips. */}
        <View className="flex-row flex-wrap gap-2">
          {muscles.map((m) => {
            const label =
              weights[m] === 0.5 ? t("muscleHalf", { muscle: muscleLabels[m] }) : muscleLabels[m];
            return (
              <SignalCell
                key={m}
                size="sm"
                check
                className="px-3"
                selected={!!weights[m]}
                accessibilityLabel={label}
                onPress={() => {
                  haptics.selection();
                  cycle(m);
                }}
              >
                {label}
              </SignalCell>
            );
          })}
        </View>
      </Labeled>
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Field label={t("repsFrom")} value={repMin} onChange={setRepMin} numeric />
        </View>
        <View className="flex-1">
          <Field label={t("repsTo")} value={repMax} onChange={setRepMax} numeric />
        </View>
      </View>
      <Panel inset="none">
        <ListRow
          title={t("oneSideAtATime")}
          trailing="toggle"
          toggleValue={unilateral}
          onToggle={setUnilateral}
        />
        <ListRow
          title={t("bodyweightPlusLoad")}
          trailing="toggle"
          toggleValue={bodyweight}
          onToggle={setBodyweight}
        />
      </Panel>
      <ErrorText message={error} />
    </Editor>
  );
}
