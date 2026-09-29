import { useRef, useState } from "react";
import { Alert, View } from "react-native";
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
import { useCount } from "@/lib/use-count";
import {
  Button,
  Callout,
  Choices,
  ErrorText,
  Field,
  Heading,
  Label,
  Meta,
  Note,
  Panel,
} from "@/vector";

type Mode = "create" | "restore";

export function BackupPanel() {
  const { refresh, date, t } = useStore();
  const count = useCount();
  const [mode, setMode] = useState<Mode>("create");
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
      setError(e instanceof Error ? e.message : t("backupFailed"));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  const summary = preview ? backupSummary(preview) : null;
  return (
    <View className="gap-2">
      <Label accessibilityRole="header">{t("backupAndRestore")}</Label>
      <Panel>
        <Note>{t("backupIntro")}</Note>
        {!busy && !preview && (
          <Choices
            values={["create", "restore"] as const}
            value={mode}
            label={(value) => t(value === "create" ? "createBackup" : "restoreBackup")}
            accessibilityLabel={t("backupAndRestore")}
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
              label={t("backupPassword")}
              value={password}
              onChange={setPassword}
              secure
              disabled={busy}
            />
            {mode === "create" && (
              <Field
                label={t("confirmPassword")}
                value={confirmation}
                onChange={setConfirmation}
                secure
                disabled={busy}
              />
            )}
            <Note>{t("backupPasswordHint")}</Note>
            <Button
              loading={busy}
              loadingLabel={t("working")}
              onPress={() =>
                void run(async () => {
                  if (password.length < 10 || password.length > 256)
                    throw new Error(t("backupPasswordLength"));
                  if (mode === "create") {
                    if (password !== confirmation) throw new Error(t("backupPasswordsDiffer"));
                    await exportBackup(password);
                    setPassword("");
                    setConfirmation("");
                    setMessage(t("backupSavedNote"));
                  } else setPreview(await importBackup(password));
                })
              }
            >
              {t(mode === "create" ? "saveEncryptedBackup" : "chooseBackupFile")}
            </Button>
          </>
        )}
        {preview && summary && (
          <View className="gap-3">
            <Heading level={4}>{t("backupFrom", { date: date(preview.createdAt) })}</Heading>
            <Meta
              tone="default"
              items={[
                count(summary.workouts, "workoutCountOne", "workoutCount"),
                count(summary.sets, "setCountOne", "setCount"),
                count(summary.programs, "programCountOne", "programCount"),
                count(summary.weights, "weightCountOne", "weightCount"),
                count(summary.customExercises, "customExerciseCountOne", "customExerciseCount"),
                summary.first ? t("sinceDay", { day: date(summary.first) }) : "",
              ]}
            />
            <Note>{t("restoreReplacesNote")}</Note>
            <Button
              variant="destructive"
              loading={busy}
              loadingLabel={t("restoring")}
              onPress={() =>
                // vector: irreversible
                Alert.alert(t("replaceEverythingQuestion"), t("replaceEverythingBody"), [
                  { text: t("cancel"), style: "cancel" },
                  {
                    text: t("restore"),
                    style: "destructive",
                    onPress: () =>
                      void run(async () => {
                        await restoreWithRecovery(preview, password);
                        refresh();
                        changed();
                        setPreview(null);
                        setPassword("");
                        setMessage(t("restoredNote"));
                      }),
                  },
                ])
              }
            >
              {t("replaceWithBackup")}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onPress={() => {
                setPreview(null);
                setPassword("");
              }}
            >
              {t("cancel")}
            </Button>
          </View>
        )}
        {recovery && !preview && (
          <Button
            variant="secondary"
            disabled={busy}
            onPress={() => void run(() => shareBackupFile(recovery))}
          >
            {t("exportRecoveryBackup")}
          </Button>
        )}
        {!!message && <Callout tone="success">{message}</Callout>}
        <ErrorText message={error} />
      </Panel>
    </View>
  );
}
