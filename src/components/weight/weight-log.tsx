import { Stack } from "expo-router";
import { useThemeColor } from "heroui-native";
import { SystemButton } from "@/components/system";
import { Screen } from "@/components/ui";
import { useStore } from "@/lib/store";
import { useWeightLog } from "./use-weight-log";
import { WeightChart } from "@/components/progress/weight-chart";
import { WeightForm } from "./weight-form";
import { MeasurementHistory } from "./measurement-history";

export function WeightLog() {
  const { t } = useStore();
  const background = useThemeColor("background");
  const foreground = useThemeColor("foreground");
  const log = useWeightLog();
  return (
    <>
      <Screen title={t("weight")} nativeHeader>
        <Stack.Screen
          options={{
            headerShown: true,
            title: t("weight"),
            headerBackButtonDisplayMode: "minimal",
            headerStyle: { backgroundColor: background },
            headerTintColor: foreground,
            contentStyle: { backgroundColor: background },
          }}
        />
        <WeightChart />
        <SystemButton onPress={() => log.launch(null)}>
          {t("add")} · {t("weight")}
        </SystemButton>
        <MeasurementHistory log={log} />
      </Screen>
      <WeightForm log={log} />
    </>
  );
}
