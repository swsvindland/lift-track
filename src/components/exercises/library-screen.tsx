import { useMemo, useState } from "react";
import { router } from "expo-router";
import { muscleLabels, searchExercises } from "@/lib/exercises";
import { muscles, type Muscle } from "@/lib/exercises/types";
import { useExercises } from "@/lib/exercise-store";
import { useStore } from "@/lib/store";
import {
  Button,
  ChipRow,
  Note,
  Panel,
  Screen,
  SearchInput,
  SystemState,
  useKitFormat,
} from "@/vector";
import { CustomExerciseEditor } from "./custom-exercise-editor";
import { ExerciseRow } from "./exercise-picker";

const LIMIT = 80;

export function LibraryScreen() {
  const { t } = useStore();
  const format = useKitFormat();
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
        title={t("exercises")}
        action={
          <Button variant="secondary" icon="add" onPress={() => setCreating(true)}>
            {t("newExercise")}
          </Button>
        }
      >
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={t("searchNExercises", {
            n: format.number(all.filter((e) => !e.archived).length),
          })}
          accessibilityLabel={t("searchExercises")}
        />
        <ChipRow
          values={muscles}
          value={muscle}
          onChange={setMuscle}
          label={(m) => muscleLabels[m]}
          accessibilityLabel={t("filterByMuscle")}
          toggle={{
            label: t("favorites"),
            icon: "favorite",
            value: favorites,
            onChange: setFavorites,
          }}
        />
        {results.length ? (
          <Panel inset="none">
            {results.slice(0, LIMIT).map((e) => (
              <ExerciseRow
                key={e.id}
                exercise={e}
                favorite={settingFor(e.id)?.favorite}
                onPress={() => router.push({ pathname: "/exercise/[id]", params: { id: e.id } })}
              />
            ))}
          </Panel>
        ) : (
          <SystemState kind="empty" message={t("noMatches")} />
        )}
        {results.length > LIMIT && (
          <Note className="text-center">
            {t("moreSearchToNarrow", { n: format.number(results.length - LIMIT) })}
          </Note>
        )}
      </Screen>
      <CustomExerciseEditor open={creating} close={() => setCreating(false)} />
    </>
  );
}
