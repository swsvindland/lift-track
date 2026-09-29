import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@/lib/data";
import { useExercises } from "@/lib/exercise-store";
import { useLiftFormat } from "@/lib/format";
import { useStore } from "@/lib/store";
import { useCount } from "@/lib/use-count";
import { weekStart } from "@/lib/volume";
import { finishedWorkouts, type WorkoutSummary } from "@/lib/workouts";
import {
  Button,
  DetailScreen,
  ListRow,
  Meta,
  Note,
  Panel,
  SystemState,
  useKitFormat,
} from "@/vector";

/** One finished workout: its name (or day), when and how long, and what was trained. */
function WorkoutRow({ workout: w }: { workout: WorkoutSummary }) {
  const { dayLabel, duration } = useLiftFormat();
  const format = useKitFormat();
  const count = useCount();
  const { byId } = useExercises();
  const day = dayLabel(w.startedAt);
  return (
    <ListRow
      title={w.name || day}
      description={
        <View className="gap-0.5">
          <Meta
            items={[
              w.name ? day : "",
              duration(w.startedAt, w.endedAt),
              count(w.setCount, "setCountOne", "setCount"),
            ]}
          />
          <Note>{format.list([...new Set(w.exerciseIds)].map((id) => byId(id).name))}</Note>
        </View>
      }
      onPress={() => router.push({ pathname: "/session/[id]", params: { id: String(w.id) } })}
    />
  );
}

export function HistoryScreen() {
  const { t } = useStore();
  const format = useKitFormat();
  const count = useCount();
  const [limit, setLimit] = useState(40);
  const list = useQuery(() => {
    return finishedWorkouts(limit + 1);
  }, [limit]);
  const weeks = new Map<string, WorkoutSummary[]>();
  for (const w of list.slice(0, limit)) {
    const key = weekStart(new Date(w.startedAt)).toISOString();
    weeks.set(key, [...(weeks.get(key) ?? []), w]);
  }
  return (
    <DetailScreen title={t("allWorkouts")}>
      {!list.length && <SystemState kind="empty" message={t("historyEmpty")} />}
      {[...weeks].map(([week, items]) => (
        <Panel key={week} inset="none">
          <Panel.Header
            eyebrow={t("weekOf", {
              day: format.monthDay(new Date(week)),
            })}
            meta={count(items.length, "workoutCountOne", "workoutCount")}
          />
          {items.map((w) => (
            <WorkoutRow key={w.id} workout={w} />
          ))}
        </Panel>
      ))}
      {list.length > limit && (
        <Button variant="ghost" onPress={() => setLimit(limit + 40)}>
          {t("showOlder")}
        </Button>
      )}
    </DetailScreen>
  );
}
