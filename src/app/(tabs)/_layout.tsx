import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useThemeColor } from "heroui-native";

export default function TabsLayout() {
  const background = useThemeColor("background");
  const accent = useThemeColor("accent-soft-foreground");
  return (
    <NativeTabs
      tintColor={accent}
      backgroundColor={background}
      labelVisibilityMode="labeled"
      backBehavior="initialRoute"
    >
      <NativeTabs.Trigger name="index" contentStyle={{ backgroundColor: background }}>
        <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="dumbbell" md="fitness_center" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="plan" contentStyle={{ backgroundColor: background }}>
        <NativeTabs.Trigger.Label>Plan</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="calendar.day.timeline.left" md="view_timeline" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="history" contentStyle={{ backgroundColor: background }}>
        <NativeTabs.Trigger.Label>History</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="clock.arrow.circlepath" md="history" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="library" contentStyle={{ backgroundColor: background }}>
        <NativeTabs.Trigger.Label>Exercises</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="list.bullet.rectangle" md="list_alt" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings" contentStyle={{ backgroundColor: background }}>
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="gearshape" md="settings" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
