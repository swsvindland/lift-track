import { router } from "expo-router";
import { Button, Note, Screen, Text } from "@/vector";
import { useStore } from "@/lib/store";
export function HealthPrivacyScreen() {
  const { t } = useStore();
  return (
    <Screen title={t("sync")} width="form">
      <Text>{t("healthPrivacy")}</Text>
      <Note>{t("syncHelp")}</Note>
      <Button onPress={() => router.replace("/(tabs)/settings")}>{t("settings")}</Button>
    </Screen>
  );
}
