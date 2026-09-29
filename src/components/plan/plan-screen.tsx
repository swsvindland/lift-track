import { useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useQuery, write } from "@/lib/data";
import { useExercises } from "@/lib/exercise-store";
import { useLiftFormat } from "@/lib/format";
import {
  activeMeso,
  endProgram,
  isDeloadWeek,
  deleteProgram,
  nextBlock,
  nextSession,
  otherPrograms,
  programDetail,
  programProgress,
  startProgram,
  startSaved,
  totalWeeks,
  weekRir,
  type ProgramDetail,
  type SessionCell,
  type SessionState,
} from "@/lib/programs";
import { useStore } from "@/lib/store";
import type { Message } from "@/lib/translations";
import { useCount } from "@/lib/use-count";
import { trainingGym } from "@/lib/workouts";
import { TravelBanner, TravelSheet } from "@/components/gyms/travel";
import {
  ActionMenu,
  Button,
  Icon,
  ListRow,
  Note,
  Panel,
  Screen,
  SettingsSection,
  SignalCell,
  Status,
  Text,
  useKitFormat,
} from "@/vector";
import { ProgramBuilderSheet } from "./program-builder-sheet";
import { ImportSheet } from "./import-sheet";
import { previewSession, useStartSession } from "./use-start-session";

const stateLabels: Record<SessionState, Message> = {
  done: "sessionDone",
  skipped: "sessionSkipped",
  open: "sessionOpen",
  next: "sessionNext",
  upcoming: "sessionUpcoming",
};

const openProgram = (id: number) =>
  router.push({ pathname: "/program", params: { id: String(id) } });

/** "Week 3", or "Deload" for the program's last, lighter week. */
function useWeekLabel() {
  const { t } = useStore();
  const format = useKitFormat();
  return (detail: { rir: number[]; deload: boolean }, week: number) =>
    isDeloadWeek(detail, week) ? t("deload") : t("weekN", { n: format.number(week + 1) });
}

/** Saved and finished programs: tap to edit, or start one from its menu. */
function ProgramList({ programs, running }: { programs: ProgramDetail[]; running?: string }) {
  const { t } = useStore();
  const format = useKitFormat();
  const count = useCount();
  const { byId } = useExercises();
  if (!programs.length) return null;
  const start = (program: ProgramDetail) => {
    const go = () =>
      write(() =>
        program.status === "saved" ? startSaved(program.id) : startProgram(nextBlock(program, byId))
      );
    if (!running) return go();
    // vector: irreversible
    Alert.alert(
      t("startNamed", { name: program.name }),
      t("endsStayInHistory", { name: running }),
      [
        { text: t("cancel"), style: "cancel" },
        { text: t("start"), onPress: go },
      ]
    );
  };
  const remove = (program: ProgramDetail) => {
    // vector: irreversible
    Alert.alert(
      t("deleteNamed", { name: program.name }),
      program.status === "saved" ? undefined : t("workoutsStayInHistory"),
      [
        { text: t("cancel"), style: "cancel" },
        {
          text: t("delete"),
          style: "destructive",
          onPress: () => write(() => deleteProgram(program.id)),
        },
      ]
    );
  };
  return (
    <SettingsSection eyebrow={t("yourPrograms")}>
      {programs.map((program) => {
        const saved = program.status === "saved";
        const days = count(program.days.length, "dayCountOne", "dayCount");
        const run = saved ? t("start") : t("runAgain");
        return (
          <ListRow
            key={program.id}
            title={program.name}
            description={
              saved
                ? t("programNotStarted", {
                    days,
                    weeks: count(program.rir.length, "weekCountOne", "weekCount"),
                  })
                : t("programFinished", {
                    date: format.monthDay(new Date(program.endedAt ?? program.startedAt)),
                    days,
                  })
            }
            onPress={() => openProgram(program.id)}
            accessibilityHint={saved ? t("editProgram") : t("editThenRunAgain")}
            // The menu is its own element beside the row (control); its actions are the row's actions too.
            accessibilityActions={[
              { name: "start", label: run },
              { name: "delete", label: t("delete") },
            ]}
            onAccessibilityAction={(e) =>
              e.nativeEvent.actionName === "start" ? start(program) : remove(program)
            }
            control={
              <ActionMenu
                accessibilityLabel={t("optionsFor", { name: program.name })}
                sections={[
                  {
                    actions: [
                      {
                        key: "start",
                        label: run,
                        icon: saved ? "play" : "repeat",
                        onPress: () => start(program),
                      },
                      {
                        key: "edit",
                        label: saved ? t("edit") : t("editThenRunAgain"),
                        icon: "edit",
                        onPress: () => openProgram(program.id),
                      },
                      {
                        key: "delete",
                        label: t("delete"),
                        icon: "delete",
                        destructive: true,
                        onPress: () => remove(program),
                      },
                    ],
                  },
                ]}
              />
            }
          />
        );
      })}
    </SettingsSection>
  );
}

