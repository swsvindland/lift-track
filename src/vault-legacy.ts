// Pendum Lift's v1 backups through the vault (docs/vault.md §4.9; spec §2.11, §3.9). The JSON files the old Backup
// panel wrote (`lift-track-backup`, or `lift-track-encrypted-backup` behind a password) still restore: the app's own
// decrypt and parse read them, and writeBackupRows() writes their records into the vault's scratch database, as
// restoreBackup() wrote them into the live one. The vault runs the rest of the restore (sync ids, repairs, validators,
// recovery set, Health link merge, swap). Node-loadable: backup-crypto and backup-data are pure, and backup-files (which
// reaches Health, the rest timer and the document picker) is not imported.
import { drizzle } from "drizzle-orm/expo-sqlite";
import { Directory, File, Paths } from "expo-file-system";
import type { SQLiteDatabase } from "expo-sqlite";

import * as schema from "@/db/schema";
import { decryptBackupText, MAX_ENCRYPTED_SIZE } from "@/lib/backup-crypto";
import { backupSummary, parseBackup, writeBackupRows, type Backup } from "@/lib/backup-data";
import type { SqlReader, VaultLegacy, VaultSql } from "@/vault/types";

const upsert = (key: string, value: string): VaultSql => ({
  sql: "INSERT INTO preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  params: [key, value],
});

/** A file name the v1 code wrote (`before-restore-<ms>.backup.json`): no folders, nothing hidden. */
const BACKUP_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * The v1 pre-restore copy `recoveryBackupUri` names, looked up by file name in `dir`: the URI is absolute, and the
 * container path in it can change across reinstalls. `db` is the vault's live connection.
 */
function resolveRecoveryCopy(
  db: SqlReader,
  dir: Directory
): { file: File; createdAt: string } | null {
  const uri =
    db.getFirstSync<{ value: string }>(
      "SELECT value FROM preferences WHERE key = 'recoveryBackupUri'"
    )?.value ?? "";
  let name: string;
  try {
    name = decodeURIComponent(uri.slice(uri.lastIndexOf("/") + 1));
  } catch {
    return null; // a malformed URI names no file
  }
  if (!BACKUP_NAME.test(name)) return null;
  const file = new File(dir, name);
  if (!file.exists) return null;
  return { file, createdAt: new Date(file.lastModified ?? Date.now()).toISOString() };
}

export const liftLegacy: VaultLegacy<Backup> = {
  formats: { plain: "lift-track-backup", encrypted: "lift-track-encrypted-backup" },
  maxBytes: MAX_ENCRYPTED_SIZE,
  decrypt: decryptBackupText,
  parse: parseBackup,
  createdAt: (backup) => backup.createdAt,
  // { workouts, sets, programs, weights, customExercises, first }: the keys of the descriptor's summary.
  counts: (backup) => backupSummary(backup),
  // The training records and every Health link, as the v1 restore replaced them; `preferences` for `activeGym` only.
  tables: [
    "weight_entries",
    "custom_exercises",
    "exercise_settings",
    "gyms",
    "mesocycles",
    "meso_days",
    "meso_slots",
    "meso_skips",
    "workouts",
    "workout_exercises",
    "sets",
    "muscle_feedback",
    "ai_nudges",
    "health_links",
    "preferences",
  ].map((name) => ({ name })),
  preferenceKeys: ["activeGym"],
  write(scratch: SQLiteDatabase, backup: Backup) {
    // No `activeGym` row when the file has none: the swap then deletes this device's, as the v1 restore did.
    drizzle(scratch, { schema }).transaction((tx) => writeBackupRows(tx, backup.data));
  },
  // The vault keeps the live `installation` and adds "*" to `healthInstallations` (§5.2); `recoveryBackupUri` stays
  // until a v2 restore supersedes the copy it names (§3.9).
  overrides: () => [
    upsert("healthSyncEnabled", "false"),
    upsert("healthSyncError", ""),
    upsert("lastSync", ""),
    // The rest timer belongs to a workout of the replaced library; a trip names a gym by id.
    { sql: "DELETE FROM preferences WHERE key IN ('restTimer', 'travel')" },
  ],
  recoveryCopy(db) {
    // The folder of backupFolder() in src/lib/backup-files.ts (not imported, see above).
    return resolveRecoveryCopy(db, new Directory(Paths.document, "LiftTrackBackups"));
  },
};
