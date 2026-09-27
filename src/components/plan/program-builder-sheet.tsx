import { useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { router } from "expo-router";
import { Switch } from "heroui-native";
import { SystemButton, SystemLabel, SystemPanel, SystemText as Text } from "@/components/system";
import { Choices, Editor, Field } from "@/components/ui";
import { equipmentLabels, matchExercise, muscleLabels, primaryMuscles } from "@/lib/exercises";
import { muscles, type Equipment, type Muscle } from "@/lib/exercises/types";
import { readBuilderHints } from "@/lib/lift-ai";
import { useModel } from "@/lib/use-model";
import { AiMark } from "@/components/ai-mark";
import { useExercises } from "@/lib/exercise-store";
import { setPendingDraft } from "@/lib/draft-store";
import { buildProgram, splits, type Experience } from "@/lib/program-builder";
import { useStore } from "@/lib/store";
import { activeGym } from "@/lib/workouts";

const dayOptions = ["2", "3", "4", "5", "6"] as const;
const minuteOptions = ["45", "60", "75", "90"] as const;
const weekOptions = ["4", "5", "6"] as const;
const experienceOptions = ["beginner", "intermediate", "advanced"] as const;
const experienceLabels: Record<Experience, string> = {
  beginner: "Under a year",
  intermediate: "1–3 years",
  advanced: "3+ years",
};

const MAX_PRIORITIES = 3;
const steps = ["Build a program", "Bring up", "Bring down"] as const;

type Props = { open: boolean; close: () => void };

/** A few questions, muscles to bring up, muscles to bring down, then the editor opens. */
export function ProgramBuilderSheet(props: Props) {
  return props.open ? <OpenBuilder {...props} /> : null;
}

function OpenBuilder({ open, close }: Props) {
  const { units } = useStore();
  const { all, settings } = useExercises();
  const [days, setDays] = useState<(typeof dayOptions)[number]>("4");
  const [minutes, setMinutes] = useState<(typeof minuteOptions)[number]>("60");
  const [weeks, setWeeks] = useState<(typeof weekOptions)[number]>("5");
  const [experience, setExperience] = useState<Experience>("intermediate");
  const [priorities, setPriorities] = useState<Muscle[]>([]);
  const [deprioritized, setDeprioritized] = useState<Muscle[]>([]);
  const [step, setStep] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const [wish, setWish] = useState("");
  const [reading, setReading] = useState(false);
  const [kit, setKit] = useState<Equipment[] | null>(null);
  const [avoid, setAvoid] = useState<{ label: string; ids: string[] }[]>([]);
  const model = useModel();

  /** Fills the answers from a sentence; what hurts is left out of this program only. */
  const fillFromWords = async () => {
    setReading(true);
    try {
      const hints = await readBuilderHints(wish, model.generate);
      if (hints.days) setDays(String(hints.days) as (typeof dayOptions)[number]);
      if (hints.minutes) setMinutes(String(hints.minutes) as (typeof minuteOptions)[number]);
      if (hints.weeks) setWeeks(String(hints.weeks) as (typeof weekOptions)[number]);
      if (hints.experience) setExperience(hints.experience);
      if (hints.priorities.length) setPriorities(hints.priorities);
      if (hints.deprioritized.length) setDeprioritized(hints.deprioritized);
      setKit(hints.equipment ?? null);
      setAvoid(
        hints.avoid.flatMap((phrase) => {
          const { exercise } = matchExercise(all, phrase);
          if (!exercise) return [];
          // "overhead press" means the movement; "barbell overhead press" means that one exercise.
          const general =
            !/\b(barbell|bb|dumbbell|db|machine|cable|smith|ez|kettlebell|band)\b/i.test(phrase);
          const ids = general
            ? all
                .filter(
                  (e) =>
                    e.pattern === exercise.pattern &&
                    primaryMuscles(e).some((m) => exercise.muscles[m] === 1)
                )
                .map((e) => e.id)
            : [exercise.id];
          return [{ label: general ? phrase : exercise.name, ids }];
        })
      );
    } finally {
      setReading(false);
    }
  };

  const build = () => {
    const draft = buildProgram(
      {
        days: Number(days),
        minutes: Number(minutes) as 45 | 60 | 75 | 90,
        weeks: Number(weeks),
        experience,
        priorities,
        deprioritized: deprioritized.filter((m) => !priorities.includes(m)),
        equipment: kit
          ? activeGym(units).equipment.filter((e) => kit.includes(e))
          : activeGym(units).equipment,
        settings: [
          ...settings,
          ...avoid
            .flatMap((a) => a.ids)
            .map((exerciseId) => ({
              exerciseId,
              avoid: true,
              favorite: false,
              restSeconds: null,
              note: "",
            })),
        ],
      },
      all
    );
    setPendingDraft(draft);
    close();
    router.push("/program");
  };

  const go = (next: number) => {
    setStep(next);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };
  const toggle = (list: Muscle[], set: (next: Muscle[]) => void, m: Muscle) =>
    set(list.includes(m) ? list.filter((x) => x !== m) : [...list, m]);
  const picked = step === 1 ? priorities : deprioritized;

  return (
    <Editor
      title={steps[step]}
      open={open}
      close={close}
      scrollRef={scrollRef}
      footer={
        <View className="flex-row gap-3">
          {step > 0 && (
            <SystemButton variant="outline" onPress={() => go(step - 1)}>
              Back
            </SystemButton>
          )}
          <SystemButton
            className="flex-1"
            onPress={step < steps.length - 1 ? () => go(step + 1) : build}
          >
            {step === steps.length - 1 ? "Build" : step > 0 && !picked.length ? "Skip" : "Next"}
          </SystemButton>
        </View>
      }
    >
      {step === 0 && (
        <>
          <View className="gap-2">
            <Field
              label="Describe what you want (optional)"
              value={wish}
              onChange={setWish}
              placeholder="4 days, an hour, only dumbbells, bad left shoulder, bigger arms, smaller quads"
              multiline
            />
            <SystemButton
              variant="secondary"
              icon={
                model.available ? (
                  <AiMark size={18} color="accent-soft-foreground" />
                ) : (
                  "text-outline"
                )
              }
              isDisabled={reading || !wish.trim()}
              onPress={() => void fillFromWords()}
            >
              {reading ? "Reading…" : "Fill in from this"}
            </SystemButton>
            {(kit || avoid.length > 0) && (
              <Text className="text-sm text-muted">
                {kit ? `Using only: ${kit.map((e) => equipmentLabels[e]).join(", ")}. ` : ""}
                {avoid.length ? `Leaving out: ${avoid.map((a) => a.label).join(", ")}.` : ""}
              </Text>
            )}
            {!model.available && (
              <Text className="text-xs text-muted">
                Without an on-device model, only days, minutes and weeks are read.
              </Text>
            )}
          </View>
          <View className="gap-2">
            <SystemLabel>Days a week</SystemLabel>
            <Choices values={dayOptions} value={days} onChange={setDays} label={(d) => d} />
            <Text className="text-sm text-muted">{splits[Number(days)].name}</Text>
          </View>
          <View className="gap-2">
            <SystemLabel>Minutes a session</SystemLabel>
            <Choices
              values={minuteOptions}
              value={minutes}
              onChange={setMinutes}
              label={(m) => m}
            />
          </View>
          <View className="gap-2">
            <SystemLabel>Lifting for</SystemLabel>
            <Choices
              values={experienceOptions}
              value={experience}
              onChange={setExperience}
              label={(e) => experienceLabels[e]}
            />
          </View>
          <View className="gap-2">
            <SystemLabel>Weeks before the deload</SystemLabel>
            <Choices values={weekOptions} value={weeks} onChange={setWeeks} label={(w) => w} />
          </View>
        </>
      )}
      {step === 1 && (
        <MuscleList
          note={`Up to ${MAX_PRIORITIES}. They get more sets and are never cut for time.`}
          options={muscles}
          selected={priorities}
          full={priorities.length >= MAX_PRIORITIES}
          onToggle={(m) => toggle(priorities, setPriorities, m)}
        />
      )}
      {step === 2 && (
        <>
          <MuscleList
            note="Trained less, and their sets don't grow week to week."
            options={muscles.filter((m) => !priorities.includes(m))}
            selected={deprioritized}
            onToggle={(m) => toggle(deprioritized, setDeprioritized, m)}
          />
          <Text className="text-sm text-muted">
            Exercises come from your gym&apos;s equipment and skip ones marked Avoid. You can change
            anything next.
          </Text>
        </>
      )}
    </Editor>
  );
}

/** Muscles by body region, so a long list reads in chunks. */
const regions: { name: string; muscles: Muscle[] }[] = [
  { name: "Chest and back", muscles: ["chest", "lats", "upperBack", "traps"] },
  { name: "Shoulders", muscles: ["frontDelts", "sideDelts", "rearDelts"] },
  { name: "Arms", muscles: ["biceps", "triceps", "forearms"] },
  { name: "Core", muscles: ["abs", "lowerBack"] },
  { name: "Legs", muscles: ["glutes", "quads", "hamstrings", "adductors", "calves"] },
];

/** A switch per muscle, grouped by region. Once `full`, the others wait until one is turned off. */
function MuscleList({
  note,
  options,
  selected,
  full = false,
  onToggle,
}: {
  note: string;
  options: readonly Muscle[];
  selected: Muscle[];
  full?: boolean;
  onToggle: (m: Muscle) => void;
}) {
  return (
    <>
      <Text className="text-sm text-muted">{note}</Text>
      {regions.map((region) => {
        const shown = region.muscles.filter((m) => options.includes(m));
        if (!shown.length) return null;
        return (
          <View key={region.name} className="gap-2">
            <SystemLabel>{region.name}</SystemLabel>
            <SystemPanel className="gap-4">
              {shown.map((m) => (
                <View key={m} className="flex-row items-center justify-between gap-4">
                  <Text className="flex-1">{muscleLabels[m]}</Text>
                  <Switch
                    accessibilityLabel={muscleLabels[m]}
                    isSelected={selected.includes(m)}
                    isDisabled={full && !selected.includes(m)}
                    onSelectedChange={() => onToggle(m)}
                  />
                </View>
              ))}
            </SystemPanel>
          </View>
        );
      })}
    </>
  );
}
