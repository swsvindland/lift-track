import { View } from "react-native";
import type { FeedbackRating, Soreness } from "@/db";
import { useQuery, write } from "@/lib/data";
import { muscleLabels } from "@/lib/exercises";
import { useExercises } from "@/lib/exercise-store";
import { feedbackFor, saveFeedback, saveSoreness, trainedMuscles } from "@/lib/programs";
import { useStore } from "@/lib/store";
import type { Message } from "@/lib/translations";
import type { WorkoutDetail } from "@/lib/workouts";
import { ChipRow, Heading, Panel } from "@/vector";

const ratings = [
  "easy",
  "good",
  "hard",
  "tooMuch",
  "pain",
] as const satisfies readonly FeedbackRating[];
const ratingLabels: Record<FeedbackRating, Message> = {
  easy: "feedbackEasy",
  good: "feedbackGood",
  hard: "feedbackHard",
  tooMuch: "feedbackTooMuch",
  pain: "feedbackPain",
};

const soreness = ["fresh", "justInTime", "sore"] as const satisfies readonly Soreness[];
const sorenessLabels: Record<Soreness, Message> = {
  fresh: "sorenessFresh",
  justInTime: "sorenessJustInTime",
  sore: "sorenessSore",
};

/**
 * Two optional taps per muscle after a program session. Workload: Easy adds two sets next week,
 * Good one, Hard holds, Too much takes one away; Hurt holds and is worth a swap. Soreness coming
 * in speaks for the session that last trained the muscle: just recovered holds it, still sore
 * takes a set away. Unanswered muscles follow whether the reps were hit. Tapping an answer again
 * clears it.
 */
export function MuscleFeedback({ detail }: { detail: WorkoutDetail }) {
  const { t } = useStore();
  const { byId } = useExercises();
  const saved = useQuery(() => feedbackFor(detail.id), [detail.id]);
  const muscles = trainedMuscles(detail, byId);
  if (!muscles.length) return null;
  return (
    <Panel>
      <Panel.Title>{t("muscleFeedbackTitle")}</Panel.Title>
      <Panel.Description>{t("muscleFeedbackNote")}</Panel.Description>
      {muscles.map((muscle) => {
        const answer = saved.find((f) => f.muscle === muscle);
        const name = muscleLabels[muscle];
        return (
          <View key={muscle} className="gap-2">
            <Heading level={4}>{name}</Heading>
            <ChipRow
              values={ratings}
              value={answer?.rating ?? null}
              onChange={(rating) => write(() => saveFeedback(detail.id, muscle, rating))}
              label={(rating) => t(ratingLabels[rating])}
              accessibilityLabel={t("workloadFor", { muscle: name })}
            />
            <ChipRow
              values={soreness}
              value={answer?.soreness ?? null}
              onChange={(value) => write(() => saveSoreness(detail.id, muscle, value))}
              label={(value) => t(sorenessLabels[value])}
              accessibilityLabel={t("sorenessFor", { muscle: name })}
            />
          </View>
        );
      })}
    </Panel>
  );
}
