import { useRef, useState } from "react";
import { Alert, View } from "react-native";
import { eraseLocalData, shareCsv } from "@/lib/data-files";
import { useExercises } from "@/lib/exercise-store";
import { useStore } from "@/lib/store";
import { captureBeforeErase, onLocalDataErased } from "@/vault/engine/erase";
import { vaultSupported } from "@/vault/native";
import { Button, Callout, ErrorText, ListRow, SettingsSection } from "@/vector";

export function DataPanel() {
  const { refresh, t } = useStore();
  const { byId } = useExercises();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const locked = useRef(false);
  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("didNotFinish"));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  const name = (id: string) => byId(id).name;
  return (
    <View className="gap-3">
      {/* Held while an export runs. */}
      <SettingsSection eyebrow={t("yourData")} footnote={t("csvNote")}>
        <ListRow
          icon="share"
          title={t("exportSetsCsv")}
          trailing="none"
          disabled={busy}
          onPress={() => void run(() => shareCsv("sets", name))}
        />
        <ListRow
          icon="share"
          title={t("exportWeightCsv")}
          trailing="none"
          disabled={busy}
          onPress={() => void run(() => shareCsv("weight", name))}
        />
      </SettingsSection>
      <Button
        variant="destructive"
        icon="delete"
        disabled={busy}
        className="self-start"
        onPress={() =>
          // vector: irreversible
          Alert.alert(t("eraseQuestion"), t("eraseBody"), [
            { text: t("cancel"), style: "cancel" },
            {
              text: t("erase"),
              style: "destructive",
              onPress: () =>
                void run(async () => {
                  // Health's list of this library's installations outlives the erase, so the
                  // erased records aren't imported back from Health; backup copies go too.
                  // Without the vault's native module (Expo Go) there are none to clear.
                  const keep = vaultSupported ? await captureBeforeErase() : null;
                  await eraseLocalData();
                  if (keep) await onLocalDataErased(keep);
                  refresh();
                  setMessage(t("erasedNote"));
                }),
            },
          ])
        }
      >
        {t("eraseAllData")}
      </Button>
      {!!message && <Callout tone="success">{message}</Callout>}
      <ErrorText message={error} />
    </View>
  );
}
