import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { Chip, SystemButton, SystemLabel, SystemText as Text } from "@/components/system";
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

type Props = { open: boolean; close: () => void };

/** A few questions, then the editor opens on a program built from them. */
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

  return (
    <Editor
      title="Build a program"
      open={open}
      close={close}
      footer={<SystemButton onPress={build}>Build</SystemButton>}
    >
      <View className="gap-2">
        <Field
          label="Describe what you want (optional)"
          value={wish}
          onChange={setWish}
          placeholder="4 days, an hour, only dumbbells, bad left shoulder, bigger arms"
          multiline
        />
        <SystemButton
          variant="secondary"
          icon={
            model.available ? <AiMark size={18} color="accent-soft-foreground" /> : "text-outline"
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
        <Choices values={minuteOptions} value={minutes} onChange={setMinutes} label={(m) => m} />
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
      <View className="gap-2">
        <SystemLabel>Bring up (up to 3)</SystemLabel>
        <View className="flex-row flex-wrap gap-2">
          {muscles.map((m) => (
            <Chip
              key={m}
              label={muscleLabels[m]}
              selected={priorities.includes(m)}
              onPress={() =>
                setPriorities(
                  priorities.includes(m)
                    ? priorities.filter((p) => p !== m)
                    : [...priorities, m].slice(-3)
                )
              }
            />
          ))}
        </View>
      </View>
      <Text className="text-sm text-muted">
        Exercises come from your gym&apos;s equipment and skip ones marked Avoid. You can change
        anything next.
      </Text>
    </Editor>
  );
}
