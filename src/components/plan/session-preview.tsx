import { View } from "react-native";
import { router } from "expo-router";
import { useQuery, write } from "@/lib/data";
import { equipmentLabels, muscleLabels } from "@/lib/exercises";
import type { Muscle } from "@/lib/exercises/types";
import { useExercises } from "@/lib/exercise-store";
import { useLiftFormat } from "@/lib/format";
import {
  activeMeso,
  isDeloadWeek,
  planSession,
  programDetail,
  programProgress,
  skipSession,
  unskipSession,
  type SessionPlan,
} from "@/lib/programs";
import { useStore } from "@/lib/store";
import { useCount } from "@/lib/use-count";
import { activeWorkout, workoutDetail } from "@/lib/workouts";
import {
  Button,
  DetailScreen,
  Label,
  Meta,
  Note,
  Panel,
  ScreenFooter,
  SystemState,
  Text,
  Value,
  useKitFormat,
} from "@/vector";
import { useSessionContext, useStartSession } from "./use-start-session";

/** Sets per primary muscle, most first: what the day trains. */
function musclesOf(plan: SessionPlan) {
  const totals = new Map<Muscle, number>();
  for (const { exercise, sets } of plan.exercises)
    for (const [m, w] of Object.entries(exercise.muscles) as [Muscle, number][])
      if (w === 1) totals.set(m, (totals.get(m) ?? 0) + sets.length);
  return [...totals].sort((a, b) => b[1] - a[1]);
}

/**
 * A program session before it starts: every exercise and set target, what it trains and what it
 * needs, to get ready ahead of the gym. Start logs exactly this.
 */
export function SessionPreview({ week, dayId }: { week: number; dayId: number }) {
  const { units, weights, t } = useStore();
  const format = useKitFormat();
  const { adviceText, loadText, rirText } = useLiftFormat();
  const count = useCount();
  const { all, byId, settings } = useExercises();
  const contextFor = useSessionContext();
  const begin = useStartSession();
  const data = useQuery(() => {
    const meso = activeMeso();
    const detail = meso ? programDetail(meso.id) : undefined;
    const cell = detail?.days.some((d) => d.id === dayId)
      ? programProgress(detail)
          .flat()
          .find((c) => c.week === week && c.dayId === dayId)
      : undefined;
    if (!detail || !cell) return undefined;
    const context = contextFor(detail);
    const open = activeWorkout();
    return {
      detail,
      cell,
      context,
      // A workout with exercises in it has to finish first; an empty one is replaced.
      busy: !!open && !!workoutDetail(open.id)?.exercises.length,
      plan: planSession(detail, week, dayId, context),
    };
  }, [week, dayId, units, weights, all, byId, settings]);

  if (!data)
    return (
      <DetailScreen title={t("preview")}>
        <SystemState kind="empty" message={t("sessionNotInProgram")} />
      </DetailScreen>
    );

  const { detail, cell, context, busy, plan } = data;
  const sets = plan.exercises.reduce((n, e) => n + e.sets.length, 0);
  const muscles = musclesOf(plan);
  const equipment = [...new Set(plan.exercises.map((e) => e.exercise.equipment))];
  const start = () => begin(detail, week, dayId, { replace: true });

  const footer = (
    <ScreenFooter>
      {cell.state === "open" ? (
        <Button size="lg" icon="lift" className="flex-1" onPress={() => router.replace("/workout")}>
          {t("resume")}
        </Button>
      ) : cell.state === "done" && cell.workoutId ? (
        <Button
          variant="secondary"
          size="lg"
          className="flex-1"
          onPress={() =>
            router.replace({ pathname: "/session/[id]", params: { id: String(cell.workoutId) } })
          }
        >
          {t("seeWhatYouDid")}
        </Button>
      ) : busy ? (
        <Button size="lg" icon="lift" className="flex-1" onPress={() => router.replace("/workout")}>
          {t("resumeWorkoutInProgress")}
        </Button>
      ) : cell.state === "skipped" ? (
        <Button
          variant="secondary"
          size="lg"
          className="flex-1"
          onPress={() => write(() => unskipSession(detail.id, week, dayId))}
        >
          {t("unskip")}
        </Button>
      ) : (
        <>
          <Button
            variant="secondary"
            size="lg"
            onPress={() => {
              write(() => skipSession(detail.id, week, dayId));
              router.back();
            }}
          >
            {t("skip")}
          </Button>
          <Button size="lg" icon="play" className="flex-1" onPress={start}>
            {t("start")}
          </Button>
        </>
      )}
    </ScreenFooter>
  );

  return (
    // The day is the title (native bar); program, week and gym lead the content.
    <DetailScreen title={plan.day.name} footer={footer}>
      <View className="gap-1">
        <Meta
          tone="default"
          items={[
            detail.name,
            isDeloadWeek(detail, week) ? t("deload") : t("weekN", { n: format.number(week + 1) }),
          ]}
        />
        <Meta
          items={[
            t("rirOnEverySet", { rir: rirText(plan.rir) }),
            context.gym
              ? t(context.travel ? "atGymTravel" : "atGym", { gym: context.gym.name })
              : "",
          ]}
        />
      </View>

      {busy && cell.state !== "open" && <Note tone="warning">{t("anotherWorkoutOpen")}</Note>}
      {cell.state === "upcoming" && <Note>{t("notNextYet")}</Note>}
      {cell.state === "skipped" && <Note>{t("youSkippedSession")}</Note>}

      <View className="flex-row gap-3">
        <Panel className="flex-1">
          <Label>{t("exercises")}</Label>
          <Value size="m" value={format.number(plan.exercises.length)} />
        </Panel>
        <Panel className="flex-1">
          <Label>{t("sets")}</Label>
          <Value size="m" value={format.number(sets)} />
        </Panel>
      </View>

      <Panel>
        <View className="gap-1">
          <Label>{t("trains")}</Label>
          {muscles.length ? (
            <Meta
              tone="default"
              items={muscles.map(([m, n]) =>
                t("muscleSets", { muscle: muscleLabels[m], n: format.number(n) })
              )}
            />
          ) : (
            <Text>{t("nothingCounted")}</Text>
          )}
        </View>
        <View className="gap-1">
          <Label>{t("equipment")}</Label>
          <Text>{format.list(equipment.map((e) => equipmentLabels[e]))}</Text>
        </View>
      </Panel>

      {plan.exercises.map(({ slot, exercise, reps, advice, sets: targets }) => {
        const why = adviceText(advice, units);
        return (
          <View key={slot.id} className="gap-1">
            <Text variant="bodyStrong">{exercise.name}</Text>
            {exercise.id !== slot.exerciseId && (
              <Note>{t("standsInFor", { name: byId(slot.exerciseId).name })}</Note>
            )}
            <Meta
              items={[
                count(targets.length, "setCountOne", "setCount"),
                t("repRange", { range: format.range(reps[0], reps[1]) }),
              ]}
            />
            {targets.map((s, i) => (
              <View key={i} className="flex-row gap-3">
                <View className="min-w-6">
                  <Text variant="readoutS" tone="muted">
                    {format.number(i + 1)}
                  </Text>
                </View>
                <Text variant="readoutS">
                  {s.weightKg
                    ? t("loadTimesReps", {
                        load: loadText(s.weightKg, units),
                        reps: format.number(s.reps),
                      })
                    : count(s.reps, "repCountOne", "repCount")}
                </Text>
              </View>
            ))}
            {!!why && <Note>{why}</Note>}
          </View>
        );
      })}
    </DetailScreen>
  );
}
