import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import {
  Chip,
  SystemButton,
  SystemIcon,
  SystemLabel,
  SystemText as Text,
} from "@/components/system";
import { Editor, SearchInput } from "@/components/ui";
import { useQuery } from "@/lib/data";
import {
  equipmentLabels,
  muscleLabels,
  primaryMuscles,
  searchExercises,
  substitutes,
  type Exercise,
} from "@/lib/exercises";
import { muscles, type Equipment, type Muscle } from "@/lib/exercises/types";
import { useExercises } from "@/lib/exercise-store";
import { exerciseUsage } from "@/lib/workouts";
import { describeExercise } from "@/lib/lift-ai";
import { useModel } from "@/lib/use-model";
import { AiMark } from "@/components/ai-mark";

const LIMIT = 60;

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
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="flex-row items-center gap-3 border-b border-separator py-3 active:opacity-60"
    >
      <View className="flex-1 gap-0.5">
        <Text className="font-medium" numberOfLines={1}>
          {exercise.name}
        </Text>
        <Text className="text-sm text-muted" numberOfLines={1}>
          {detail ??
            [
              primaryMuscles(exercise)
                .map((m) => muscleLabels[m])
                .join(", "),
              equipmentLabels[exercise.equipment],
            ]
              .filter(Boolean)
              .join(" · ")}
        </Text>
      </View>
      {favorite && <SystemIcon name="star" size={16} color="warning" />}
    </Pressable>
  );
}

/** Search, filter by muscle and pick an exercise. With `replacing`, similar ones come first. */
export function ExercisePicker({
  open,
  close,
  onPick,
  replacing,
  equipment,
  title = "Add exercise",
}: {
  open: boolean;
  close: () => void;
  onPick: (exercise: Exercise) => void;
  replacing?: Exercise;
  equipment?: readonly Equipment[];
  title?: string;
}) {
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
        ? substitutes(replacing, all, { equipment, settings, limit: 8 })
        : [],
    [replacing, query, muscle, all, equipment, settings]
  );
  const pick = (exercise: Exercise) => {
    onPick(exercise);
    setQuery("");
    setMuscle(null);
  };
  return (
    <Editor title={title} open={open} close={close} compact>
      <SearchInput
        value={query}
        onChange={(value) => {
          setQuery(value);
          setDescribed(null);
          setAskError("");
        }}
        placeholder="Search exercises"
        accessibilityLabel="Search exercises"
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-row gap-2">
          {muscles.map((m) => (
            <Chip
              key={m}
              label={muscleLabels[m]}
              selected={muscle === m}
              onPress={() => setMuscle(muscle === m ? null : m)}
            />
          ))}
        </View>
      </ScrollView>
      {similar.length > 0 && (
        <View>
          <SystemLabel className="pt-2">Similar to {replacing?.name}</SystemLabel>
          {similar.map((e) => (
            <ExerciseRow
              key={e.id}
              exercise={e}
              favorite={settingFor(e.id)?.favorite}
              onPress={() => pick(e)}
            />
          ))}
          <SystemLabel className="pt-4">All exercises</SystemLabel>
        </View>
      )}
      <View>
        {results.slice(0, LIMIT).map((e) => (
          <ExerciseRow
            key={e.id}
            exercise={e}
            favorite={settingFor(e.id)?.favorite}
            onPress={() => pick(e)}
          />
        ))}
        {results.length > LIMIT && (
          <Text className="py-4 text-center text-sm text-muted">
            {results.length - LIMIT} more · keep typing to narrow
          </Text>
        )}
        {!results.length && !described && (
          <View className="items-center gap-3 py-6">
            <Text className="text-center text-muted">
              No exercise matches. Add your own from the Exercises tab.
            </Text>
            {model.available && query.trim().split(/\s+/).length >= 2 && (
              <SystemButton
                variant="secondary"
                icon={<AiMark size={18} color="accent-soft-foreground" />}
                isDisabled={asking}
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
                {asking ? "Thinking…" : "Find it from the description"}
              </SystemButton>
            )}
            {!!askError && <Text className="text-center text-sm text-muted">{askError}</Text>}
          </View>
        )}
        {!results.length &&
          described?.map((e) => <ExerciseRow key={e.id} exercise={e} onPress={() => pick(e)} />)}
        {!results.length && described?.length === 0 && (
          <Text className="py-4 text-center text-muted">Nothing close. Try other words.</Text>
        )}
      </View>
    </Editor>
  );
}
