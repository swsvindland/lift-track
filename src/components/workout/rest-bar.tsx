import { useEffect, useRef } from "react";
import { View } from "react-native";
import * as Haptics from "expo-haptics";
import { SystemButton, SystemText as Text } from "@/components/system";
import { useQuery, write } from "@/lib/data";
import { adjustRest, formatClock, stopRest, useRest } from "@/lib/rest-timer";
import { rateSet, setById } from "@/lib/workouts";
import { EffortPicker } from "./effort";

/** The running rest, pinned above the bottom of the workout, with the set just done to rate. */
export function RestBar() {
  const { rest, left } = useRest();
  const set = useQuery(() => (rest?.setId ? setById(rest.setId) : undefined), [rest?.setId]);
  const buzzed = useRef<number | null>(null);
  useEffect(() => {
    if (!rest || left > 0 || buzzed.current === rest.endsAt) return;
    buzzed.current = rest.endsAt;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const timer = setTimeout(stopRest, 2000);
    return () => clearTimeout(timer);
  }, [rest, left]);
  if (!rest) return null;
  const progress = Math.min(1, Math.max(0, 1 - left / rest.total));
  return (
    <View
      className="gap-2 overflow-hidden rounded-3xl bg-foreground p-3"
      accessibilityLiveRegion="polite"
    >
      <View className="flex-row items-center gap-2">
        <SystemButton
          variant="ghost"
          className="min-w-14 px-2"
          labelClassName="text-background"
          onPress={() => adjustRest(-15)}
          accessibilityLabel="15 seconds less"
        >
          −15
        </SystemButton>
        <View className="flex-1 items-center">
          <Text className="font-mono text-3xl tabular-nums text-background">
            {left > 0 ? formatClock(left) : "Go"}
          </Text>
          <Text className="text-xs text-background opacity-70" numberOfLines={1}>
            {left > 0 ? rest.label : "Rest over"}
          </Text>
        </View>
        <SystemButton
          variant="ghost"
          className="min-w-14 px-2"
          labelClassName="text-background"
          onPress={() => adjustRest(15)}
          accessibilityLabel="15 seconds more"
        >
          +15
        </SystemButton>
        <SystemButton variant="secondary" onPress={stopRest}>
          Skip
        </SystemButton>
      </View>
      <View className="h-1 overflow-hidden rounded-full bg-muted">
        <View className="h-1 bg-accent" style={{ width: `${progress * 100}%` }} />
      </View>
      {set?.completedAt && (
        <EffortPicker
          inverted
          effort={set.effort}
          onChange={(effort) => write(() => rateSet(set.id, effort))}
        />
      )}
    </View>
  );
}
