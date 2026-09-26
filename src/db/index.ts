import { drizzle } from "drizzle-orm/expo-sqlite";
import { openDatabaseSync } from "expo-sqlite";
import journal from "../../drizzle/meta/_journal.json";
import * as schema from "./schema";
import { snapshotBeforeMigrations } from "./snapshot";

export const DATABASE_NAME = "lift_track.db";

export const expoDb = openDatabaseSync(DATABASE_NAME, {
  enableChangeListener: true,
});
// Each checked-off set is its own commit, so append to a write-ahead log instead of syncing
// the whole file. Copies go through VACUUM INTO, which includes the log.
expoDb.execSync(
  "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;"
);

// Taken at import, before useMigrations runs, so a bad migration can't strand history.
export const migrationSnapshot = snapshotBeforeMigrations(expoDb, journal);

export const db = drizzle(expoDb, { schema });

export * from "./schema";
