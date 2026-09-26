import { useRef, useState } from "react";
import { Alert } from "react-native";
import { SystemButton, SystemLabel, SystemPanel, SystemText as Text } from "@/components/system";
import { ErrorText } from "@/components/ui";
import { eraseLocalData, shareCsv } from "@/lib/data-files";
import { useExercises } from "@/lib/exercise-store";
import { useStore } from "@/lib/store";

export function DataPanel() {
  const { refresh } = useStore();
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
      setError(e instanceof Error ? e.message : "That didn't finish.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  const name = (id: string) => byId(id).name;
  return (
    <SystemPanel className="gap-3">
      <SystemLabel>Your data</SystemLabel>
      <SystemButton
        variant="secondary"
        isDisabled={busy}
        onPress={() => void run(() => shareCsv("sets", name))}
      >
        Export sets as CSV
      </SystemButton>
      <SystemButton
        variant="secondary"
        isDisabled={busy}
        onPress={() => void run(() => shareCsv("weight", name))}
      >
        Export body weight as CSV
      </SystemButton>
      <Text className="text-sm text-muted">
        Readable in a spreadsheet, unencrypted, and not a restore format.
      </Text>
      <SystemButton
        variant="danger-soft"
        isDisabled={busy}
        onPress={() =>
          Alert.alert(
            "Erase everything on this phone?",
            "Deletes your workouts, programs, exercises, gyms, weights, settings and recovery backups. It can't be undone; save a backup first to keep them. Files you already shared and Apple Health or Health Connect records aren't touched.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Erase",
                style: "destructive",
                onPress: () =>
                  void run(async () => {
                    await eraseLocalData();
                    refresh();
                    setMessage("Erased. Health sync is off.");
                  }),
              },
            ]
          )
        }
      >
        Erase all data
      </SystemButton>
      {!!message && <Text accessibilityLiveRegion="polite">{message}</Text>}
      <ErrorText message={error} />
    </SystemPanel>
  );
}
