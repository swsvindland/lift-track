import { useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { router, Stack } from "expo-router";
import { useThemeColor } from "heroui-native";
import {
  SystemButton,
  SystemIconButton,
  SystemLabel,
  SystemPanel,
  SystemText as Text,
} from "@/components/system";
import { ActionMenu, Field, Screen } from "@/components/ui";
import { ExercisePicker } from "@/components/exercises/exercise-picker";
import { write } from "@/lib/data";
import { pendingDraft, setPendingDraft } from "@/lib/draft-store";
import { muscleLabels, type Exercise } from "@/lib/exercises";
import type { Muscle } from "@/lib/exercises/types";
import { useExercises } from "@/lib/exercise-store";
import type { DraftSlot, ProgramDraft } from "@/lib/program-builder";
import { rirPlan } from "@/lib/progression";
import { draftFrom, programDetail, startProgram, updateProgram } from "@/lib/programs";
import { useStore } from "@/lib/store";
import { activeGym } from "@/lib/workouts";

const MAX_SETS = 8;

function Stepper({
  value,
  onChange,
  min,
  max,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  label: string;
}) {
  return (
    <View className="flex-row items-center">
      <SystemIconButton
        icon="remove"
        iconSize={18}
        accessibilityLabel={`Fewer ${label}`}
        isDisabled={value <= min}
        onPress={() => onChange(value - 1)}
      />
      <Text className="min-w-6 text-center font-mono">{value}</Text>
      <SystemIconButton
        icon="add"
        iconSize={18}
        accessibilityLabel={`More ${label}`}
        isDisabled={value >= max}
        onPress={() => onChange(value + 1)}
      />
    </View>
  );
}

/** Weekly sets per muscle in week one: whole sets for primary movers, half for secondary. */
function weeklySets(draft: ProgramDraft, byId: (id: string) => Exercise) {
  const totals: Partial<Record<Muscle, number>> = {};
  for (const slot of draft.days.flatMap((d) => d.slots))
    for (const [m, w] of Object.entries(byId(slot.exerciseId).muscles) as [Muscle, number][])
      totals[m] = (totals[m] ?? 0) + slot.sets * w;
  return (Object.entries(totals) as [Muscle, number][]).sort((a, b) => b[1] - a[1]);
}

/** Edits a freshly built program before it starts, or the running one when given its id. */
export function ProgramEditor({ programId }: { programId?: number }) {
  const { units } = useStore();
  const { byId } = useExercises();
  const background = useThemeColor("background");
  const foreground = useThemeColor("foreground");
  const [draft, setDraft] = useState<ProgramDraft | null>(() => {
    if (programId) {
      const detail = programDetail(programId);
      return detail ? draftFrom(detail) : null;
    }
    return pendingDraft();
  });
  const [picking, setPicking] = useState<{ day: number; slot?: number } | null>(null);

  const header = (
    <Stack.Screen
      options={{
        headerShown: true,
        title: programId ? "Edit program" : "New program",
        headerBackButtonDisplayMode: "minimal",
        headerStyle: { backgroundColor: background },
        headerTintColor: foreground,
        contentStyle: { backgroundColor: background },
      }}
    />
  );
  if (!draft)
    return (
      <Screen title="Program" nativeHeader>
        {header}
        <Text className="text-muted">Nothing to edit.</Text>
      </Screen>
    );

  const change = (fn: (d: ProgramDraft) => void) =>
    setDraft((current) => {
      if (!current) return current;
      const next: ProgramDraft = structuredClone(current);
      fn(next);
      return next;
    });
  const updateSlot = (day: number, slot: number, patch: Partial<DraftSlot>) =>
    change((d) => Object.assign(d.days[day].slots[slot], patch));

  const pick = (exercise: Exercise) => {
    if (!picking) return;
    const { day, slot } = picking;
    setPicking(null);
    change((d) => {
      const reps: [number, number] = [exercise.reps[0], exercise.reps[1]];
      if (slot === undefined) d.days[day].slots.push({ exerciseId: exercise.id, sets: 2, reps });
      else Object.assign(d.days[day].slots[slot], { exerciseId: exercise.id, reps });
    });
  };

  const save = () => {
    if (draft.days.some((d) => !d.slots.length)) {
      Alert.alert("Empty day", "Give every day at least one exercise, or remove the day.");
      return;
    }
    if (programId) {
      write(() => updateProgram(programId, draft));
      router.back();
    } else {
      write(() => startProgram(draft));
      setPendingDraft(null);
      router.dismissTo("/plan");
    }
  };

  const weeks = draft.rir.length;
  return (
    <>
      <Screen title="Program" nativeHeader>
        {header}
        <Field
          label="Name"
          value={draft.name}
          onChange={(name) => change((d) => void (d.name = name))}
        />
        <View className="gap-2">
          <SystemLabel>Weeks before the deload</SystemLabel>
          <View className="flex-row items-center justify-between">
            <Text className="flex-1 text-sm text-muted">
              Reps in reserve by week: {draft.rir.join(" → ")} → deload
            </Text>
            <Stepper
              value={weeks}
              min={3}
              max={6}
              label="weeks"
              onChange={(w) => change((d) => void (d.rir = rirPlan(w)))}
            />
          </View>
        </View>

        {draft.days.map((day, dayIndex) => (
          <SystemPanel key={dayIndex} className="gap-2">
            <View className="flex-row items-center gap-2">
              <View className="flex-1">
                <Field
                  label={`Day ${dayIndex + 1}`}
                  value={day.name}
                  onChange={(name) => change((d) => void (d.days[dayIndex].name = name))}
                />
              </View>
              <ActionMenu
                accessibilityLabel={`${day.name} options`}
                sections={[
                  {
                    actions: [
                      {
                        key: "remove",
                        label: "Remove day",
                        icon: "trash-outline",
                        destructive: true,
                        disabled: draft.days.length <= 1,
                        onPress: () => change((d) => void d.days.splice(dayIndex, 1)),
                      },
                    ],
                  },
                ]}
              />
            </View>
            {day.slots.map((slot, slotIndex) => {
              const exercise = byId(slot.exerciseId);
              return (
                <View
                  key={`${slotIndex}-${slot.exerciseId}`}
                  className="gap-1 border-b border-separator pb-2"
                >
                  <View className="flex-row items-center gap-1">
                    <Pressable
                      className="flex-1"
                      accessibilityRole="button"
                      accessibilityHint="Swap exercise"
                      onPress={() => setPicking({ day: dayIndex, slot: slotIndex })}
                    >
                      <Text className="font-medium" numberOfLines={1}>
                        {exercise.name}
                      </Text>
                      <Text className="text-sm text-muted">
                        {slot.reps[0]}–{slot.reps[1]} reps · tap to swap
                      </Text>
                    </Pressable>
                    <ActionMenu
                      accessibilityLabel={`${exercise.name} options`}
                      sections={[
                        {
                          actions: [
                            {
                              key: "up",
                              label: "Move up",
                              icon: "arrow-up",
                              disabled: slotIndex === 0,
                              onPress: () =>
                                change((d) => {
                                  const s = d.days[dayIndex].slots;
                                  [s[slotIndex - 1], s[slotIndex]] = [
                                    s[slotIndex],
                                    s[slotIndex - 1],
                                  ];
                                }),
                            },
                            {
                              key: "fewer",
                              label: "Fewer reps",
                              icon: "remove",
                              disabled: slot.reps[0] <= 1,
                              onPress: () =>
                                updateSlot(dayIndex, slotIndex, {
                                  reps: [slot.reps[0] - 1, slot.reps[1] - 1],
                                }),
                            },
                            {
                              key: "more",
                              label: "More reps",
                              icon: "add",
                              onPress: () =>
                                updateSlot(dayIndex, slotIndex, {
                                  reps: [slot.reps[0] + 1, slot.reps[1] + 1],
                                }),
                            },
                            {
                              key: "remove",
                              label: "Remove",
                              icon: "trash-outline",
                              destructive: true,
                              onPress: () =>
                                change((d) => void d.days[dayIndex].slots.splice(slotIndex, 1)),
                            },
                          ],
                        },
                      ]}
                    />
                  </View>
                  <View className="flex-row items-center justify-between">
                    <Text className="text-sm text-muted">Sets in week 1</Text>
                    <Stepper
                      value={slot.sets}
                      min={1}
                      max={MAX_SETS}
                      label="sets"
                      onChange={(sets) => updateSlot(dayIndex, slotIndex, { sets })}
                    />
                  </View>
                </View>
              );
            })}
            <SystemButton variant="ghost" icon="add" onPress={() => setPicking({ day: dayIndex })}>
              Add exercise
            </SystemButton>
          </SystemPanel>
        ))}

        <SystemButton
          variant="secondary"
          icon="add"
          onPress={() =>
            change((d) => void d.days.push({ name: `Day ${d.days.length + 1}`, slots: [] }))
          }
        >
          Add day
        </SystemButton>

        <SystemPanel className="gap-2">
          <SystemLabel>Week 1 sets per muscle</SystemLabel>
          {weeklySets(draft, byId).map(([m, total]) => (
            <View key={m} className="flex-row justify-between">
              <Text className="text-sm">{muscleLabels[m]}</Text>
              <Text className="font-mono text-sm text-muted">{Math.round(total * 10) / 10}</Text>
            </View>
          ))}
          <Text className="text-sm text-muted">
            Sets rise week to week when you recover well and hit your reps.
          </Text>
        </SystemPanel>

        <SystemButton onPress={save}>{programId ? "Save" : "Start program"}</SystemButton>
      </Screen>
      <ExercisePicker
        open={!!picking}
        close={() => setPicking(null)}
        onPick={pick}
        title={picking?.slot !== undefined ? "Swap exercise" : "Add exercise"}
        replacing={
          picking?.slot !== undefined
            ? byId(draft.days[picking.day].slots[picking.slot].exerciseId)
            : undefined
        }
        equipment={activeGym(units).equipment}
      />
    </>
  );
}
