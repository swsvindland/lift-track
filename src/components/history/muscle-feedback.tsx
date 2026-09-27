import { View } from "react-native";
import { Chip, SystemLabel, SystemPanel, SystemText as Text } from "@/components/system";
import type { FeedbackRating, Soreness } from "@/db";
import { useQuery, write } from "@/lib/data";
import { muscleLabels } from "@/lib/exercises";
import { useExercises } from "@/lib/exercise-store";
import { feedbackFor, saveFeedback, saveSoreness, trainedMuscles } from "@/lib/programs";
import type { WorkoutDetail } from "@/lib/workouts";

const ratings: { value: FeedbackRating; label: string }[] = [
  { value: "easy", label: "Easy" },
  { value: "good", label: "Good" },
  { value: "hard", label: "Hard" },
  { value: "tooMuch", label: "Too much" },
  { value: "pain", label: "Hurt" },
];

const soreness: { value: Soreness; label: string }[] = [
  { value: "fresh", label: "Not sore" },
  { value: "justInTime", label: "Just recovered" },
  { value: "sore", label: "Still sore" },
];

/**
 * Two optional taps per muscle after a program session. Workload: Easy adds two sets next week,
 * Good one, Hard holds, Too much takes one away; Hurt holds and is worth a swap. Soreness coming
 * in speaks for the session that last trained the muscle: just recovered holds it, still sore
 * takes a set away. Unanswered muscles follow whether the reps were hit.
 */
export function MuscleFeedback({ detail }: { detail: WorkoutDetail }) {
  const { byId } = useExercises();
  const saved = useQuery(() => feedbackFor(detail.id), [detail.id]);
  const muscles = trainedMuscles(detail, byId);
  if (!muscles.length) return null;
  return (
    <SystemPanel className="gap-3">
      <View className="gap-1">
        <SystemLabel>How did each muscle feel?</SystemLabel>
        <Text className="text-sm text-muted">
          Optional. Next week&apos;s sets follow this; skip it and your reps decide.
        </Text>
      </View>
      {muscles.map((muscle) => {
        const answer = saved.find((f) => f.muscle === muscle);
        return (
          <View key={muscle} className="gap-2">
            <Text className="font-medium">{muscleLabels[muscle]}</Text>
            <View className="flex-row flex-wrap gap-2">
              {ratings.map((r) => (
                <Chip
                  key={r.value}
                  label={r.label}
                  selected={answer?.rating === r.value}
                  onPress={() =>
                    write(() =>
                      saveFeedback(detail.id, muscle, answer?.rating === r.value ? null : r.value)
                    )
                  }
                />
              ))}
            </View>
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="text-sm text-muted">Coming in:</Text>
              {soreness.map((r) => (
                <Chip
                  key={r.value}
                  label={r.label}
                  selected={answer?.soreness === r.value}
                  onPress={() =>
                    write(() =>
                      saveSoreness(detail.id, muscle, answer?.soreness === r.value ? null : r.value)
                    )
                  }
                />
              ))}
            </View>
          </View>
        );
      })}
    </SystemPanel>
  );
}
