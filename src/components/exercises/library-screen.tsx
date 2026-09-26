import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { router } from "expo-router";
import { Chip, SystemButton, SystemText as Text } from "@/components/system";
import { Screen, SearchInput } from "@/components/ui";
import { muscleLabels, searchExercises } from "@/lib/exercises";
import { muscles, type Muscle } from "@/lib/exercises/types";
import { useExercises } from "@/lib/exercise-store";
import { CustomExerciseEditor } from "./custom-exercise-editor";
import { ExerciseRow } from "./exercise-picker";

const LIMIT = 80;

export function LibraryScreen() {
  const { all, settingFor } = useExercises();
  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState<Muscle | null>(null);
  const [favorites, setFavorites] = useState(false);
  const [creating, setCreating] = useState(false);
  const results = useMemo(() => {
    let pool = muscle ? all.filter((e) => e.muscles[muscle] === 1) : all;
    if (favorites) pool = pool.filter((e) => settingFor(e.id)?.favorite);
    const found = searchExercises(pool, query);
    return query ? found : [...found].sort((a, b) => a.name.localeCompare(b.name));
  }, [all, muscle, favorites, query, settingFor]);
  return (
    <>
      <Screen
        title="Exercises"
        action={
          <SystemButton variant="secondary" icon="add" onPress={() => setCreating(true)}>
            New
          </SystemButton>
        }
      >
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={`Search ${all.filter((e) => !e.archived).length} exercises`}
          accessibilityLabel="Search exercises"
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="flex-row gap-2">
            <Chip
              label="★ Favorites"
              selected={favorites}
              onPress={() => setFavorites(!favorites)}
            />
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
        <View>
          {results.slice(0, LIMIT).map((e) => (
            <ExerciseRow
              key={e.id}
              exercise={e}
              favorite={settingFor(e.id)?.favorite}
              onPress={() => router.push({ pathname: "/exercise/[id]", params: { id: e.id } })}
            />
          ))}
          {results.length > LIMIT && (
            <Text className="py-4 text-center text-sm text-muted">
              {results.length - LIMIT} more · search or filter to narrow
            </Text>
          )}
          {!results.length && <Text className="py-8 text-center text-muted">No matches.</Text>}
        </View>
      </Screen>
      <CustomExerciseEditor open={creating} close={() => setCreating(false)} />
    </>
  );
}
