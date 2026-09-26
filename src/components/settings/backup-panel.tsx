import { useRef, useState } from "react";
import { Alert, View } from "react-native";
import { SystemButton, SystemLabel, SystemPanel, SystemText as Text } from "@/components/system";
import { Choices, ErrorText, Field } from "@/components/ui";
import { backupSummary, type Backup } from "@/lib/backup-data";
import {
  exportBackup,
  importBackup,
  recoveryBackupUri,
  restoreWithRecovery,
  shareBackupFile,
} from "@/lib/backup-files";
import { changed, useQuery } from "@/lib/data";
import { useStore } from "@/lib/store";

type Mode = "Create backup" | "Restore backup";

export function BackupPanel() {
  const { refresh, date } = useStore();
  const [mode, setMode] = useState<Mode>("Create backup");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [preview, setPreview] = useState<Backup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const recovery = useQuery(recoveryBackupUri);
  const locked = useRef(false);

  async function run(work: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The backup didn't finish.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  const summary = preview ? backupSummary(preview) : null;
  return (
    <SystemPanel className="gap-4">
      <SystemLabel>Backup & restore</SystemLabel>
      <Text className="text-sm text-muted">
        An encrypted file you save wherever you like. There&apos;s no cloud copy and no password
        recovery.
      </Text>
      {!busy && !preview && (
        <Choices
          values={["Create backup", "Restore backup"] as const}
          value={mode}
          label={(value) => value}
          onChange={(value) => {
            setMode(value);
            setError("");
            setMessage("");
            setPassword("");
            setConfirmation("");
          }}
        />
      )}
      {!preview && (
        <>
          <Field
            label="Backup password"
            value={password}
            onChange={setPassword}
            secure
            disabled={busy}
          />
          {mode === "Create backup" && (
            <Field
              label="Confirm password"
              value={confirmation}
              onChange={setConfirmation}
              secure
              disabled={busy}
            />
          )}
          <Text className="text-sm text-muted">
            At least 10 characters. It can&apos;t be recovered.
          </Text>
          <SystemButton
            isDisabled={busy}
            onPress={() =>
              void run(async () => {
                if (password.length < 10 || password.length > 256)
                  throw new Error("Use a password between 10 and 256 characters.");
                if (mode === "Create backup") {
                  if (password !== confirmation) throw new Error("The passwords don't match.");
                  await exportBackup(password);
                  setPassword("");
                  setConfirmation("");
                  setMessage(
                    "The backup is saved only if you picked a place for it in the share sheet."
                  );
                } else setPreview(await importBackup(password));
              })
            }
          >
            {busy
              ? "Working…"
              : mode === "Create backup"
                ? "Save encrypted backup"
                : "Choose backup file"}
          </SystemButton>
        </>
      )}
      {preview && summary && (
        <View className="gap-3">
          <Text className="font-semibold">Backup from {date(preview.createdAt)}</Text>
          <Text>
            {summary.workouts} workouts · {summary.sets} sets · {summary.programs} programs
          </Text>
          <Text>
            {summary.weights} weights · {summary.customExercises} custom exercises
            {summary.first ? ` · since ${date(summary.first)}` : ""}
          </Text>
          <Text className="text-sm text-muted">
            Replaces your workouts, programs, exercises, gyms and weights, and turns Health sync
            off. A recovery copy of what you have now is saved first.
          </Text>
          <SystemButton
            variant="danger-soft"
            isDisabled={busy}
            onPress={() =>
              Alert.alert(
                "Replace everything here?",
                "Your current workouts, programs and weights are replaced by this backup. A recovery copy is saved first.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Restore",
                    style: "destructive",
                    onPress: () =>
                      void run(async () => {
                        await restoreWithRecovery(preview, password);
                        refresh();
                        changed();
                        setPreview(null);
                        setPassword("");
                        setMessage(
                          "Restored. What you had before is in the recovery backup below, with the same password."
                        );
                      }),
                  },
                ]
              )
            }
          >
            {busy ? "Restoring…" : "Replace with this backup"}
          </SystemButton>
          <SystemButton
            variant="ghost"
            isDisabled={busy}
            onPress={() => {
              setPreview(null);
              setPassword("");
            }}
          >
            Cancel
          </SystemButton>
        </View>
      )}
      {recovery && !preview && (
        <SystemButton
          variant="secondary"
          isDisabled={busy}
          onPress={() => void run(() => shareBackupFile(recovery))}
        >
          Export the recovery backup
        </SystemButton>
      )}
      {!!message && (
        <Text className="text-sm text-success" accessibilityLiveRegion="polite">
          {message}
        </Text>
      )}
      <ErrorText message={error} />
    </SystemPanel>
  );
}
