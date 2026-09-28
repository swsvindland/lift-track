import { useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { twMerge } from "tailwind-merge";
import {
  SystemButton,
  SystemIcon,
  SystemLabel,
  SystemPanel,
  SystemText as Text,
} from "@/components/system";
import { ActionMenu, Screen } from "@/components/ui";
import { useQuery, write } from "@/lib/data";
import { useExercises } from "@/lib/exercise-store";
import { rirText } from "@/lib/format";
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
import { trainingGym } from "@/lib/workouts";
import { TravelBanner, TravelSheet } from "@/components/gyms/travel";
import { ProgramBuilderSheet } from "./program-builder-sheet";
import { ImportSheet } from "./import-sheet";
import { previewSession, useStartSession } from "./use-start-session";

const weekLabel = (detail: { rir: number[]; deload: boolean }, week: number) =>
  isDeloadWeek(detail, week) ? "Deload" : `Week ${week + 1}`;

const stateLabels: Record<SessionState, string> = {
  done: "done",
  skipped: "skipped",
  open: "in progress",
  next: "next",
  upcoming: "upcoming",
};

const openProgram = (id: number) =>
  router.push({ pathname: "/program", params: { id: String(id) } });

/** Saved and finished programs: tap to edit, or start one from its menu. */
function ProgramList({ programs, running }: { programs: ProgramDetail[]; running?: string }) {
  const { locale } = useStore();
  const { byId } = useExercises();
  if (!programs.length) return null;
  const start = (program: ProgramDetail) => {
    const go = () =>
      write(() =>
        program.status === "saved" ? startSaved(program.id) : startProgram(nextBlock(program, byId))
      );
    if (!running) return go();
    Alert.alert(`Start ${program.name}?`, `${running} ends. Workouts you did stay in History.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Start", onPress: go },
    ]);
  };
  return (
    <View className="gap-2">
      <SystemLabel>Your programs</SystemLabel>
      {programs.map((program) => {
        const saved = program.status === "saved";
        const days = `${program.days.length} ${program.days.length === 1 ? "day" : "days"}`;
        return (
          <Pressable
            key={program.id}
            accessibilityRole="button"
            accessibilityHint={saved ? "Edit program" : "Set up the next block"}
            onPress={() => openProgram(program.id)}
            className="flex-row items-center gap-2 rounded-2xl bg-surface py-2 pl-4 pr-1 active:opacity-70"
          >
            <View className="flex-1 gap-1 py-1">
              <Text className="font-semibold" numberOfLines={1}>
                {program.name}
              </Text>
              <Text className="text-sm text-muted" numberOfLines={1}>
                {saved
                  ? `Not started · ${days} · ${program.rir.length} weeks`
                  : `Finished ${new Date(program.endedAt ?? program.startedAt).toLocaleDateString(locale, { month: "short", day: "numeric" })} · ${days}`}
              </Text>
            </View>
            <ActionMenu
              accessibilityLabel={`${program.name} options`}
              sections={[
                {
                  actions: [
                    {
                      key: "start",
                      label: saved ? "Start" : "Run again",
                      icon: saved ? "play" : "repeat",
                      onPress: () => start(program),
                    },
                    {
                      key: "edit",
                      label: saved ? "Edit" : "Edit, then run again",
                      icon: "create-outline",
                      onPress: () => openProgram(program.id),
                    },
                    {
                      key: "delete",
                      label: "Delete",
                      icon: "trash-outline",
                      destructive: true,
                      onPress: () =>
                        Alert.alert(
                          `Delete ${program.name}?`,
                          saved ? undefined : "Workouts you did stay in History.",
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Delete",
                              style: "destructive",
                              onPress: () => write(() => deleteProgram(program.id)),
                            },
                          ]
                        ),
                    },
                  ],
                },
              ]}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

export function PlanScreen() {
  const [building, setBuilding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [traveling, setTraveling] = useState(false);
  const { units } = useStore();
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
        <Screen title="Plan">
          <SystemPanel className="gap-3">
            <Text className="text-lg font-semibold">Train on a program</Text>
            <Text className="text-muted">
              A block of weeks where effort rises, loads and reps are worked out for every set, and
              sets grow as you recover, then a lighter deload week.
            </Text>
            <SystemButton icon="construct-outline" onPress={() => setBuilding(true)}>
              Build a program
            </SystemButton>
            <SystemButton
              variant="secondary"
              icon="document-text-outline"
              onPress={() => setImporting(true)}
            >
              Import one you have
            </SystemButton>
          </SystemPanel>
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

  const current = next?.week ?? totalWeeks(detail) - 1;
  return (
    <>
      <Screen
        title={detail.name}
        subtitle={
          next
            ? `${weekLabel(detail, current)} of ${detail.rir.length}${detail.deload ? " + deload" : ""} · ${rirText(weekRir(detail, current))}`
            : "Program complete"
        }
        action={
          <ActionMenu
            accessibilityLabel="Program options"
            sections={[
              {
                actions: [
                  {
                    key: "edit",
                    label: "Edit program",
                    icon: "create-outline",
                    onPress: () => openProgram(detail.id),
                  },
                  {
                    key: "new",
                    label: "Build a new program",
                    icon: "construct-outline",
                    onPress: () => setBuilding(true),
                  },
                  {
                    key: "import",
                    label: "Import a program",
                    icon: "document-text-outline",
                    onPress: () => setImporting(true),
                  },
                  {
                    key: "travel",
                    label: at.travel ? "Change trip" : "I'm traveling",
                    icon: "airplane-outline",
                    onPress: () => setTraveling(true),
                  },
                  {
                    key: "end",
                    label: "End program",
                    icon: "stop-circle-outline",
                    destructive: true,
                    onPress: () =>
                      Alert.alert("End program?", "Workouts you did stay in History.", [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "End",
                          style: "destructive",
                          onPress: () => write(() => endProgram(detail.id)),
                        },
                      ]),
                  },
                ],
              },
            ]}
          />
        }
      >
        <TravelBanner onEdit={() => setTraveling(true)} />
        {next ? (
          <SystemPanel className="gap-3 bg-accent-soft">
            <SystemLabel className="text-accent-soft-foreground">
              {next.state === "open" ? "In progress" : "Next"}
            </SystemLabel>
            <Text className="text-xl font-semibold">
              {dayName(next.dayId)} · {weekLabel(detail, next.week)}
            </Text>
            {next.state !== "open" && (
              <Text className="text-sm text-muted">
                At {at.gym.name}
                {at.travel ? ", with stand-ins for what it doesn't have" : ""}
              </Text>
            )}
            {next.state === "open" ? (
              <SystemButton icon="barbell" onPress={() => router.push("/workout")}>
                Resume
              </SystemButton>
            ) : (
              <View className="flex-row gap-2">
                <SystemButton
                  variant="secondary"
                  icon="eye-outline"
                  onPress={() => previewSession(next.week, next.dayId)}
                >
                  Preview
                </SystemButton>
                <SystemButton
                  icon="play"
                  className="flex-1"
                  onPress={() => begin(detail, next.week, next.dayId)}
                >
                  Start
                </SystemButton>
              </View>
            )}
          </SystemPanel>
        ) : (
          <SystemPanel className="gap-3 bg-success-soft">
            <Text className="text-lg font-semibold">Block done</Text>
            <Text className="text-muted">
              Run it again with loads carrying over, or build a new one.
            </Text>
            <SystemButton
              icon="repeat"
              onPress={() => write(() => startProgram(nextBlock(detail, byId)))}
            >
              Run again
            </SystemButton>
            <SystemButton variant="secondary" onPress={() => setBuilding(true)}>
              Build a new program
            </SystemButton>
          </SystemPanel>
        )}

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="gap-2">
            <View className="flex-row gap-2">
              <View className="w-16" />
              {detail.days.map((day) => (
                <Text key={day.id} className="w-14 text-xs text-muted" numberOfLines={2}>
                  {day.name}
                </Text>
              ))}
            </View>
            {progress.map((row, week) => (
              <View key={week} className="flex-row items-center gap-2">
                <Text className="w-16 text-sm" numberOfLines={1}>
                  {weekLabel(detail, week)}
                </Text>
                {row.map((cell) => (
                  <Pressable
                    key={cell.dayId}
                    accessibilityRole="button"
                    accessibilityLabel={`${dayName(cell.dayId)}, ${weekLabel(detail, week)}, ${stateLabels[cell.state]}`}
                    onPress={() => cellAction(cell)}
                    className={twMerge(
                      "h-11 w-14 items-center justify-center rounded-xl active:opacity-60",
                      cell.state === "done" && "bg-success",
                      cell.state === "skipped" && "bg-surface-secondary",
                      cell.state === "next" && "bg-accent",
                      cell.state === "open" && "border-2 border-accent bg-accent-soft",
                      cell.state === "upcoming" && "border border-border"
                    )}
                  >
                    {cell.state === "done" && (
                      <SystemIcon name="checkmark" size={18} color="success-foreground" />
                    )}
                    {cell.state === "skipped" && <Text className="text-muted">–</Text>}
                    {cell.state === "next" && (
                      <SystemIcon name="play" size={16} color="accent-foreground" />
                    )}
                    {cell.state === "open" && (
                      <SystemIcon name="barbell" size={18} color="accent-soft-foreground" />
                    )}
                  </Pressable>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Edit ${detail.name}`}
          onPress={() => openProgram(detail.id)}
          className="flex-row items-center gap-3 rounded-2xl bg-surface p-4 active:opacity-70"
        >
          <View className="flex-1 gap-1">
            <SystemLabel>Days</SystemLabel>
            {detail.days.map((day) => (
              <Text key={day.id} className="text-sm text-muted" numberOfLines={1}>
                <Text className="text-sm font-semibold text-foreground">{day.name}: </Text>
                {day.slots.map((slot) => byId(slot.exerciseId).name).join(", ")}
              </Text>
            ))}
          </View>
          <Text className="text-accent">Edit</Text>
        </Pressable>

        <ProgramList programs={others} running={detail.name} />
      </Screen>
      <ProgramBuilderSheet open={building} close={() => setBuilding(false)} />
      <ImportSheet open={importing} close={() => setImporting(false)} />
      <TravelSheet open={traveling} close={() => setTraveling(false)} />
    </>
  );
}
