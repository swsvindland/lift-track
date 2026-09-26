const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const ts = require("typescript");
const { drizzle } = require(
  require("node:path").join(
    require("node:path").dirname(require.resolve("drizzle-orm/expo-sqlite")),
    "driver.cjs"
  )
);
const { eq } = require("drizzle-orm");

// Execute production TypeScript under Node while substituting only native boundaries.
function load(file, dependencies = {}) {
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const sourceRequire = require("node:module").createRequire(require("node:path").resolve(file));
  new Function("require", "module", "exports", output)(
    (name) => (name in dependencies ? dependencies[name] : sourceRequire(name)),
    module,
    module.exports
  );
  return module.exports;
}
const metrics = load("src/lib/metrics.ts");
const schema = load("src/db/schema.ts");
const { dictionaries, languagePreference, resolveLanguage } = load("src/lib/translations.ts");
const close = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} ≠ ${b}`);

test("units round-trip and reject partial numeric input", () => {
  for (const unit of ["metric", "imperial"])
    close(metrics.toKg(metrics.fromKg(82.375, unit), unit), 82.375);
  close(metrics.toKg(225, "imperial"), 102.05828325);
  assert.equal(metrics.parseNumber("75,25"), 75.25);
  for (const input of ["75kg", "1.2.3", "", "Infinity", "1e2", "-5", "1,234.5"])
    assert.ok(Number.isNaN(metrics.parseNumber(input)));
});
test("calendar validation and local dates avoid UTC shifts", () => {
  assert.equal(metrics.validDay("2024-02-29"), true);
  for (const day of ["2025-02-29", "2024-04-31", "2024-13-01", "2999-01-01", "2024-2-2"])
    assert.equal(metrics.validDay(day), false);
  assert.equal(metrics.localDay(new Date(2024, 0, 1, 23, 30)), "2024-01-01");
});
test("trend averages same-day records, sorts history and handles gaps", () => {
  const trend = metrics.weightTrend([
    { measuredAt: "2024-01-08", weightKg: 90 },
    { measuredAt: "2024-01-01", weightKg: 78 },
    { measuredAt: "2024-01-01", weightKg: 82 },
    { measuredAt: "2024-01-09", weightKg: NaN },
  ]);
  assert.equal(trend.length, 2);
  assert.equal(trend[0].raw, 80);
  close(trend[1].trend, 85);
  const steady = metrics.weightTrend([
    { measuredAt: "2024-01-01", weightKg: 80 },
    { measuredAt: "2024-01-02", weightKg: 80 },
  ]);
  close(steady[1].trend, 80);
  assert.deepEqual(metrics.weightTrend([]), []);
});
test("all 11 languages contain every interface string", () => {
  assert.equal(Object.keys(dictionaries).length, 11);
  for (const [locale, dictionary] of Object.entries(dictionaries)) {
    assert.deepEqual(Object.keys(dictionary), Object.keys(dictionaries.en));
    for (const [key, value] of Object.entries(dictionary))
      assert.ok(typeof value === "string" && value.length, `${locale}.${key}`);
  }
});
test("language follows the device by default and allows a persistent override", () => {
  assert.equal(languagePreference(undefined), "system");
  assert.equal(languagePreference("system"), "system");
  assert.equal(resolveLanguage(languagePreference(undefined), "es"), "es");
  assert.equal(resolveLanguage(languagePreference("system"), "fr"), "fr");
  assert.equal(resolveLanguage(languagePreference("en"), "es"), "en");
  for (const language of Object.keys(dictionaries)) {
    assert.equal(languagePreference(language), language);
    assert.equal(resolveLanguage(languagePreference(language), "es"), language);
  }
  for (const unsupported of [null, undefined, "ar", "toString"]) {
    assert.equal(resolveLanguage("system", unsupported), "en");
  }
  assert.equal(languagePreference("toString"), "system");
});
function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const migration of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sqlite.exec(readFileSync(`drizzle/${migration}`, "utf8"));
  // Same Drizzle Expo driver as production, backed by real SQLite instead of a phone.
  const client = {
    prepareSync(sql) {
      return {
        executeSync(params) {
          const stmt = sqlite.prepare(sql);
          if (!stmt.columns().length) {
            const result = stmt.run(...params);
            return { changes: result.changes, lastInsertRowId: result.lastInsertRowid };
          }
          const rows = stmt.all(...params);
          return { getAllSync: () => rows, getFirstSync: () => rows[0] };
        },
        executeForRawResultSync(params) {
          const stmt = sqlite.prepare(sql);
          stmt.setReturnArrays(true);
          const rows = stmt.all(...params);
          return { getAllSync: () => rows };
        },
      };
    },
  };
  return { sqlite, db: drizzle(client, { schema }) };
}
test("health sync is repeatable, updates exports and never resurrects deleted imports", async () => {
  const { db, sqlite } = database();
  const health = load("src/lib/health.ts", {
    "expo-constants": { appOwnership: "standalone" },
    "@/db": { db, ...schema },
    "./health-native": {},
    "./metrics": metrics,
  });
  const local = db
    .insert(schema.weightEntries)
    .values({ weightKg: 80, measuredAt: "2024-01-01T12:00:00Z" })
    .returning()
    .get();
  const records = new Map([
    ["external", { id: "external", kind: "weight", value: 79, measuredAt: "2024-01-02T12:00:00Z" }],
  ]);
  let writes = 0;
  const adapter = {
    authorize: async () => {},
    read: async () => [...records.values()],
    write: async (record) => {
      writes++;
      const id = record.clientId;
      records.set(id, { ...record, id });
      return id;
    },
    remove: async (_, id) => {
      records.delete(id);
    },
  };
  assert.deepEqual(await health.syncHealth(adapter), { imported: 1, exported: 1 });
  assert.deepEqual(await health.syncHealth(adapter), { imported: 0, exported: 0 });
  assert.equal(db.select().from(schema.weightEntries).all().length, 2);
  db.update(schema.weightEntries)
    .set({ weightKg: 81 })
    .where(eq(schema.weightEntries.id, local.id))
    .run();
  await health.syncHealth(adapter);
  assert.equal(writes, 2);
  assert.equal(records.size, 2);
  // A deleted import stays deleted even when its source changes.
  const imported = db
    .select()
    .from(schema.weightEntries)
    .all()
    .find((w) => w.weightKg === 79);
  db.delete(schema.weightEntries).where(eq(schema.weightEntries.id, imported.id)).run();
  records.set("external", { ...records.get("external"), value: 78 });
  await health.syncHealth(adapter);
  assert.equal(db.select().from(schema.weightEntries).all().length, 1);
  db.delete(schema.weightEntries).run();
  await health.syncHealth(adapter);
  assert.equal(records.size, 1);
  sqlite.close();
});
test("failed sync retries safely and doesn't claim success", async () => {
  const { db, sqlite } = database();
  const health = load("src/lib/health.ts", {
    "expo-constants": {},
    "@/db": { db, ...schema },
    "./health-native": {},
    "./metrics": metrics,
  });
  db.insert(schema.weightEntries)
    .values({ weightKg: 80, measuredAt: "2024-01-01T12:00:00Z" })
    .run();
  let writes = 0;
  const adapter = {
    authorize: async () => {},
    write: async () => {
      writes++;
      return "saved";
    },
    read: async () => {
      throw new Error("offline");
    },
    remove: async () => {},
  };
  await assert.rejects(health.syncHealth(adapter), /offline/);
  assert.equal(
    db.select().from(schema.preferences).where(eq(schema.preferences.key, "lastSync")).get(),
    undefined
  );
  adapter.read = async () => [];
  await health.syncHealth(adapter);
  assert.equal(writes, 1);
  sqlite.close();
});

test("daily health schedule respects opt-in, due time, failures and opt-out", async () => {
  const { db, sqlite } = database();
  let task;
  let registered = false;
  let calls = 0;
  let fail = false;
  let failRegistration = false;
  const get = (key) =>
    db.select().from(schema.preferences).where(eq(schema.preferences.key, key)).get()?.value;
  const set = (key, value) =>
    db
      .insert(schema.preferences)
      .values({ key, value })
      .onConflictDoUpdate({ target: schema.preferences.key, set: { value } })
      .run();
  const schedule = load("src/lib/health-schedule.ts", {
    "expo-constants": { default: { appOwnership: "standalone" } },
    "react-native": { Platform: { OS: "ios" } },
    "@/db": { db, ...schema },
    "expo-task-manager": {
      defineTask: (_name, callback) => {
        task = callback;
      },
      isTaskRegisteredAsync: async () => registered,
    },
    "expo-background-task": {
      BackgroundTaskStatus: { Available: 2 },
      BackgroundTaskResult: { Success: 1, Failed: 2 },
      getStatusAsync: async () => 2,
      registerTaskAsync: async (_name, options) => {
        assert.equal(options.minimumInterval, 1440);
        if (failRegistration) throw new Error("scheduler");
        registered = true;
      },
      unregisterTaskAsync: async () => {
        registered = false;
      },
    },
    "./health": {
      syncHealth: async (_adapter, interactive) => {
        calls++;
        if (get("healthSyncEnabled") === "true") assert.equal(interactive, false);
        if (fail) throw new Error("offline");
        set("lastSync", new Date().toISOString());
      },
    },
  });
  const now = Date.now();
  assert.equal(schedule.healthSyncDue(undefined, now), true);
  assert.equal(schedule.healthSyncDue("invalid", now), true);
  assert.equal(schedule.healthSyncDue(new Date(now - 86400000).toISOString(), now), true);
  assert.equal(schedule.healthSyncDue(new Date(now - 86399999).toISOString(), now), false);
  assert.equal(schedule.healthSyncDue(new Date(now + 1).toISOString(), now), true);
  await task();
  assert.equal(calls, 0);
  fail = true;
  await assert.rejects(schedule.enableHealthSync(), /offline/);
  assert.notEqual(get("healthSyncEnabled"), "true");
  fail = false;
  await schedule.enableHealthSync();
  assert.equal(registered, true);
  assert.equal(get("healthSyncEnabled"), "true");
  const afterEnable = calls;
  await task();
  assert.equal(calls, afterEnable);
  const overdue = new Date(now - 86400001).toISOString();
  set("lastSync", overdue);
  fail = true;
  assert.equal(await task(), 2);
  assert.equal(get("lastSync"), overdue);
  assert.equal(get("healthSyncError"), "syncFailed");
  fail = false;
  assert.equal(await task(), 1);
  assert.equal(get("healthSyncError"), "");
  await schedule.disableHealthSync();
  assert.equal(registered, false);
  set("lastSync", overdue);
  const afterDisable = calls;
  await task();
  assert.equal(calls, afterDisable);
  failRegistration = true;
  await assert.rejects(schedule.enableHealthSync(), /scheduler/);
  assert.equal(get("healthSyncEnabled"), "false");
  sqlite.close();
});
