import { View } from "react-native";
import { router } from "expo-router";
import {
  frequentExercises,
  recordTimeline,
  strengthSeries,
  weeklyVolume,
  type WeekTotals,
} from "@/lib/analytics";
import { useQuery } from "@/lib/data";
import { useExercises } from "@/lib/exercise-store";
import { massUnit, useLiftFormat } from "@/lib/format";
import { dayOf, fromKg, shortDay, weightTrend } from "@/lib/metrics";
import { useStore } from "@/lib/store";
import { useCount } from "@/lib/use-count";
import {
  Button,
  ListRow,
  Panel,
  Screen,
  Sparkline,
  SystemState,
  Text,
  Value,
  useKitFormat,
} from "@/vector";
import { MuscleHeatmap } from "./muscle-heatmap";

const WEEKS = 8;

type Reading = { value: string; unit?: string; unitFirst?: boolean; space?: string };

/** This week's figure and its change from last week: signed, "Same", or a dash when neither week has any. */
function WeekFigure({ now, change }: { now: Reading; change: Reading | "same" | null }) {
  const { t } = useStore();
  return (
    <View className="flex-row flex-wrap items-baseline justify-end gap-x-3">
      <Value {...now} />
      {change === "same" ? (
        <Text variant="caption" tone="muted">
          {t("same")}
        </Text>
      ) : change ? (
        <Value size="xs" tone="muted" {...change} />
      ) : (
        <Text variant="caption" tone="muted">
          –
        </Text>
      )}
    </View>
  );
}

function WeekTotalsPanel({ current, previous }: { current: WeekTotals; previous: WeekTotals }) {
  const { units, t } = useStore();
  const format = useKitFormat();
  const count = (n: number): Reading => ({ value: format.number(n) });
  // Volume in whole units: the change keeps the unit and gains a sign.
  const volume = (kg: number, signed = false): Reading => {
    const n = Math.round(fromKg(kg, units));
    return { ...format.unitParts(n, massUnit(units)), value: format.number(n, 0, signed) };
  };
  const rows = [
    { key: "workouts", title: t("workouts"), now: current.workouts, before: previous.workouts },
    { key: "sets", title: t("sets"), now: current.sets, before: previous.sets },
    { key: "volume", title: t("volume"), now: current.volumeKg, before: previous.volumeKg },
  ] as const;
  return (
    <Panel inset="none">
      <Panel.Header eyebrow={t("thisWeek")} meta={t("changeFromLastWeek")} />
      {rows.map((row) => {
        const reading = row.key === "volume" ? volume : count;
        const diff = row.now - row.before;
        const change =
          !row.now && !row.before
            ? null
            : (row.key === "volume" ? Math.round(fromKg(diff, units)) : diff) === 0
              ? "same"
              : row.key === "volume"
                ? volume(diff, true)
                : { value: format.number(diff, 0, true) };
        return (
          <ListRow
            key={row.key}
            title={row.title}
            value={<WeekFigure now={reading(row.now)} change={change} />}
          />
        );
      })}
    </Panel>
  );
}

