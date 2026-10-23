import { useEffect, useRef } from "react";
import { AccessibilityInfo, View } from "react-native";
import { useQuery, write } from "@/lib/data";
import { formatClock, stopRest, useRest } from "@/lib/rest-timer";
import { useStore } from "@/lib/store";
import { rateSet, setById } from "@/lib/workouts";
import { Button, Label, ScreenFooter, Text, Value, useHaptics } from "@/vector";
import { EffortPicker } from "./effort";

/** The running rest, docked at the bottom of the workout as the live strip, with the set just done to rate. */
export function RestBar() {
  const { t } = useStore();
  const haptics = useHaptics();
  const { rest, left } = useRest();
  const set = useQuery(() => (rest?.setId ? setById(rest.setId) : undefined), [rest?.setId]);
  const buzzed = useRef<number | null>(null);
  const over = t("restOver");
  useEffect(() => {
    if (!rest || left > 0 || buzzed.current === rest.endsAt) return;
    buzzed.current = rest.endsAt;
    haptics.complete();
    // Said once: a live region around the strip would re-read the ticking clock every second.
    AccessibilityInfo.announceForAccessibility(over);
    const timer = setTimeout(stopRest, 2000);
    return () => clearTimeout(timer);
  }, [rest, left, haptics, over]);
  if (!rest) return null;
  return (
    <>
      <ScreenFooter tone="live">
        <View className="flex-1">
          <Label tone="onSignal">{left > 0 ? t("rest") : over}</Label>
          <Value size="l" tone="onSignal" value={formatClock(Math.max(0, left))} />
          {left > 0 && (
            <Text variant="caption" tone="onSignal">
              {rest.label}
            </Text>
          )}
        </View>
        {/* The length is a suggestion: go early with Skip, or simply wait longer. An outline, so it reads as a button. */}
        <Button variant="secondary" onPress={stopRest}>
          {t("skip")}
        </Button>
      </ScreenFooter>
      {set?.completedAt && (
        <ScreenFooter>
          <EffortPicker
            effort={set.effort}
            onChange={(effort) => write(() => rateSet(set.id, effort))}
          />
        </ScreenFooter>
      )}
    </>
  );
}
