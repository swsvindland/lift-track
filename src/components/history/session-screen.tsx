import { useMemo } from "react";
import { Alert, View } from "react-native";
import { router } from "expo-router";
import { syncHealthSoon } from "@/lib/health-schedule";
import { MuscleFeedback } from "./muscle-feedback";
import { SessionNote } from "./session-note";
import { write, useQuery } from "@/lib/data";
import { useExercises } from "@/lib/exercise-store";
import { massUnit, useLiftFormat } from "@/lib/format";
import { fromKg } from "@/lib/metrics";
import { useStore } from "@/lib/store";
import { countsAsWork } from "@/lib/strength";
import { useCount } from "@/lib/use-count";
import {
  activeWorkout,
  discardWorkout,
  startWorkout,
  trainingGym,
  workoutDetail,
  workoutRecords,
} from "@/lib/workouts";
import { Button, DetailScreen, ListRow, Panel, Status, Text, Value, useKitFormat } from "@/vector";

export function SessionScreen({ id, finished }: { id: number; finished: boolean }) {
  const { units, t } = useStore();
  const { dayLabel, duration, estimateText, loadText, setText } = useLiftFormat();
  const format = useKitFormat();
  const count = useCount();
  const { byId } = useExercises();
  const detail = useQuery(() => {
    return workoutDetail(id);
  }, [id]);
  const records = useMemo(() => (detail ? workoutRecords(detail) : []), [detail]);
  if (!detail) return null;
  const work = detail.exercises.flatMap((b) => b.sets).filter((s) => countsAsWork(s.kind));
  const volume = work.reduce((sum, s) => sum + (s.weightKg ?? 0) * (s.reps ?? 0), 0);
  const show = (kind: "e1rm" | "weight", kg: number) =>
    kind === "e1rm" ? estimateText(kg, units) : loadText(kg, units);
  const badge = (kind: string, i: number) =>
    kind === "warmup"
      ? t("setKindWarmupShort")
      : kind === "drop"
        ? t("setKindDropShort")
        : kind === "myo"
          ? t("setKindMyoShort")
          : format.number(i + 1);
  return (
    <DetailScreen title={finished ? t("workoutDone") : dayLabel(detail.startedAt)}>
      <Panel inset="none">
        <ListRow
          title={t("time")}
          value={<Value value={duration(detail.startedAt, detail.endedAt)} />}
        />
        <ListRow title={t("sets")} value={<Value value={format.number(work.length)} />} />
        <ListRow
          title={t("volume")}
          value={
            <Value {...format.unitParts(Math.round(fromKg(volume, units)), massUnit(units))} />
          }
        />
      </Panel>

      {records.length > 0 && (
        <Panel>
          <Status state="ok" label={count(records.length, "newRecordCountOne", "newRecordCount")} />
          {records.map((r) => (
            <Text key={`${r.exerciseId}-${r.kind}`} variant="small">
              {t("recordLine", {
                name: byId(r.exerciseId).name,
                kind: t(r.kind === "e1rm" ? "recordKindE1rm" : "recordKindHeaviest"),
                value: show(r.kind, r.valueKg),
                previous: show(r.kind, r.previousKg),
              })}
            </Text>
          ))}
        </Panel>
      )}

      {detail.mesoId !== null && !detail.deload && <MuscleFeedback detail={detail} />}

      <SessionNote key={detail.id} detail={detail} />

      {detail.exercises.map((block) => (
        <Panel key={block.id}>
          <Panel.Title>{byId(block.exerciseId).name}</Panel.Title>
          <View className="gap-1">
            {block.sets.map((s, i) => (
              <View key={s.id} className="flex-row gap-3">
                <Text variant="readoutS" tone="muted" className="min-w-6">
                  {badge(s.kind, i)}
                </Text>
                <Value tone="muted" value={setText(s, units)} />
              </View>
            ))}
          </View>
        </Panel>
      ))}

      <View className="gap-2">
        {detail.mesoId === null && (
          <Button
            variant="secondary"
            icon="play"
            disabled={!!activeWorkout()}
            onPress={() => {
              const { gym, travel } = trainingGym(units, detail.gymId);
              write(() => startWorkout({ gymId: gym.id, travel, from: detail.id }));
              router.replace("/workout");
            }}
          >
            {t("repeatThisWorkout")}
          </Button>
        )}
        <Button
          variant="ghost"
          icon="edit"
          onPress={() => router.push({ pathname: "/workout", params: { id: String(detail.id) } })}
        >
          {t("edit")}
        </Button>
        <Button
          variant="destructive"
          icon="delete"
          onPress={() =>
            // vector: irreversible
            Alert.alert(t("deleteWorkoutQuestion"), t("cannotBeUndone"), [
              { text: t("cancel"), style: "cancel" },
              {
                text: t("delete"),
                style: "destructive",
                onPress: () => {
                  write(() => discardWorkout(detail.id));
                  void syncHealthSoon();
                  router.back();
                },
              },
            ])
          }
        >
          {t("deleteWorkout")}
        </Button>
      </View>
    </DetailScreen>
  );
}
