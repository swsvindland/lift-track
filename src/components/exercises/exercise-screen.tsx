import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@/lib/data";
import { equipmentLabels, muscleLabels } from "@/lib/exercises";
import type { Muscle } from "@/lib/exercises/types";
import { archiveCustomExercise, saveExerciseSetting, useExercises } from "@/lib/exercise-store";
import { useLiftFormat } from "@/lib/format";
import { defaultRest, formatClock } from "@/lib/rest-timer";
import { useStore } from "@/lib/store";
import { countsAsWork, e1rm } from "@/lib/strength";
import { exerciseHistory } from "@/lib/workouts";
import { CustomExerciseEditor } from "./custom-exercise-editor";
import { StrengthChart } from "@/components/progress/strength-chart";
import { strengthSeries } from "@/lib/analytics";
import {
  Button,
  DetailScreen,
  Label,
  ListRow,
  Meta,
  Note,
  Panel,
  Select,
  SystemState,
  Text,
  useKitFormat,
} from "@/vector";

const restChoices = ["default", "60", "90", "120", "150", "180", "240", "300"] as const;

export function ExerciseScreen({ id }: { id: string }) {
  const { units, t } = useStore();
  const { dayLabel, estimateText, setList, setText } = useLiftFormat();
  const format = useKitFormat();
  const { byId, settingFor } = useExercises();
  const [editing, setEditing] = useState(false);
  const exercise = byId(id);
  const setting = settingFor(id);
  const history = useQuery(() => {
    return exerciseHistory(id, { limit: 100 });
  }, [id]);
  const best = history
    .flatMap((p) => p.sets.filter((s) => countsAsWork(s.kind)).map((s) => ({ s, p })))
    .reduce<{ value: number; day: string } | null>((top, { s, p }) => {
      const value = e1rm(s.weightKg ?? 0, s.reps ?? 0, s.rir);
      return value > (top?.value ?? 0) ? { value, day: p.startedAt } : top;
    }, null);
  const strength = useQuery(() => strengthSeries(exercise), [exercise]);
  const muscles = Object.entries(exercise.muscles) as [Muscle, number][];
  const rest = setting?.restSeconds ? String(setting.restSeconds) : "default";

  return (
    <DetailScreen title={exercise.name}>
      <View className="gap-1">
        <Meta
          items={[
            equipmentLabels[exercise.equipment],
            exercise.unilateral ? t("oneSideAtATime") : "",
            t("repRange", { range: format.range(exercise.reps[0], exercise.reps[1]) }),
          ]}
        />
        <Text>
          {format.list(
            muscles
              .sort((a, b) => b[1] - a[1])
              .map(([m, w]) =>
                w === 0.5 ? t("muscleHalf", { muscle: muscleLabels[m] }) : muscleLabels[m]
              )
          )}
        </Text>
        {!!exercise.cue && (
          <Text tone="muted" className="pt-2">
            {exercise.cue}
          </Text>
        )}
      </View>

      {best && (
        <Panel>
          <StrengthChart series={strength} name={exercise.name} />
          <Note>
            {t("bestEver", {
              value: estimateText(best.value, units),
              day: dayLabel(best.day),
            })}
          </Note>
        </Panel>
      )}

      <Panel inset="none">
        <ListRow
          title={t("favorite")}
          trailing="toggle"
          toggleValue={!!setting?.favorite}
          onToggle={(favorite) => saveExerciseSetting(id, { favorite })}
        />
        <ListRow
          title={t("avoid")}
          description={t("avoidHint")}
          trailing="toggle"
          toggleValue={!!setting?.avoid}
          onToggle={(avoid) => saveExerciseSetting(id, { avoid })}
        />
      </Panel>

      <View className="gap-2">
        <Label accessibilityRole="header">{t("restAfterSet")}</Label>
        <Select
          title={t("restAfterSet")}
          values={restChoices}
          value={
            restChoices.includes(rest as never) ? (rest as (typeof restChoices)[number]) : "default"
          }
          onChange={(value) =>
            saveExerciseSetting(id, { restSeconds: value === "default" ? null : Number(value) })
          }
          label={(value) =>
            value === "default"
              ? t("restDefault", { time: formatClock(defaultRest(exercise)) })
              : formatClock(Number(value))
          }
        />
      </View>

      {history.length ? (
        <Panel inset="none">
          <Panel.Header eyebrow={t("history")} />
          {history.map((p) => (
            <ListRow
              key={p.block.id}
              title={dayLabel(p.startedAt)}
              description={setList(
                p.sets.filter((s) => countsAsWork(s.kind)).map((s) => setText(s, units))
              )}
              onPress={() =>
                router.push({ pathname: "/session/[id]", params: { id: String(p.workoutId) } })
              }
            />
          ))}
        </Panel>
      ) : (
        <Panel>
          <Panel.Header eyebrow={t("history")} />
          <SystemState kind="empty" message={t("notDoneYet")} />
        </Panel>
      )}

      {exercise.custom && (
        <View className="gap-2">
          <Button variant="secondary" icon="edit" onPress={() => setEditing(true)}>
            {t("editExercise")}
          </Button>
          <Button
            variant="ghost"
            icon={exercise.archived ? "undo" : undefined}
            onPress={() => archiveCustomExercise(id, !exercise.archived)}
          >
            {t(exercise.archived ? "restoreExercise" : "archiveExercise")}
          </Button>
        </View>
      )}
      <CustomExerciseEditor open={editing} close={() => setEditing(false)} editing={exercise} />
    </DetailScreen>
  );
}
