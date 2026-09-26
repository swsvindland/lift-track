import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { Chip, SystemButton, SystemLabel, SystemText as Text } from "@/components/system";
import { Choices, Editor } from "@/components/ui";
import { muscleLabels } from "@/lib/exercises";
import { muscles, type Muscle } from "@/lib/exercises/types";
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

  const build = () => {
    const draft = buildProgram(
      {
        days: Number(days),
        minutes: Number(minutes) as 45 | 60 | 75 | 90,
        weeks: Number(weeks),
        experience,
        priorities,
        equipment: activeGym(units).equipment,
        settings,
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
