import { Directory, File, Paths } from "expo-file-system";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import { getRandomBytesAsync } from "expo-crypto";
import { eq } from "drizzle-orm";
import { db, preferences } from "@/db";
import {
  createBackup,
  parseBackup,
  restoreBackup,
  validateBackup,
  type Backup,
} from "./backup-data";
import { decryptBackupText, encryptBackupText, MAX_ENCRYPTED_SIZE } from "./backup-crypto";
import { withHealthPaused } from "./health";
import { configureHealthSchedule } from "./health-schedule";
import { stopRest } from "./rest-timer";

const recoveryKey = "recoveryBackupUri";
export const backupFolder = () => new Directory(Paths.document, "LiftTrackBackups");

export function recoveryBackupUri() {
  return db.select().from(preferences).where(eq(preferences.key, recoveryKey)).get()?.value || null;
}

export async function shareBackupFile(uri: string) {
  if (!(await Sharing.isAvailableAsync()))
    throw new Error("File sharing is unavailable on this device.");
  await Sharing.shareAsync(uri, {
    mimeType: "application/json",
    UTI: "public.json",
    dialogTitle: "Save encrypted Pendum Lift backup",
  });
}

export async function exportBackup(password: string) {
  const encrypted = await encryptBackupText(
    JSON.stringify(createBackup()),
    password,
    getRandomBytesAsync
  );
  const file = new File(Paths.cache, `lift-track-${Date.now()}.backup.json`);
  file.write(encrypted);
  // A receiving app may still be reading after the Android chooser closes, so the encrypted file
  // stays in OS-managed cache rather than being deleted early.
  await shareBackupFile(file.uri);
}

export async function importBackup(password: string): Promise<Backup | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["application/json", "application/octet-stream"],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const file = new File(result.assets[0].uri);
  try {
    if (file.size > MAX_ENCRYPTED_SIZE) throw new Error("This backup is too large.");
    return parseBackup(await decryptBackupText(await file.text(), password));
  } finally {
    if (file.uri.startsWith(`${Paths.cache.uri.replace(/\/$/, "")}/`) && file.exists) file.delete();
  }
}

/**
 * Saves an encrypted copy of the current records, reads it back and authenticates it, and only
 * then replaces everything with the backup. The copy uses the backup's password.
 */
export async function restoreWithRecovery(backup: Backup, password: string) {
  const validated = validateBackup(backup);
  await withHealthPaused(async () => {
    const encrypted = await encryptBackupText(
      JSON.stringify(createBackup()),
      password,
      getRandomBytesAsync
    );
    const folder = backupFolder();
    folder.create({ idempotent: true, intermediates: true });
    const recovery = new File(folder, `before-restore-${Date.now()}.backup.json`);
    recovery.write(encrypted);
    try {
      parseBackup(await decryptBackupText(await recovery.text(), password));
      restoreBackup(validated, recovery.uri);
    } catch (error) {
      if (recovery.exists) recovery.delete();
      throw error;
    }
    stopRest();
    // The stored opt-out is what counts even if background unregistration fails.
    await configureHealthSchedule().catch(() => {});
  });
}
