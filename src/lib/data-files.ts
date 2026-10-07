import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import journal from "../../drizzle/meta/_journal.json";
import { expoDb, migrationSnapshot } from "@/db";
import { migrationState, snapshotDatabase } from "@/db/snapshot";
import { backupFolder } from "./backup-files";
import { changed } from "./data";
import { erasePersonalRecords, exportSetsCsv, exportWeightCsv } from "./data-ownership";
import { withHealthPaused } from "./health";
import { configureHealthSchedule } from "./health-schedule";
import { stopRest } from "./rest-timer";

async function share(file: File, mimeType: string, UTI: string, dialogTitle: string) {
  if (!(await Sharing.isAvailableAsync()))
    throw new Error("File sharing is unavailable on this device.");
  await Sharing.shareAsync(file.uri, { mimeType, UTI, dialogTitle });
}

export async function shareCsv(kind: "sets" | "weight", exerciseName: (id: string) => string) {
  const file = new File(Paths.cache, `lift-track-${kind}-${Date.now()}.csv`);
  file.write(kind === "sets" ? exportSetsCsv(exerciseName) : exportWeightCsv());
  await share(file, "text/csv", "public.comma-separated-values-text", "Export Pendum Lift data");
}

export async function shareDatabaseCopy() {
  // A failed migration rolls back, so a fresh copy is as good as the startup one.
  const file = migrationSnapshot?.exists
    ? migrationSnapshot
    : snapshotDatabase(expoDb, migrationState(expoDb, journal)?.applied ?? 0);
  await share(file, "application/vnd.sqlite3", "public.database", "Save Pendum Lift database copy");
}

export async function eraseLocalData() {
  await withHealthPaused(async () => {
    stopRest();
    // App-held recovery backups and pre-migration copies live here.
    const folder = backupFolder();
    if (folder.exists) folder.delete();
    for (const file of Paths.cache.list())
      if (file instanceof File && /^lift-track-.*\.(csv|backup\.json)$/.test(file.name))
        file.delete();
    erasePersonalRecords();
    changed();
    await configureHealthSchedule().catch(() => {});
  });
}
