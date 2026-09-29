import { useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { router, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { ExercisePicker } from "@/components/exercises/exercise-picker";
import { write } from "@/lib/data";
import { pendingDraft, setPendingDraft } from "@/lib/draft-store";
import { muscleLabels, type Exercise } from "@/lib/exercises";
import type { Muscle } from "@/lib/exercises/types";
import { useExercises } from "@/lib/exercise-store";
import type { DraftSlot, ProgramDraft } from "@/lib/program-builder";
import { rirPlan } from "@/lib/progression";
import {
  activeMeso,
  draftFrom,
  nextBlock,
  programDetail,
  saveProgram,
  startProgram,
  startSaved,
  updateProgram,
} from "@/lib/programs";
import { useStore } from "@/lib/store";
import { activeGym, listGyms } from "@/lib/workouts";
import {
  ActionMenu,
  Button,
  Choices,
  DetailScreen,
  Field,
  Label,
  Meta,
  Note,
  Panel,
  Stepper,
  SystemState,
  Text,
  Value,
  useKitFormat,
  useKitStrings,
} from "@/vector";

const MAX_SETS = 8;

/** Weekly sets per muscle in week one: whole sets for primary movers, half for secondary. */
function weeklySets(draft: ProgramDraft, byId: (id: string) => Exercise) {
  const totals: Partial<Record<Muscle, number>> = {};
  for (const slot of draft.days.flatMap((d) => d.slots))
    for (const [m, w] of Object.entries(byId(slot.exerciseId).muscles) as [Muscle, number][])
      totals[m] = (totals[m] ?? 0) + slot.sets * w;
  return (Object.entries(totals) as [Muscle, number][]).sort((a, b) => b[1] - a[1]);
}

/**
 * Edits a freshly built program, or a saved or running one when given its id. A finished one
 * opens as its next block, loads carrying over, and saves as a new program.
 */
export function ProgramEditor({ programId }: { programId?: number }) {
  const { units, t } = useStore();
  const strings = useKitStrings();
  const format = useKitFormat();
  const { byId } = useExercises();
  const [program] = useState(() => (programId ? programDetail(programId) : undefined));
  // Where saving goes: a new program, or back into this one.
  const kind = !programId ? "new" : program?.status === "finished" ? "again" : program?.status;
  const [initial] = useState<ProgramDraft | null>(() => {
    if (!programId) return pendingDraft();
    if (!program) return null;
    return program.status === "finished" ? nextBlock(program, byId) : draftFrom(program);
  });
  const [draft, setDraft] = useState(initial);
  const left = useRef(false);
  const navigation = useNavigation();
  const [picking, setPicking] = useState<{ day: number; slot?: number } | null>(null);
  const [gyms] = useState(() => listGyms(units));

  const valid = () => {
    if (!draft) return false;
    if (!draft.days.some((d) => !d.slots.length)) return true;
    Alert.alert(t("emptyDay"), t("emptyDayBody"));
    return false;
  };
  /** Saves without starting: back into this program, or as a new saved one. */
  const persist = () => {
    if (!draft || !valid()) return false;
    write(() =>
      (kind === "saved" || kind === "active") && programId
        ? updateProgram(programId, draft)
        : saveProgram(draft)
    );
    return true;
  };
  const unsaved = !!draft && (kind === "new" || JSON.stringify(draft) !== JSON.stringify(initial));
  usePreventRemove(unsaved, ({ data }) => {
    const leave = () => navigation.dispatch(data.action);
    if (left.current) return leave();
    // vector: irreversible
    Alert.alert(kind === "new" ? t("keepThisProgram") : t("saveChanges"), undefined, [
      { text: t("keepEditing"), style: "cancel" },
      { text: t("discard"), style: "destructive", onPress: leave },
      {
        text: kind === "new" || kind === "again" ? t("saveForLater") : strings.save,
        onPress: () => {
          if (persist()) leave();
        },
      },
    ]);
  });

  const title = t(kind === "new" ? "newProgram" : kind === "again" ? "runAgain" : "editProgram");
  if (!draft)
    return (
      <DetailScreen title={title}>
        <SystemState kind="empty" message={t("nothingToEdit")} />
      </DetailScreen>
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

  const leave = () => {
    left.current = true;
    if (kind === "new") setPendingDraft(null);
    router.dismissTo("/plan");
  };
  const start = () => {
    if (!valid()) return;
    const running = activeMeso();
    const go = () => {
      write(() => {
        if (kind === "saved" && programId) {
          updateProgram(programId, draft);
          startSaved(programId);
        } else startProgram(draft);
      });
      leave();
    };
    if (running && running.id !== programId)
      // vector: irreversible
      Alert.alert(
        t("startNamed", { name: draft.name }),
        t("endsStayInHistory", { name: running.name }),
        [
          { text: t("cancel"), style: "cancel" },
          { text: t("start"), onPress: go },
        ]
      );
    else go();
  };
  const save = () => {
    if (persist()) leave();
  };

  const weeks = draft.rir.length;
  const gym = gyms.find((g) => g.id === draft.gymId) ?? activeGym(units);
  const whole = (n: number) => format.number(n);
  return (
    <>
      <DetailScreen title={title}>
        <Field
          label={t("name")}
          value={draft.name}
          onChange={(name) => change((d) => void (d.name = name))}
        />
        {gyms.length > 1 && (
          <View className="gap-2">
            <Label accessibilityRole="header">{t("gym")}</Label>
            <Choices
              values={gyms.map((g) => String(g.id))}
              value={String(gym.id)}
              onChange={(id) => change((d) => void (d.gymId = Number(id)))}
              label={(id) => gyms.find((g) => String(g.id) === id)?.name ?? ""}
              accessibilityLabel={t("gym")}
            />
            <Note>{t("gymStandInsNote")}</Note>
          </View>
        )}
        <View className="gap-2">
          <Label accessibilityRole="header">{t("weeksBeforeDeload")}</Label>
          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1 gap-1">
              <Note>{t("rirByWeek")}</Note>
              <Meta items={[...draft.rir.map((r) => format.number(r)), t("deload")]} />
            </View>
            <Stepper
              value={weeks}
              min={3}
              max={6}
              label={t("weeksBeforeDeload")}
              format={whole}
              onChange={(w) => change((d) => void (d.rir = rirPlan(w)))}
            />
          </View>
        </View>

        {draft.days.map((day, dayIndex) => (
          <Panel key={dayIndex} className="gap-2">
            <View className="flex-row items-end gap-2">
              <View className="flex-1">
                <Field
                  label={t("dayN", { n: format.number(dayIndex + 1) })}
                  value={day.name}
                  onChange={(name) => change((d) => void (d.days[dayIndex].name = name))}
                />
              </View>
              <ActionMenu
                accessibilityLabel={t("optionsFor", { name: day.name })}
                sections={[
                  {
                    actions: [
                      {
                        key: "remove",
                        label: t("removeDay"),
                        icon: "delete",
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
                      accessibilityHint={t("swapExercise")}
                      onPress={() => setPicking({ day: dayIndex, slot: slotIndex })}
                    >
                      <Text variant="bodyStrong">{exercise.name}</Text>
                      <Meta
                        items={[
                          t("repRange", { range: format.range(slot.reps[0], slot.reps[1]) }),
                          t("tapToSwap"),
                        ]}
                      />
                    </Pressable>
                    <ActionMenu
                      accessibilityLabel={t("optionsFor", { name: exercise.name })}
                      sections={[
                        {
                          actions: [
                            {
                              key: "up",
                              label: t("moveUp"),
                              icon: "moveUp",
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
                              label: t("fewerReps"),
                              icon: "remove",
                              disabled: slot.reps[0] <= 1,
                              onPress: () =>
                                updateSlot(dayIndex, slotIndex, {
                                  reps: [slot.reps[0] - 1, slot.reps[1] - 1],
                                }),
                            },
                            {
                              key: "more",
                              label: t("moreReps"),
                              icon: "add",
                              onPress: () =>
                                updateSlot(dayIndex, slotIndex, {
                                  reps: [slot.reps[0] + 1, slot.reps[1] + 1],
                                }),
                            },
                            {
                              key: "remove",
                              label: t("remove"),
                              icon: "delete",
                              destructive: true,
                              onPress: () =>
                                change((d) => void d.days[dayIndex].slots.splice(slotIndex, 1)),
                            },
                          ],
                        },
                      ]}
                    />
                  </View>
                  <View className="flex-row items-center justify-between gap-3">
                    <Note className="flex-1">{t("setsInWeekOne")}</Note>
                    <Stepper
                      value={slot.sets}
                      min={1}
                      max={MAX_SETS}
                      label={t("setsInWeekOneOf", { name: exercise.name })}
                      format={whole}
                      onChange={(sets) => updateSlot(dayIndex, slotIndex, { sets })}
                    />
                  </View>
                </View>
              );
            })}
            <Button
              variant="ghost"
              icon="add"
              className="self-start"
              onPress={() => setPicking({ day: dayIndex })}
            >
              {t("addExercise")}
            </Button>
          </Panel>
        ))}

        <Button
          variant="secondary"
          icon="add"
          onPress={() =>
            change(
              (d) =>
                void d.days.push({
                  name: t("dayN", { n: format.number(d.days.length + 1) }),
                  slots: [],
                })
            )
          }
        >
          {t("addDay")}
        </Button>

        <Panel>
          <Panel.Header eyebrow={t("weekOneSetsPerMuscle")} />
          {weeklySets(draft, byId).map(([m, total]) => (
            <View key={m} className="flex-row items-center justify-between gap-3">
              <Text variant="small" className="shrink">
                {muscleLabels[m]}
              </Text>
              <Value
                size="xs"
                tone="muted"
                value={format.number(total, Number.isInteger(total) ? 0 : 1)}
              />
            </View>
          ))}
          <Note>{t("setsRiseNote")}</Note>
        </Panel>

        {kind === "active" ? (
          <Button onPress={save}>{strings.save}</Button>
        ) : (
          <View className="gap-2">
            <Button icon="play" onPress={start}>
              {t("startProgram")}
            </Button>
            <Button variant="secondary" onPress={save}>
              {kind === "saved" ? strings.save : t("saveForLater")}
            </Button>
          </View>
        )}
      </DetailScreen>
      <ExercisePicker
        open={!!picking}
        close={() => setPicking(null)}
        onPick={pick}
        title={picking?.slot !== undefined ? t("swapExercise") : t("addExercise")}
        replacing={
          picking?.slot !== undefined
            ? byId(draft.days[picking.day].slots[picking.slot].exerciseId)
            : undefined
        }
        gym={gym}
      />
    </>
  );
}