export function PlanScreen() {
  const [building, setBuilding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [traveling, setTraveling] = useState(false);
  const { units, t } = useStore();
  const format = useKitFormat();
  const { rirText } = useLiftFormat();
  const weekLabel = useWeekLabel();
  const begin = useStartSession();
  const { byId } = useExercises();
  const data = useQuery(() => {
    const meso = activeMeso();
    const detail = meso ? programDetail(meso.id) : undefined;
    return {
      detail,
      progress: detail ? programProgress(detail) : [],
      next: detail ? nextSession(detail) : undefined,
      others: otherPrograms(),
      at: trainingGym(units, detail?.gymId),
    };
  }, [units]);
  const { detail, progress, next, at, others } = data;

  if (!detail)
    return (
      <>
        <Screen title={t("plan")}>
          <Panel>
            <Panel.Title>{t("trainOnProgram")}</Panel.Title>
            <Text tone="muted">{t("trainOnProgramBody")}</Text>
            <Button icon="tools" onPress={() => setBuilding(true)}>
              {t("buildProgram")}
            </Button>
            <Button variant="secondary" onPress={() => setImporting(true)}>
              {t("importOneYouHave")}
            </Button>
          </Panel>
          <ProgramList programs={others} />
        </Screen>
        <ProgramBuilderSheet open={building} close={() => setBuilding(false)} />
        <ImportSheet open={importing} close={() => setImporting(false)} />
      </>
    );

  const dayName = (id: number) => detail.days.find((d) => d.id === id)?.name ?? "";
  const cellAction = (cell: SessionCell) => {
    if (cell.workoutId && cell.state === "done")
      return router.push({ pathname: "/session/[id]", params: { id: String(cell.workoutId) } });
    if (cell.state === "open") return router.push("/workout");
    previewSession(cell.week, cell.dayId);
  };
  const end = () => {
    // vector: irreversible
    Alert.alert(t("endProgramQuestion"), t("workoutsStayInHistory"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("end"),
        style: "destructive",
        onPress: () => write(() => endProgram(detail.id)),
      },
    ]);
  };

  const current = next?.week ?? totalWeeks(detail) - 1;
  return (
    <>
      <Screen
        title={detail.name}
        subtitle={
          next
            ? t(detail.deload ? "planProgressDeload" : "planProgress", {
                week: weekLabel(detail, current),
                weeks: format.number(detail.rir.length),
                rir: rirText(weekRir(detail, current)),
              })
            : t("programComplete")
        }
        action={
          <ActionMenu
            accessibilityLabel={t("programOptions")}
            sections={[
              {
                actions: [
                  {
                    key: "edit",
                    label: t("editProgram"),
                    icon: "edit",
                    onPress: () => openProgram(detail.id),
                  },
                  {
                    key: "new",
                    label: t("buildNewProgram"),
                    icon: "tools",
                    onPress: () => setBuilding(true),
                  },
                  {
                    key: "import",
                    label: t("importProgram"),
                    icon: "document",
                    onPress: () => setImporting(true),
                  },
                  {
                    key: "travel",
                    label: at.travel ? t("changeTrip") : t("startTrip"),
                    icon: "travel",
                    onPress: () => setTraveling(true),
                  },
                  {
                    key: "end",
                    label: t("endProgram"),
                    icon: "stop",
                    destructive: true,
                    onPress: end,
                  },
                ],
              },
            ]}
          />
        }
      >
        <TravelBanner onEdit={() => setTraveling(true)} />
        {next ? (
          <Panel tone="live">
            <Panel.Header
              eyebrow={next.state === "open" ? t("inProgress") : t("next")}
              meta={weekLabel(detail, next.week)}
            />
            <Panel.Title>{dayName(next.dayId)}</Panel.Title>
            {next.state !== "open" && (
              <Note>
                {t(at.travel ? "atGymTravel" : "atGym", {
                  gym: at.gym.name,
                })}
              </Note>
            )}
            {next.state === "open" ? (
              <Button icon="lift" onPress={() => router.push("/workout")}>
                {t("resume")}
              </Button>
            ) : (
              <Panel.Footer>
                <Button variant="secondary" onPress={() => previewSession(next.week, next.dayId)}>
                  {t("preview")}
                </Button>
                <Button
                  icon="play"
                  className="flex-1"
                  onPress={() => begin(detail, next.week, next.dayId)}
                >
                  {t("start")}
                </Button>
              </Panel.Footer>
            )}
          </Panel>
        ) : (
          <Panel>
            <Status state="ok" label={t("blockDone")} />
            <Text tone="muted">{t("blockDoneBody")}</Text>
            <Button
              icon="repeat"
              onPress={() => write(() => startProgram(nextBlock(detail, byId)))}
            >
              {t("runAgain")}
            </Button>
            <Button variant="secondary" onPress={() => setBuilding(true)}>
              {t("buildNewProgram")}
            </Button>
          </Panel>
        )}

        {/* Columns size to their day names (no fixed text widths); cells align on the columns' bottom edge. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="flex-row gap-2">
            <View className="justify-end gap-2">
              {progress.map((_, week) => (
                <View key={week} className="h-11 justify-center">
                  <Text variant="small">{weekLabel(detail, week)}</Text>
                </View>
              ))}
            </View>
            {detail.days.map((day) => (
              <View key={day.id} className="min-w-14 max-w-24 justify-end gap-2">
                <Text variant="caption" tone="muted">
                  {day.name}
                </Text>
                {progress.map((row, week) => {
                  const cell = row.find((c) => c.dayId === day.id);
                  if (!cell) return <View key={week} className="h-11" />;
                  const label = t("sessionCell", {
                    day: day.name,
                    week: weekLabel(detail, week),
                    state: t(stateLabels[cell.state]),
                  });
                  // The session that is next (or open) is the live cell: a signal fill whose glyph (play, or
                  // the lift in progress) carries the state; the rest stay hairline marks.
                  if (cell.state === "next" || cell.state === "open")
                    return (
                      <SignalCell
                        key={week}
                        selected
                        accessibilityLabel={label}
                        onPress={() => cellAction(cell)}
                      >
                        <Icon name={cell.state === "next" ? "play" : "lift"} size={17} />
                      </SignalCell>
                    );
                  return (
                    <Pressable
                      key={week}
                      accessibilityRole="button"
                      accessibilityLabel={label}
                      onPress={() => cellAction(cell)}
                      className="h-11 items-center justify-center rounded-control border border-border active:bg-surface-secondary"
                    >
                      {cell.state === "done" && <Icon name="check" size={17} tone="success" />}
                      {cell.state === "skipped" && <Icon name="remove" size={16} tone="muted" />}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>

        <Panel inset="none">
          <Panel.Header eyebrow={t("days")} />
          {detail.days.map((day) => (
            <ListRow
              key={day.id}
              title={day.name}
              description={format.list(day.slots.map((slot) => byId(slot.exerciseId).name))}
              onPress={() => openProgram(detail.id)}
              accessibilityHint={t("editProgram")}
            />
          ))}
        </Panel>

        <ProgramList programs={others} running={detail.name} />
      </Screen>
      <ProgramBuilderSheet open={building} close={() => setBuilding(false)} />
      <ImportSheet open={importing} close={() => setImporting(false)} />
      <TravelSheet open={traveling} close={() => setTraveling(false)} />
    </>
  );
}
