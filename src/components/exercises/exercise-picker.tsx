import { useMemo, useState } from "react";
import { View } from "react-native";
import { useQuery } from "@/lib/data";
import {
  equipmentLabels,
  muscleLabels,
  primaryMuscles,
  searchExercises,
  substitutes,
  type Exercise,
  type GymAccess,
} from "@/lib/exercises";
import { muscles, type Muscle } from "@/lib/exercises/types";
import { useExercises } from "@/lib/exercise-store";
import { useStore } from "@/lib/store";
import { exerciseUsage } from "@/lib/workouts";
import { describeExercise } from "@/lib/lift-ai";
import { useModel } from "@/lib/use-model";
import {
  Button,
  ChipRow,
  Editor,
  Icon,
  ListRow,
  Note,
  Panel,
  SearchInput,
  useKitFormat,
} from "@/vector";

const LIMIT = 60;

/** An exercise in a row list (a direct child of `Panel inset="none"`): name, primary muscles and equipment. */
export function ExerciseRow({
  exercise,
  onPress,
  detail,
  favorite,
}: {
  exercise: Exercise;
  onPress: () => void;
  detail?: string;
  favorite?: boolean;
}) {
  const { t } = useStore();
  const format = useKitFormat();
  const trained = format.list(primaryMuscles(exercise).map((m) => muscleLabels[m]));
  const equipment = equipmentLabels[exercise.equipment];
  return (
    <ListRow
      title={exercise.name}
      description={
        detail ?? (trained ? t("exerciseDetail", { muscles: trained, equipment }) : equipment)
      }
      trailing={favorite ? <Icon name="favorite" size={16} tone="muted" /> : "none"}
      onPress={onPress}
    />
  );
}

/** Search, filter by muscle and pick an exercise. With `replacing`, similar ones come first. */
export function ExercisePicker({
  open,
  close,
  onPick,
  replacing,
  gym,
  title,
}: {
  open: boolean;
  close: () => void;
  onPick: (exercise: Exercise) => void;
  replacing?: Exercise;
  /** Similar exercises are limited to what this gym can do. */
  gym?: GymAccess;
  title?: string;
}) {
  const { t } = useStore();
  const format = useKitFormat();
  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState<Muscle | null>(null);
  const [described, setDescribed] = useState<Exercise[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState("");
  const model = useModel();
  const { all, settings, settingFor } = useExercises();
  const usage = useQuery(() => {
    return open ? exerciseUsage() : new Map();
  }, [open]);
  const results = useMemo(() => {
    const pool = muscle ? all.filter((e) => e.muscles[muscle] === 1) : all;
    return searchExercises(pool, query, (e) => {
      const used = usage.get(e.id);
      return (settingFor(e.id)?.favorite ? 3 : 0) + (used ? Math.min(3, 1 + used.count / 5) : 0);
    });
  }, [all, muscle, query, usage, settingFor]);
  const similar = useMemo(
    () =>
      replacing && !query && !muscle
        ? substitutes(replacing, all, { gym, settings, limit: 8 })
        : [],
    [replacing, query, muscle, all, gym, settings]
  );
  const pick = (exercise: Exercise) => {
    onPick(exercise);
    setQuery("");
    setMuscle(null);
  };
  const rows = (list: Exercise[]) =>
    list.map((e) => (
      <ExerciseRow
        key={e.id}
        exercise={e}
        favorite={settingFor(e.id)?.favorite}
        onPress={() => pick(e)}
      />
    ));
  return (
    <Editor title={title ?? t("addExercise")} open={open} close={close} compact>
      <SearchInput
        value={query}
        onChange={(value) => {
          setQuery(value);
          setDescribed(null);
          setAskError("");
        }}
        placeholder={t("searchExercises")}
        accessibilityLabel={t("searchExercises")}
      />
      <ChipRow
        values={muscles}
        value={muscle}
        onChange={setMuscle}
        label={(m) => muscleLabels[m]}
        accessibilityLabel={t("filterByMuscle")}
      />
      {similar.length > 0 && (
        <Panel inset="none">
          <Panel.Header eyebrow={t("similarTo", { name: replacing?.name ?? "" })} />
          {rows(similar)}
        </Panel>
      )}
      {results.length > 0 && (
        <Panel inset="none">
          {similar.length > 0 && <Panel.Header eyebrow={t("allExercises")} />}
          {rows(results.slice(0, LIMIT))}
        </Panel>
      )}
      {results.length > LIMIT && (
        <Note className="text-center">
          {t("moreKeepTyping", { n: format.number(results.length - LIMIT) })}
        </Note>
      )}
      {!results.length && !described && (
        <View className="items-center gap-3 py-6">
          <Note className="text-center">{t("noExerciseMatchesAddOwn")}</Note>
          {model.available && query.trim().split(/\s+/).length >= 2 && (
            <Button
              variant="secondary"
              icon="analysis"
              loading={asking}
              loadingLabel={t("thinking")}
              onPress={() => {
                setAsking(true);
                describeExercise(query, all, model.generate!)
                  .then(setDescribed)
                  .catch((e) => {
                    setDescribed(null);
                    setAskError(e instanceof Error ? e.message : "");
                  })
                  .finally(() => setAsking(false));
              }}
            >
              {t("findFromDescription")}
            </Button>
          )}
          {!!askError && <Note className="text-center">{askError}</Note>}
        </View>
      )}
      {!results.length && !!described?.length && (
        <Panel inset="none">
          {described.map((e) => (
            <ExerciseRow key={e.id} exercise={e} onPress={() => pick(e)} />
          ))}
        </Panel>
      )}
      {!results.length && described?.length === 0 && (
        <Note className="text-center">{t("nothingClose")}</Note>
      )}
    </Editor>
  );
}
