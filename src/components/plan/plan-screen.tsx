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
import { rirText } from "@/lib/format";
import {
  activeMeso,
  draftFrom,
  endProgram,
  isDeloadWeek,
  lastMeso,
  nextSession,
  programDetail,
  programProgress,
  skipSession,
  startProgram,
  totalWeeks,
  unskipSession,
  weekRir,
  type SessionCell,
} from "@/lib/programs";
import { ProgramBuilderSheet } from "./program-builder-sheet";
import { useStartSession } from "./use-start-session";

const weekLabel = (detail: { rir: number[]; deload: boolean }, week: number) =>
  isDeloadWeek(detail, week) ? "Deload" : `Week ${week + 1}`;

export function PlanScreen() {
  const [building, setBuilding] = useState(false);
  const begin = useStartSession();
  const data = useQuery(() => {
    const meso = activeMeso();
    const detail = meso ? programDetail(meso.id) : undefined;
    const previous = meso ? undefined : lastMeso();
    return {
      detail,
      progress: detail ? programProgress(detail) : [],
      next: detail ? nextSession(detail) : undefined,
      previous: previous ? programDetail(previous.id) : undefined,
    };
  });
  const { detail, progress, next } = data;

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
            <SystemButton icon="sparkles-outline" onPress={() => setBuilding(true)}>
              Build a program
            </SystemButton>
          </SystemPanel>
          {data.previous && (
            <SystemButton
              variant="secondary"
              icon="repeat"
              onPress={() => write(() => startProgram(draftFrom(data.previous!)))}
            >
              Run {data.previous.name} again
            </SystemButton>
          )}
        </Screen>
        <ProgramBuilderSheet open={building} close={() => setBuilding(false)} />
      </>
    );

  const dayName = (id: number) => detail.days.find((d) => d.id === id)?.name ?? "";
  const cellAction = (cell: SessionCell) => {
    if (cell.workoutId && cell.state === "done")
      return router.push({ pathname: "/session/[id]", params: { id: String(cell.workoutId) } });
    if (cell.state === "open") return router.push("/workout");
    const title = `${dayName(cell.dayId)} · ${weekLabel(detail, cell.week)}`;
    if (cell.state === "skipped")
      return Alert.alert(title, "This session was skipped.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unskip",
          onPress: () => write(() => unskipSession(detail.id, cell.week, cell.dayId)),
        },
      ]);
    Alert.alert(title, undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "Skip", onPress: () => write(() => skipSession(detail.id, cell.week, cell.dayId)) },
      { text: "Start", onPress: () => begin(detail, cell.week, cell.dayId) },
    ]);
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
                    onPress: () =>
                      router.push({ pathname: "/program", params: { id: String(detail.id) } }),
                  },
                  {
                    key: "new",
                    label: "Build a new program",
                    icon: "sparkles-outline",
                    onPress: () => setBuilding(true),
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
        {next ? (
          <SystemPanel className="gap-3 bg-accent-soft">
            <SystemLabel className="text-accent-soft-foreground">
              {next.state === "open" ? "In progress" : "Next"}
            </SystemLabel>
            <Text className="text-xl font-semibold">
              {dayName(next.dayId)} · {weekLabel(detail, next.week)}
            </Text>
            <SystemButton
              icon="play"
              onPress={() =>
                next.state === "open"
                  ? router.push("/workout")
                  : begin(detail, next.week, next.dayId)
              }
            >
              {next.state === "open" ? "Resume" : "Start"}
            </SystemButton>
          </SystemPanel>
        ) : (
          <SystemPanel className="gap-3 bg-success-soft">
            <Text className="text-lg font-semibold">Block done</Text>
            <Text className="text-muted">
              Run it again with loads carrying over, or build a new one.
            </Text>
            <SystemButton
              icon="repeat"
              onPress={() => write(() => startProgram(draftFrom(detail)))}
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
                    accessibilityLabel={`${dayName(cell.dayId)}, ${weekLabel(detail, week)}, ${cell.state}`}
                    onPress={() => cellAction(cell)}
                    className={twMerge(
                      "h-11 w-14 items-center justify-center rounded-xl active:opacity-60",
                      cell.state === "done" && "bg-success",
                      cell.state === "skipped" && "bg-surface-secondary",
                      (cell.state === "next" || cell.state === "open") && "bg-accent",
                      cell.state === "upcoming" && "border border-border"
                    )}
                  >
                    {cell.state === "done" && (
                      <SystemIcon name="checkmark" size={18} color="success-foreground" />
                    )}
                    {cell.state === "skipped" && <Text className="text-muted">–</Text>}
                    {(cell.state === "next" || cell.state === "open") && (
                      <SystemIcon name="play" size={16} color="accent-foreground" />
                    )}
                  </Pressable>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>

        <View className="gap-2">
          <SystemLabel>Days</SystemLabel>
          {detail.days.map((day) => (
            <Text key={day.id} className="text-sm text-muted">
              <Text className="text-sm font-semibold text-foreground">{day.name}: </Text>
              {day.slots.length} exercises
            </Text>
          ))}
        </View>
      </Screen>
      <ProgramBuilderSheet open={building} close={() => setBuilding(false)} />
    </>
  );
}
