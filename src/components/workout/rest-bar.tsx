import { useEffect, useRef } from "react";
import { AccessibilityInfo, View } from "react-native";
import { useQuery, write } from "@/lib/data";
import { adjustRest, formatClock, stopRest, useRest } from "@/lib/rest-timer";
import { useStore } from "@/lib/store";
import { rateSet, setById } from "@/lib/workouts";
import { IconButton, Label, LinkButton, ScreenFooter, Text, Value, useHaptics } from "@/vector";
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
        <IconButton
          icon="remove"
          accessibilityLabel={t("restLess")}
          onPress={() => adjustRest(-15)}
        />
        <IconButton icon="add" accessibilityLabel={t("restMore")} onPress={() => adjustRest(15)} />
        <LinkButton onPress={stopRest}>{t("skip")}</LinkButton>
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
