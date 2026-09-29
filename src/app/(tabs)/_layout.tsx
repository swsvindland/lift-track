import { NativeTabs } from "expo-router/unstable-native-tabs";
import { QuickActionItems } from "@/components/quick-actions";
import { useStore } from "@/lib/store";
import { tabOptions, useKit } from "@/vector";

export default function TabsLayout() {
  const { t } = useStore();
  const { scheme } = useKit();
  // No bar colours: iOS 26 draws the tab bar as Liquid Glass; tabOptions sets the tint (and Android's bar).
  // The dock and Undo come from the DockProvider around the root Stack (src/app/_layout.tsx).
  return (
    <>
      <QuickActionItems />
      <NativeTabs {...tabOptions(scheme)}>
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Label>{t("today")}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            sf={{ default: "dumbbell", selected: "dumbbell.fill" }}
            md="fitness_center"
          />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="plan">
          <NativeTabs.Trigger.Label>{t("plan")}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf="calendar" md="calendar_month" />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="progress">
          <NativeTabs.Trigger.Label>{t("progress")}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf="chart.xyaxis.line" md="monitoring" />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="library">
          <NativeTabs.Trigger.Label>{t("exercises")}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            sf={{ default: "list.bullet.rectangle", selected: "list.bullet.rectangle.fill" }}
            md="list_alt"
          />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="settings">
          <NativeTabs.Trigger.Label>{t("settings")}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            sf={{ default: "gearshape", selected: "gearshape.fill" }}
            md="settings"
          />
        </NativeTabs.Trigger>
      </NativeTabs>
    </>
  );
}
