import { useState } from "react";
import { Switch } from "heroui-native";
import { Platform, Pressable, View } from "react-native";
import { router } from "expo-router";
import { SystemIcon, SystemLabel, SystemPanel, SystemText as Text } from "@/components/system";
import { SettingsSelect, ErrorText, Screen } from "@/components/ui";
import { GymEditor } from "@/components/settings/gym-editor";
import { BackupPanel } from "@/components/settings/backup-panel";
import { DataPanel } from "@/components/settings/data-panel";
import { useStore } from "@/lib/store";
import { languages, type LanguagePreference } from "@/lib/translations";
import { enableHealthSync, disableHealthSync } from "@/lib/health-schedule";
import { useQuery, write } from "@/lib/data";
import { activeGym, updateGym } from "@/lib/workouts";
import { defaultGym } from "@/lib/loads";

function Row({ label, value, onPress }: { label: string; value?: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="min-h-11 flex-row items-center justify-between gap-3 active:opacity-60"
    >
      <Text>{label}</Text>
      <View className="flex-row items-center gap-1">
        {value && <Text className="text-muted">{value}</Text>}
        <SystemIcon name="chevron-forward" size={18} color="muted" />
      </View>
    </Pressable>
  );
}

export function SettingsScreen() {
  const {
    units,
    languagePreference,
    theme,
    healthSyncEnabled,
    healthSyncError,
    lastSync,
    setPreference,
    refresh,
    t,
    date,
  } = useStore();
  const gym = useQuery(() => activeGym(units), [units]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editingGym, setEditingGym] = useState(false);
  function preference(key: string, value: string) {
    try {
      setPreference(key, value);
      setError("");
    } catch {
      setError("error");
    }
  }
  async function toggleSync(enabled: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (enabled) {
        await enableHealthSync();
        setMessage("syncDone");
      } else {
        await disableHealthSync();
      }
    } catch (error) {
      setError(
        error instanceof Error && ["healthUnavailable", "syncing"].includes(error.message)
          ? error.message
          : "syncFailed"
      );
    } finally {
      refresh();
      setBusy(false);
    }
  }
  return (
    <Screen title={t("settings")}>
      <SystemPanel className="gap-3">
        <SystemLabel>Training</SystemLabel>
        <Row
          label="Gym & plates"
          value={`${gym.barWeight} ${gym.unit} bar`}
          onPress={() => setEditingGym(true)}
        />
        <Row label={t("weight")} onPress={() => router.push("/weight")} />
      </SystemPanel>
      <SystemPanel className="gap-3">
        <SystemLabel>{t("units")}</SystemLabel>
        <SettingsSelect
          title={t("units")}
          values={["metric", "imperial"] as const}
          value={units}
          onChange={(value) => {
            preference("units", value);
            // Plates don't convert between kg and lb; a gym follows the unit you train in.
            const unit = value === "metric" ? "kg" : "lb";
            if (gym.unit !== unit) {
              const { name: _name, equipment: _equipment, ...typical } = defaultGym(unit);
              write(() => updateGym(gym.id, typical));
            }
          }}
          label={(value) => `${t(value)} · ${value === "metric" ? "kg" : "lb"}`}
        />
      </SystemPanel>
      <SystemPanel className="gap-3">
        <SystemLabel>{t("theme")}</SystemLabel>
        <SettingsSelect
          title={t("theme")}
          values={["dark", "light", "system"] as const}
          value={theme}
          onChange={(value) => preference("theme", value)}
          label={t}
        />
      </SystemPanel>
      <SystemPanel className="gap-3">
        <SystemLabel>{t("language")}</SystemLabel>
        <SettingsSelect
          title={t("language")}
          values={["system", ...Object.keys(languages)] as LanguagePreference[]}
          value={languagePreference}
          onChange={(value) => preference("language", value)}
          label={(value) => (value === "system" ? t("system") : languages[value])}
        />
      </SystemPanel>
      <SystemPanel className="gap-3">
        <SystemLabel>{Platform.OS === "ios" ? "Apple Health" : "Health Connect"}</SystemLabel>
        <Text className="text-muted">{t("healthPrivacy")}</Text>
        {lastSync && (
          <Text className="text-sm text-muted">
            {t("lastSync")}: {date(lastSync)}
          </Text>
        )}
        <View className="flex-row items-center justify-between gap-4">
          <Text className="flex-1">{t(busy ? "syncing" : "sync")}</Text>
          <Switch
            accessibilityLabel={t("sync")}
            isSelected={healthSyncEnabled}
            isDisabled={busy}
            onSelectedChange={toggleSync}
          />
        </View>
        <Text className="text-sm text-muted">{t("syncSchedule")}</Text>
        {message && (
          <Text
            accessibilityLiveRegion="polite"
            className="border-l-2 border-success pl-3 text-success"
          >
            {t(message)}
          </Text>
        )}
      </SystemPanel>
      <ErrorText message={error || healthSyncError ? t(error || healthSyncError) : ""} />
      <BackupPanel />
      <DataPanel />
      <Text className="text-center text-sm text-muted">
        Vector Lift keeps everything on this phone. No account, no servers.
      </Text>
      <GymEditor open={editingGym} close={() => setEditingGym(false)} gym={gym} />
    </Screen>
  );
}
