import { useState, type ReactNode } from "react";
import { Platform, View } from "react-native";
import { router } from "expo-router";
import { DataPanel } from "@/components/settings/data-panel";
import { massUnit } from "@/lib/format";
import { useStore } from "@/lib/store";
import { isMessage, languages, type LanguagePreference, type Message } from "@/lib/translations";
import { enableHealthSync, disableHealthSync } from "@/lib/health-schedule";
import { useQuery, write } from "@/lib/data";
import { activeGym, listGyms, travelPlan, updateGym } from "@/lib/workouts";
import { convertGym } from "@/lib/loads";
import { VaultSection } from "@/vault";
import {
  Callout,
  Choices,
  ErrorText,
  Label,
  ListRow,
  Note,
  Panel,
  Screen,
  Select,
  SettingsSection,
  Text,
  useKitFormat,
} from "@/vector";

/**
 * The SettingsSection anatomy (eyebrow, content, footnote) for groups a row panel does not fit: a control that
 * draws its own edge (Choices, Select), or notes that must be read before a row.
 */
function Section({
  eyebrow,
  footnote,
  children,
}: {
  eyebrow: string;
  footnote?: string;
  children: ReactNode;
}) {
  return (
    <View className="gap-2">
      <Label accessibilityRole="header">{eyebrow}</Label>
      {children}
      {footnote ? (
        <Text variant="caption" tone="muted">
          {footnote}
        </Text>
      ) : null}
    </View>
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
  const format = useKitFormat();
  const gyms = useQuery(() => ({ main: activeGym(units), trip: travelPlan() }), [units]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Message | "">("");
  const [message, setMessage] = useState<Message | "">("");
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
      const reason = error instanceof Error ? error.message : "";
      setError(reason === "healthUnavailable" || reason === "syncing" ? reason : "syncFailed");
    } finally {
      refresh();
      setBusy(false);
    }
  }
  // The last background sync's failure is stored as a message key.
  const syncError = error || (isMessage(healthSyncError) ? healthSyncError : "");
  return (
    <Screen title={t("settings")} width="form">
      <SettingsSection eyebrow={t("training")}>
        <ListRow
          title={t("gyms")}
          value={gyms.trip ? t("travelingAtGym", { gym: gyms.trip.gym.name }) : gyms.main.name}
          onPress={() => router.push("/gyms")}
        />
        <ListRow title={t("weight")} onPress={() => router.push("/weight")} />
      </SettingsSection>
      <Section eyebrow={t("units")}>
        <Choices
          values={["metric", "imperial"] as const}
          value={units}
          onChange={(value) => {
            preference("units", value);
            // Plates don't convert between kg and lb; gyms follow the unit you train in.
            const unit = value === "metric" ? "kg" : "lb";
            write(() => {
              for (const gym of listGyms(value))
                if (gym.unit !== unit) updateGym(gym.id, convertGym(gym, unit));
            });
          }}
          // The same unit symbols the readouts use (公斤 in zh).
          label={(value) =>
            t("unitsWithSymbol", {
              name: t(value),
              unit: format.unitParts(2, massUnit(value)).unit,
            })
          }
          accessibilityLabel={t("units")}
        />
      </Section>
      <Section eyebrow={t("appearance")}>
        <Choices
          values={["system", "light", "dark"] as const}
          value={theme}
          onChange={(value) => preference("theme", value)}
          label={t}
          accessibilityLabel={t("appearance")}
        />
      </Section>
      <Section eyebrow={t("language")}>
        <Select
          title={t("language")}
          values={["system", ...Object.keys(languages)] as LanguagePreference[]}
          value={languagePreference}
          onChange={(value) => preference("language", value)}
          label={(value) => (value === "system" ? t("system") : languages[value])}
        />
      </Section>
      <View className="gap-3">
        {/* What syncs is read before the switch that starts it. */}
        <Section
          eyebrow={t(Platform.OS === "ios" ? "appleHealth" : "healthConnect")}
          footnote={t("syncSchedule")}
        >
          <Text tone="muted">{t("healthPrivacy")}</Text>
          {/* Held while a sync or permission request runs. */}
          <Panel inset="none">
            <ListRow
              title={t(busy ? "syncing" : "sync")}
              description={lastSync ? t("lastSyncAt", { date: date(lastSync) }) : undefined}
              trailing="toggle"
              toggleValue={healthSyncEnabled}
              onToggle={(enabled) => void toggleSync(enabled)}
              disabled={busy}
            />
          </Panel>
        </Section>
        {message ? <Callout tone="success">{t(message)}</Callout> : null}
        <ErrorText message={syncError ? t(syncError) : ""} />
      </View>
      <VaultSection />
      <DataPanel />
      <Note className="text-center">{t("localOnlyNote")}</Note>
    </Screen>
  );
}
