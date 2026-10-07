// Pendum Lift's vault descriptor (docs/vault.md §2; spec §4.3): what a backup holds, how a restore treats device
// state and Health provenance, and the app's hooks around both. It must load in Node: modules that reach native
// code, React or the live database are imported inside the functions that use them. The v1 import adapter
// (./vault-legacy) is the exception the spec allows: it parses synchronously, and its modules are Node-loadable.
import { countWhere, jsonArray, jsonObject, notIn } from "@/vault/engine/db";
import { stripBom } from "@/vault/engine/csv";
import type {
  DescribeContext,
  RestoreContext,
  VaultApp,
  VaultIssue,
  VaultSql,
} from "@/vault/types";
import { interpolate, translate, type Message } from "@/lib/translations";

import migrations from "../drizzle/migrations";
import { liftLegacy } from "./vault-legacy";

const upsert = (key: string, value: string): VaultSql => ({
  sql: "INSERT INTO preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  params: [key, value],
});

/** "{n} workouts" / "{n} workout"; nothing for zero. */
function count(ctx: DescribeContext, one: Message, other: Message, value: unknown) {
  const n = Number(value ?? 0);
  return n > 0
    ? [
        interpolate(translate(ctx.language, ctx.plural(n) === "one" ? one : other), {
          n: ctx.number(n),
        }),
      ]
    : [];
}

/** Provenance policy on the scratch DB (spec §5.3). The merge with the live links happens in the swap (§5.4). */
function healthPolicy(ctx: RestoreContext): VaultSql[] {
  if (ctx.legacy || ctx.sameDevice) return [];
  if (ctx.crossPlatform)
    return [
      // Legacy `restored:workout:<id>` keys are not sync ids: nothing could address their sample on the other store.
      { sql: "DELETE FROM health_links WHERE origin = 'local' AND key LIKE 'restored:%'" },
      // The keys travel; the other store's ids and fingerprints mean nothing here.
      { sql: "UPDATE health_links SET remote_id = '', fingerprint = '' WHERE origin = 'local'" },
    ];
  // Another device on this platform: every linked record is upserted once under its own key.
  return [
    {
      sql: "UPDATE health_links SET fingerprint = '' WHERE origin = 'local' AND fingerprint <> 'deleted'",
    },
  ];
}

