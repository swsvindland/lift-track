import { useEffect, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { write, useQuery } from "@/lib/data";
import { muscleLabels } from "@/lib/exercises";
import type { Muscle } from "@/lib/exercises/types";
import { useExercises } from "@/lib/exercise-store";
import { useLiftFormat } from "@/lib/format";
import { fromKg } from "@/lib/metrics";
import {
  activeMeso,
  awaitingFeedback,
  isDeloadWeek,
  nextSession,
  programDetail,
  skipFeedback,
  weekRir,
} from "@/lib/programs";
import { previewSession, useStartSession } from "@/components/plan/use-start-session";
import { TravelBanner } from "@/components/gyms/travel";
import { useStore } from "@/lib/store";
import { useCount } from "@/lib/use-count";
import { setsPerMuscle, weekStart } from "@/lib/volume";
import {
  activeWorkout,
  finishedWorkouts,
  startWorkout,
  trainingGym,
  workoutDetail,
  workoutsBetween,
} from "@/lib/workouts";
import {
  Button,
  ListRow,
  Meta,
  Meter,
  Note,
  Panel,
  Screen,
  SettingsSection,
  Text,
  Value,
  useKitFormat,
} from "@/vector";

/** Refreshes elapsed time once a minute while a workout is open. */
function useMinuteClock(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(timer);
  }, [active]);
}