export function ProgressScreen() {
  const { units, locale, weights, t } = useStore();
  const { estimateText, loadText, weightText } = useLiftFormat();
  const format = useKitFormat();
  const count = useCount();
  const { byId } = useExercises();
  const data = useQuery(() => {
    const volume = weeklyVolume(WEEKS, byId);
    const strength = frequentExercises().map((id) => {
      const exercise = byId(id);
      return { exercise, series: strengthSeries(exercise).slice(-12) };
    });
    const records = recordTimeline(byId).slice(-8).reverse();
    return { volume, strength, records };
  }, [byId]);
  const trend = weightTrend(weights).slice(-30);
  const { volume, strength, records } = data;
  const current = volume.totals[WEEKS - 1];
  const previous = volume.totals[WEEKS - 2];
  // Estimates in whole units: decimals would claim false precision.
  const estimate = (kg: number, signed = false) => {
    const n = Math.round(fromKg(kg, units));
    return { ...format.unitParts(n, massUnit(units)), value: format.number(n, 0, signed) };
  };
  const strengthHeader = <Panel.Header eyebrow={t("strength")} meta={t("estimated1rm")} />;
  const recordsHeader = <Panel.Header eyebrow={t("recentRecords")} />;

  return (
    <Screen title={t("progress")}>
      <WeekTotalsPanel current={current} previous={previous} />

      <Panel>
        <Panel.Header
          eyebrow={t("setsPerMuscle")}
          meta={count(WEEKS, "weekCountOne", "weekCount")}
        />
        <MuscleHeatmap volume={volume} />
      </Panel>

      {strength.length ? (
        <Panel inset="none">
          {strengthHeader}
          {strength.map(({ exercise, series }) => {
            const last = series.at(-1);
            const first = series[0];
            const change = last && first && series.length > 1 ? last.e1rmKg - first.e1rmKg : 0;
            return (
              <ListRow
                key={exercise.id}
                title={exercise.name}
                accessibilityLabel={
                  last
                    ? t("strengthRowLabel", {
                        name: exercise.name,
                        value: estimateText(last.e1rmKg, units),
                      })
                    : exercise.name
                }
                value={
                  <View className="flex-row items-center gap-3">
                    <View className="items-end">
                      {last ? (
                        <Value {...estimate(last.e1rmKg)} />
                      ) : (
                        <Text variant="readoutS" tone="muted">
                          –
                        </Text>
                      )}
                      {series.length > 1 && Math.abs(change) >= 0.5 && (
                        <Value size="xs" tone="muted" {...estimate(change, true)} />
                      )}
                    </View>
                    {/* A mark, not a text column: its width holds while the figures beside it wrap. */}
                    <View className="w-20">
                      <Sparkline
                        points={series.map((p) => ({ day: p.day, value: p.e1rmKg }))}
                        minSpan={5}
                      />
                    </View>
                  </View>
                }
                onPress={() =>
                  router.push({ pathname: "/exercise/[id]", params: { id: exercise.id } })
                }
              />
            );
          })}
        </Panel>
      ) : (
        <Panel>
          {strengthHeader}
          <SystemState kind="empty" message={t("strengthEmpty")} />
        </Panel>
      )}

      {records.length ? (
        <Panel inset="none">
          {recordsHeader}
          {records.map((r) => (
            <ListRow
              key={`${r.workoutId}-${r.exerciseId}-${r.kind}`}
              icon="record"
              title={byId(r.exerciseId).name}
              description={t("recordSummary", {
                day: shortDay(r.day, locale),
                kind: t(r.kind === "e1rm" ? "recordKindE1rm" : "recordKindHeaviest"),
                value:
                  r.kind === "e1rm" ? estimateText(r.valueKg, units) : loadText(r.valueKg, units),
                previous:
                  r.kind === "e1rm"
                    ? estimateText(r.previousKg, units)
                    : loadText(r.previousKg, units),
              })}
              onPress={() =>
                router.push({ pathname: "/session/[id]", params: { id: String(r.workoutId) } })
              }
            />
          ))}
        </Panel>
      ) : (
        <Panel>
          {recordsHeader}
          <SystemState kind="empty" message={t("recordsEmpty")} />
        </Panel>
      )}

      <Panel inset="none">
        <ListRow
          title={t("bodyWeight")}
          description={
            trend.length > 1
              ? t("trendToNow", {
                  value: weightText(trend.at(-1)!.trend, units),
                  day: shortDay(dayOf(trend[0].day), locale),
                })
              : undefined
          }
          value={
            weights[0] ? (
              <View className="flex-row items-center gap-3">
                <Value
                  {...format.unitParts(fromKg(weights[0].weightKg, units), massUnit(units), 1)}
                />
                {trend.length > 1 && (
                  <View className="w-20">
                    <Sparkline
                      points={trend.map((p) => ({ day: p.day, value: p.trend }))}
                      minSpan={1}
                    />
                  </View>
                )}
              </View>
            ) : (
              t("addWeight")
            )
          }
          onPress={() => router.push("/weight")}
        />
      </Panel>

      <Button variant="secondary" icon="history" onPress={() => router.push("/history")}>
        {t("allWorkouts")}
      </Button>
    </Screen>
  );
}