export const vaultApp: VaultApp = {
  id: "lift",
  database: {
    name: "lift_track.db",
    // foreign_keys = ON on this connection; the swap turns it off around its transaction (spec §3.7).
    acquire: async () => (await import("@/db")).expoDb,
    release: async () => {},
  },
  migrations,
  tables: [
    { name: "weight_entries", mode: "replace", role: "data" },
    { name: "custom_exercises", mode: "replace", role: "data" },
    { name: "exercise_settings", mode: "replace", role: "data" },
    { name: "gyms", mode: "replace", role: "data" },
    { name: "mesocycles", mode: "replace", role: "data" },
    { name: "meso_days", mode: "replace", role: "data" },
    { name: "meso_slots", mode: "replace", role: "data" },
    { name: "meso_skips", mode: "replace", role: "data" },
    { name: "workouts", mode: "replace", role: "data" },
    { name: "workout_exercises", mode: "replace", role: "data" },
    { name: "sets", mode: "replace", role: "data" },
    { name: "muscle_feedback", mode: "replace", role: "data" },
    { name: "ai_nudges", mode: "replace", role: "data" },
    {
      name: "preferences",
      mode: "keys",
      role: "settings",
      // Device state stays out: restTimer, restActivity, healthSyncEnabled, healthSyncError, lastSync,
      // recoveryBackupUri.
      keys: {
        keyColumn: "key",
        valueColumn: "value",
        include: [
          "units",
          "theme",
          "language",
          "activeGym",
          "travel",
          "feedbackSkipped",
          "installation",
          "healthInstallations",
        ],
        provenance: ["installation", "healthInstallations"],
      },
    },
    { name: "health_links", mode: "replace", role: "provenance" },
  ],
  summary: {
    workouts: "SELECT count(*) AS v FROM workouts WHERE ended_at IS NOT NULL",
    sets: "SELECT count(*) AS v FROM sets WHERE completed_at IS NOT NULL",
    programs: "SELECT count(*) AS v FROM mesocycles",
    weights: "SELECT count(*) AS v FROM weight_entries",
    customExercises: "SELECT count(*) AS v FROM custom_exercises",
    first: "SELECT min(started_at) AS v FROM workouts WHERE ended_at IS NOT NULL",
    latest:
      "SELECT max(m) AS v FROM (SELECT coalesce(ended_at, started_at) AS m FROM workouts UNION ALL SELECT measured_at FROM weight_entries)",
  },
  describe: (values, ctx) => [
    ...count(ctx, "workoutCountOne", "workoutCount", values.workouts),
    ...count(ctx, "setCountOne", "setCount", values.sets),
    ...count(ctx, "programCountOne", "programCount", values.programs),
    ...count(ctx, "weightCountOne", "weightCount", values.weights),
    ...count(ctx, "customExerciseCountOne", "customExerciseCount", values.customExercises),
    ...(values.first == null
      ? []
      : [interpolate(translate(ctx.language, "sinceDay"), { day: ctx.date(values.first) })]),
  ],
  // activeGym() inserts a default gym whenever Settings, the plan editors or the gym screens render, and every other
  // data table hangs off mesocycles or workouts by a cascading foreign key.
  emptySql:
    "SELECT (SELECT count(*) FROM gyms) <= 1 AND NOT EXISTS (SELECT 1 FROM weight_entries) AND NOT EXISTS (SELECT 1 FROM custom_exercises) AND NOT EXISTS (SELECT 1 FROM exercise_settings) AND NOT EXISTS (SELECT 1 FROM mesocycles) AND NOT EXISTS (SELECT 1 FROM workouts) AS v",
  csv: async (snapshot) => {
    // The builders read the live database through Drizzle; the CSVs are informational (spec §2.8). Exercise names
    // are the library's (English, as in the app) and the custom ones.
    const [{ exportSetsCsv, exportWeightCsv }, { library }] = await Promise.all([
      import("@/lib/data-ownership"),
      import("@/lib/exercises/library"),
    ]);
    const names = new Map<string, string>(library.map((e) => [e.id, e.name]));
    for (const row of snapshot.getAllSync<{ id: string; name: string }>(
      "SELECT id, name FROM custom_exercises"
    ))
      names.set(row.id, row.name);
    return [
      { name: "sets.csv", text: stripBom(exportSetsCsv((id) => names.get(id) ?? id)) },
      { name: "weight.csv", text: stripBom(exportWeightCsv()) },
    ];
  },
  validate(db) {
    const issues: VaultIssue[] = [];
    const check = (table: string, message: string, condition: string, fatal = true) => {
      if (countWhere(db, table, condition) > 0) issues.push({ table, fatal, message });
    };
    // Fatal: the app parses these without guards or switches on them.
    check("custom_exercises", "json:muscles", jsonObject("muscles"));
    for (const column of ["plates", "equipment", "excluded", "included"])
      check("gyms", `json:${column}`, jsonArray(column));
    check("gyms", "value:unit", notIn("unit", ["kg", "lb"]));
    check("mesocycles", "json:rir", jsonArray("rir"));
    check("mesocycles", "json:deprioritized", jsonArray("deprioritized"));
    check("mesocycles", "value:status", notIn("status", ["saved", "active", "finished"]));
    check("workout_exercises", "json:advice", `advice IS NOT NULL AND ${jsonObject("advice")}`);
    check("sets", "value:kind", notIn("kind", ["warmup", "working", "drop", "myo"]));
    check("sets", "value:side", `side IS NOT NULL AND ${notIn("side", ["left", "right"])}`);
    // Not fatal: the app reads the first match and keeps working.
    if (countWhere(db, "workouts", "ended_at IS NULL") > 1)
      issues.push({ table: "workouts", fatal: false, message: "count:open" });
    if (countWhere(db, "mesocycles", "status = 'active'") > 1)
      issues.push({ table: "mesocycles", fatal: false, message: "count:active" });
    return issues;
  },
  prepareScratch: (ctx) => [
    // Preferences that point at rows the archive does not have.
    {
      sql: "DELETE FROM preferences WHERE key = 'activeGym' AND CAST(value AS INTEGER) NOT IN (SELECT id FROM gyms)",
    },
    {
      sql: "DELETE FROM preferences WHERE key = 'travel' AND (json_valid(value) = 0 OR json_extract(value, '$.gymId') NOT IN (SELECT id FROM gyms))",
    },
    {
      sql: "DELETE FROM preferences WHERE key = 'feedbackSkipped' AND CAST(value AS INTEGER) NOT IN (SELECT id FROM workouts)",
    },
    ...healthPolicy(ctx),
  ],
  // v2 and v1 restores alike (spec §4.3, §5.4). A `restored:workout` link (a v1 file, or the archive of a phone that
  // once restored one) reaches its workout's sample by remote id only. When this phone rewrote that workout since (an
  // edit, or the first sync after an earlier restore), that sample is gone and the merge schedules this phone's copy
  // for removal, while the link still matches the restored row, so the sync would skip the workout and leave Health
  // without it. The same holds when this phone deleted the workout and synced the delete: its link to that very sample
  // is a tombstone, which the merge does not carry and whose key differs. Resetting the link's fingerprint makes the
  // next sync write the workout once under a real key; when that is this phone's own key, which the merge set aside,
  // the write replaces this phone's copy and takes the key back (src/lib/health.ts).
  swap: () => ({
    // The merge's snapshot of this phone's links exists only when health_links is replaced (spec §4.1).
    before: [
      {
        sql: 'CREATE TEMP TABLE IF NOT EXISTS _vault_live_links ("key", "local_kind", "local_id", "remote_id", "fingerprint", "origin", "row_exists")',
      },
    ],
    after: [
      {
        sql: "UPDATE main.health_links AS h SET fingerprint = '' WHERE h.origin = 'local' AND h.key LIKE 'restored:%' AND h.fingerprint <> 'deleted' AND EXISTS (SELECT 1 FROM temp._vault_live_links l WHERE l.origin = 'local' AND l.local_kind = h.local_kind AND l.local_id = h.local_id AND (l.remote_id <> h.remote_id OR l.fingerprint = 'deleted'))",
      },
    ],
  }),
  deviceOverrides: () => [
    upsert("healthSyncEnabled", "false"),
    upsert("healthSyncError", ""),
    upsert("lastSync", ""),
    // The v1 pre-restore copy is superseded by this restore's recovery set (spec §3.9).
    { sql: "DELETE FROM preferences WHERE key = 'recoveryBackupUri'" },
  ],
  healthEnabledSql: "SELECT value = 'true' AS v FROM preferences WHERE key = 'healthSyncEnabled'",
  health: {
    clientPrefix: "lift-track",
    rowTables: { weight: "weight_entries", workout: "workouts" },
  },
  legacy: liftLegacy,
  hooks: {
    // Waits for a running sync to finish, then holds syncs off until the restore is done (spec §5.8 item 1).
    pauseWhenIdle: async (work, ms) => (await import("@/lib/health")).pauseWhenIdle(work, ms),
    afterRestore: async () => {
      (await import("@/lib/rest-timer")).stopRest();
      // Health sync is off after every restore: this unregisters the daily background sync.
      await (await import("@/lib/health-schedule")).configureHealthSchedule();
    },
  },
  backgroundIntervalMinutes: 1440,
  syncIdTables: [
    "weight_entries",
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
  ],
  excludedTables: [],
};