export function TodayScreen() {
  const { units, weights, locale, t } = useStore();
  const format = useKitFormat();
  const { dayLabel, duration, rirText } = useLiftFormat();
  const count = useCount();
  const { byId } = useExercises();
  const data = useQuery(() => {
    const open = activeWorkout();
    const openDetail = open ? workoutDetail(open.id) : undefined;
    const start = weekStart();
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    const week = workoutsBetween(start.toISOString(), end.toISOString());
    // Recent workouts to repeat, one per distinct name or exercise list.
    const seen = new Set<string>();
    const repeat = finishedWorkouts(30)
      .filter((w) => {
        const key = w.name || w.exerciseIds.join(",");
        if (!w.exerciseIds.length || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 4);
    const meso = activeMeso();
    const program = meso ? programDetail(meso.id) : undefined;
    const next = program ? nextSession(program) : undefined;
    return { open, openDetail, week, repeat, program, next, awaiting: awaitingFeedback(byId) };
  }, [byId]);
  useMinuteClock(!!data.open);

  const weekly = setsPerMuscle(data.week, byId);
  const muscles = (Object.entries(weekly) as [Muscle, number][])
    .filter(([, sets]) => sets > 0)
    .sort((a, b) => b[1] - a[1]);
  const maxSets = Math.max(10, ...muscles.map(([, s]) => s));
  const openSets = data.openDetail?.exercises.flatMap((b) => b.sets) ?? [];
  const done = openSets.filter((s) => s.completedAt).length;

  const startProgramSession = useStartSession();
  const begin = (from?: number) => {
    const { gym, travel } = trainingGym(units);
    write(() => startWorkout({ gymId: gym.id, travel, from }));
    router.push("/workout");
  };

  const weekLabel = (program: { rir: number[]; deload: boolean }, week: number) =>
    isDeloadWeek(program, week) ? t("deload") : t("weekN", { n: format.number(week + 1) });
  const setsUnit = (sets: number) => t(format.plural(sets) === "one" ? "unitSet" : "unitSets");
  const latest = weights[0]
    ? format.unitParts(
        fromKg(weights[0].weightKg, units),
        units === "metric" ? "kilogram" : "pound",
        1
      )
    : undefined;

  return (
    <Screen
      title={t("today")}
      eyebrow={new Date().toLocaleDateString(locale, {
        weekday: "long",
        month: "long",
        day: "numeric",
      })}
    >
      {!data.open && <TravelBanner />}
      {data.awaiting && (
        <Panel>
          <Panel.Title>{t("howDidItGo")}</Panel.Title>
          <Meta items={[data.awaiting.name || t("workout"), dayLabel(data.awaiting.startedAt)]} />
          <Panel.Footer>
            <Button
              variant="secondary"
              className="flex-1"
              onPress={() =>
                router.push({
                  pathname: "/session/[id]",
                  params: { id: String(data.awaiting!.id), finished: "1" },
                })
              }
            >
              {t("answer")}
            </Button>
            <Button variant="ghost" onPress={() => write(() => skipFeedback(data.awaiting!.id))}>
              {t("skip")}
            </Button>
          </Panel.Footer>
        </Panel>
      )}
      {data.open ? (
        <Panel tone="live">
          <Panel.Header eyebrow={t("workoutInProgress")} meta={duration(data.open.startedAt)} />
          <Panel.Title>{data.open.name || t("workout")}</Panel.Title>
          <Note>
            {t("setsDoneOf", {
              done: format.number(done),
              total: format.number(openSets.length),
            })}
          </Note>
          <Button icon="play" onPress={() => router.push("/workout")}>
            {t("resume")}
          </Button>
        </Panel>
      ) : data.program && data.next ? (
        <Panel tone="live">
          <Panel.Header eyebrow={t("next")} meta={weekLabel(data.program, data.next.week)} />
          <Panel.Title>
            {data.program.days.find((d) => d.id === data.next!.dayId)?.name ?? ""}
          </Panel.Title>
          {/* The program name can be long, so it wraps here rather than truncating as an eyebrow. */}
          <Meta
            items={[
              data.program.name,
              t("rirOnEverySet", { rir: rirText(weekRir(data.program, data.next.week)) }),
            ]}
          />
          <Panel.Footer>
            <Button
              variant="secondary"
              onPress={() => previewSession(data.next!.week, data.next!.dayId)}
            >
              {t("preview")}
            </Button>
            <Button
              icon="play"
              className="flex-1"
              onPress={() => startProgramSession(data.program!, data.next!.week, data.next!.dayId)}
            >
              {t("start")}
            </Button>
          </Panel.Footer>
          <Button variant="ghost" onPress={() => begin()}>
            {t("emptyWorkoutInstead")}
          </Button>
        </Panel>
      ) : (
        <Panel>
          <Panel.Header eyebrow={t("noPlanYet")} />
          <Panel.Title>{t("setUpTraining")}</Panel.Title>
          <Button onPress={() => router.navigate("/(tabs)/plan")}>{t("buildOrImportPlan")}</Button>
        </Panel>
      )}

      {!data.open && !data.program && data.repeat.length > 0 && (
        <SettingsSection eyebrow={t("repeat")}>
          {data.repeat.map((w) => (
            <ListRow
              key={w.id}
              title={w.name || format.list(w.exerciseIds.slice(0, 3).map((id) => byId(id).name))}
              description={t("repeatSummary", {
                day: dayLabel(w.startedAt),
                exercises: count(w.exerciseIds.length, "exerciseCountOne", "exerciseCount"),
                sets: count(w.setCount, "setCountOne", "setCount"),
              })}
              accessibilityLabel={t("repeatFrom", {
                name: w.name || t("workout"),
                day: dayLabel(w.startedAt),
              })}
              onPress={() => begin(w.id)}
            />
          ))}
        </SettingsSection>
      )}

      <Panel>
        <Panel.Header
          eyebrow={t("thisWeek")}
          meta={count(data.week.length, "workoutCountOne", "workoutCount")}
        />
        {muscles.length ? (
          muscles.map(([muscle, sets]) => {
            const digits = Number.isInteger(sets) ? 0 : 1;
            const shown = format.number(sets, digits);
            return (
              <View key={muscle} className="gap-1">
                <View className="flex-row items-center justify-between gap-3">
                  <Text variant="small" className="shrink">
                    {muscleLabels[muscle]}
                  </Text>
                  <Value size="xs" tone="muted" value={shown} unit={setsUnit(sets)} />
                </View>
                <Meter
                  value={sets}
                  max={maxSets}
                  size="sm"
                  accessibilityLabel={muscleLabels[muscle]}
                  valueText={count(sets, "setCountOne", "setCount", digits)}
                />
              </View>
            );
          })
        ) : (
          <Text tone="muted">{t("setsPerMuscleEmpty")}</Text>
        )}
      </Panel>

      <Panel inset="none">
        <ListRow
          title={t("bodyWeight")}
          value={latest ? <Value size="s" tone="muted" {...latest} /> : t("addWeight")}
          onPress={() => router.push("/weight")}
        />
      </Panel>
    </Screen>
  );
}
