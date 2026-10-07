// Pendum Lift's own vault tests (app-owned; spec §5.6, §13.3). The synced tests in tests/vault/ check the vault
// against this app's descriptor; these check what only lift has: its Health sync after a restore (the bugs the old
// backup had), its v1 backups through the vault, and its preference repairs and validators.
//
// Every phone is a harness world (tests/vault-harness.cjs) running the app's real Health sync (src/lib/health.ts and
// the real platform adapter in src/lib/health-native.*.ts) over a fake Health store that behaves like the real one
// where the sync relies on it: Apple Health replaces a sample saved again under the same HKSyncIdentifier, finds
// samples by that identifier, and fails a delete that matched nothing with "No data available for the specified
// predicate"; Health Connect upserts by client record id. A uuid delete with an empty id fails the test. Phones on one
// Apple Account share one store.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const vault = require("./vault-harness.cjs");

const PASSWORD = "correct horse battery staple";
const NO_DATA = "No data available for the specified predicate";
const BODY_MASS = "HKQuantityTypeIdentifierBodyMass";
const WORKOUT = "HKWorkoutTypeIdentifier";

// ---------------------------------------------------------------------------------------------------------------
// Fake Health stores

/**
 * One Apple Account's Health, as @kingstinct/react-native-healthkit shows it to the app. Its sample ids start with
 * `tag`: real uuids never repeat across stores, and the restore merge compares them.
 */
function appleHealth(tag = "HK") {
  const samples = new Map();
  const deletes = [];
  let next = 0;
  const id = (prefix) => `${prefix}-${String(++next).padStart(4, "0")}`;
  function save(type, fields, metadata) {
    const syncId = metadata?.HKSyncIdentifier;
    const old = syncId
      ? [...samples.values()].find((s) => s.type === type && s.syncId === syncId)
      : undefined;
    if (old) {
      assert.ok(metadata.HKSyncVersion >= old.version, `${syncId}: HKSyncVersion went down`);
      samples.delete(old.uuid);
    }
    const uuid = id(tag);
    samples.set(uuid, { type, uuid, syncId, version: metadata?.HKSyncVersion, ...fields });
    return { uuid };
  }
  const module = {
    AuthorizationStatus: { notDetermined: 0, sharingDenied: 1, sharingAuthorized: 2 },
    ComparisonPredicateOperator: { equalTo: 4 },
    WorkoutActivityType: { traditionalStrengthTraining: 50 },
    isHealthDataAvailable: () => true,
    requestAuthorization: async () => true,
    authorizationStatusFor: () => 2,
    async queryQuantitySamples(type) {
      return [...samples.values()]
        .filter((s) => s.type === type)
        .map((s) => ({
          uuid: s.uuid,
          quantity: s.value,
          startDate: new Date(s.at),
          metadata: s.syncId ? { HKSyncIdentifier: s.syncId, HKSyncVersion: s.version } : {},
        }));
    },
    async saveQuantitySample(type, unit, value, start, _end, metadata) {
      assert.equal(unit, "kg");
      return save(type, { value, at: start.toISOString() }, metadata);
    },
    async saveWorkoutSample(_activity, _quantities, start, end, _totals, metadata) {
      return save(
        WORKOUT,
        { at: start.toISOString(), end: end.toISOString(), title: metadata.HKWorkoutBrandName },
        metadata
      );
    },
    async deleteObjects(type, filter) {
      deletes.push({ type, ...filter });
      let matched;
      if ("uuid" in filter) {
        assert.ok(filter.uuid, "a uuid delete with an empty id");
        matched = [...samples.values()].filter((s) => s.type === type && s.uuid === filter.uuid);
      } else {
        const { withMetadataKey, operatorType, value } = filter.metadata;
        assert.deepEqual([withMetadataKey, operatorType], ["HKSyncIdentifier", 4]);
        assert.ok(value, "a client-id delete without a client id");
        matched = [...samples.values()].filter((s) => s.type === type && s.syncId === value);
      }
      if (!matched.length) throw new Error(NO_DATA);
      for (const s of matched) samples.delete(s.uuid);
      return matched.length;
    },
  };
  return {
    platform: "ios",
    module,
    deletes,
    /** A reading another app saved (a scale): no sync identifier. */
    external(kg, at) {
      const uuid = id("EXT");
      samples.set(uuid, { type: BODY_MASS, uuid, value: kg, at });
      return uuid;
    },
    /** The same reading under a new id (another source's copy of it, a store that re-issued ids). */
    reissue(uuid) {
      const sample = samples.get(uuid);
      samples.delete(uuid);
      return this.external(sample.value, sample.at);
    },
    weights: () => [...samples.values()].filter((s) => s.type === BODY_MASS),
    workouts: () => [...samples.values()].filter((s) => s.type === WORKOUT),
  };
}

/**
 * One phone's Health Connect, as react-native-health-connect shows it to the app. Its record ids start with `tag`: real
 * ones never repeat across phones, and the restore merge compares them.
 */
function healthConnect(tag = "hc") {
  const records = new Map();
  const deletes = [];
  let next = 0;
  const granted = [
    { recordType: "Weight", accessType: "read" },
    { recordType: "Weight", accessType: "write" },
    { recordType: "ExerciseSession", accessType: "write" },
  ];
  function upsert(record) {
    const { clientRecordId, clientRecordVersion } = record.metadata;
    const fields =
      record.recordType === "Weight"
        ? { kg: record.weight.value, at: record.time }
        : { at: record.startTime, end: record.endTime, title: record.title };
    const old = [...records.values()].find(
      (r) => r.recordType === record.recordType && r.clientId === clientRecordId
    );
    if (old) {
      if (clientRecordVersion > old.version)
        Object.assign(old, fields, { version: clientRecordVersion });
      return old.id;
    }
    const recordId = `${tag}-${String(++next).padStart(4, "0")}`;
    records.set(recordId, {
      recordType: record.recordType,
      id: recordId,
      clientId: clientRecordId,
      version: clientRecordVersion,
      ...fields,
    });
    return recordId;
  }
  const module = {
    SdkAvailabilityStatus: { SDK_AVAILABLE: 3 },
    RecordingMethod: { RECORDING_METHOD_MANUAL_ENTRY: 2 },
    ExerciseType: { STRENGTH_TRAINING: 70 },
    getSdkStatus: async () => 3,
    initialize: async () => true,
    requestPermission: async (permissions) => permissions,
    getGrantedPermissions: async () => granted,
    async readRecords(type, { timeRangeFilter }) {
      const from = Date.parse(timeRangeFilter.startTime);
      const to = Date.parse(timeRangeFilter.endTime);
      return {
        records: [...records.values()]
          .filter(
            (r) => r.recordType === type && Date.parse(r.at) >= from && Date.parse(r.at) <= to
          )
          .map((r) => ({
            metadata: { id: r.id, clientRecordId: r.clientId },
            weight: { inKilograms: r.kg },
            time: r.at,
          })),
        pageToken: undefined,
      };
    },
    insertRecords: async (list) => list.map(upsert),
    async deleteRecordsByUuids(type, ids, clientIds) {
      deletes.push({ type, ids: [...ids], clientIds: [...clientIds] });
      assert.ok(
        ids.every((x) => x),
        "a record-id delete with an empty id"
      );
      for (const r of [...records.values()])
        if (r.recordType === type && (ids.includes(r.id) || clientIds.includes(r.clientId)))
          records.delete(r.id);
    },
  };
  return {
    platform: "android",
    module,
    deletes,
    weights: () => [...records.values()].filter((r) => r.recordType === "Weight"),
    workouts: () => [...records.values()].filter((r) => r.recordType === "ExerciseSession"),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Phones

/**
 * A phone with Pendum Lift and its Health `store`: a harness world (closed after the test) with the app's real Health
 * sync, so the vault's restore pause is the real one too.
 */
async function phone(t, store, stubs = {}) {
  const w = await vault.world({
    platform: store.platform,
    stubs: {
      "@/lib/health": (world) => world.require("src/lib/health.ts"),
      [store.platform === "ios"
        ? "@kingstinct/react-native-healthkit"
        : "react-native-health-connect"]: store.module,
      ...stubs,
    },
  });
  t.after(() => w.close());
  const db = await w.live();
  return {
    w,
    db,
    store,
    File: w.require("expo-file-system").File,
    health: w.require("@/lib/health"),
    ops: w.require("@/vault/ops"),
    app: w.vaultApp,
  };
}

/** A phone that has only what the app writes by itself (the default gym Settings creates). */
async function freshPhone(t, store, stubs) {
  const p = await phone(t, store, stubs);
  p.w.fresh(p.db);
  return p;
}

/** Local noon-ish `days` ago, as an ISO timestamp (always in the past, inside Health Connect's 29-day window). */
function daysAgo(days, hour = 7) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function addWeight(p, kg, at) {
  const seconds = Math.floor(Date.parse(at) / 1000);
  return p.db.runSync(
    "INSERT INTO weight_entries (weight_kg, measured_at, created_at, updated_at) VALUES (?, ?, ?, ?)",
    [kg, at, seconds, seconds]
  ).lastInsertRowId;
}

function addWorkout(p, name, startedAt, minutes = 60) {
  const endedAt = new Date(Date.parse(startedAt) + minutes * 60000).toISOString();
  return p.db.runSync(
    "INSERT INTO workouts (name, started_at, ended_at, updated_at) VALUES (?, ?, ?, ?)",
    [name, startedAt, endedAt, Date.parse(endedAt)]
  ).lastInsertRowId;
}

const pref = (p, key) =>
  p.db.getFirstSync("SELECT value FROM preferences WHERE key = ?", [key])?.value;
const setPref = (p, key, value) =>
  p.db.runSync(
    "INSERT INTO preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value]
  );
const kgs = (p) =>
  p.db.getAllSync("SELECT weight_kg AS kg FROM weight_entries ORDER BY id").map((r) => r.kg);
const links = (p) =>
  p.db
    .getAllSync(
      "SELECT key, local_kind, local_id, remote_id, fingerprint, origin FROM health_links ORDER BY key"
    )
    .map((r) => ({ ...r }));
const rows = (p, table) => p.db.getAllSync(`SELECT * FROM "${table}" ORDER BY rowid`);
const finished = (p) =>
  p.db.getFirstSync("SELECT count(*) AS n FROM workouts WHERE ended_at IS NOT NULL").n;
const sorted = (list) => [...list].sort();

/** The Settings toggle: sync on, then the interactive first sync (enableHealthSync()). */
async function enableSync(p) {
  setPref(p, "healthSyncEnabled", "true");
  return p.health.syncHealth();
}

/** A manual export into Documents/out/<name>. */
async function exportFrom(p, name) {
  fs.mkdirSync(p.w.file("out"), { recursive: true });
  return p.ops.runExport({
    kind: "manual",
    destination: new p.File(p.w.uri("out", name)),
    embedMedia: true,
    csv: false,
    deflateLevel: 1,
  });
}

/** A file of one phone, copied to another's Documents/in (AirDrop, Files, Mail). */
function carry(from, to, file) {
  const source = decodeURIComponent(file.uri.replace(/^file:\/\//, ""));
  const name = path.basename(source);
  fs.mkdirSync(to.w.file("in"), { recursive: true });
  fs.copyFileSync(source, to.w.file("in", name));
  return new to.File(to.w.uri("in", name));
}

/** What the import screen does: open, restore, close. */
async function restore(p, file, options) {
  const archive = await p.ops.runOpen(file, options);
  try {
    return await p.ops.runRestore(archive, { reason: "file" });
  } finally {
    archive.close();
  }
}

/** A v1 backup made by the old Backup panel's code (createBackup()), saved as Documents/out/<name>. */
function v1File(p, name, text = JSON.stringify(p.w.require("@/lib/backup-data").createBackup())) {
  fs.mkdirSync(p.w.file("out"), { recursive: true });
  fs.writeFileSync(p.w.file("out", name), text);
  return new p.File(p.w.uri("out", name));
}

// ---------------------------------------------------------------------------------------------------------------
// §5.6 bug 4.1: restore + sync duplicated weights locally and in Health

test(
  "bug 4.1 (a): restored on another iPhone, weights upsert their samples under the same client ids; none come back as readings",
  { skip: vault.skip },
  async (t) => {
    const health = appleHealth();
    const a = await phone(t, health);
    addWeight(a, 80, daysAgo(3));
    addWeight(a, 81, daysAgo(2));
    await enableSync(a);
    const A = pref(a, "installation");
    const keys = [`lift-track:${A}:weight:1`, `lift-track:${A}:weight:2`];
    assert.deepEqual(sorted(health.weights().map((s) => s.syncId)), keys);
    const exported = await exportFrom(a, "a.pendumlift");

    const b = await freshPhone(t, health);
    await restore(b, carry(a, b, exported.file));
    assert.equal(pref(b, "healthSyncEnabled"), "false");
    assert.notEqual(
      pref(b, "installation"),
      A,
      "another phone writes new records under its own id"
    );
    const before = new Set(health.weights().map((s) => s.uuid));
    await enableSync(b);
    assert.deepEqual(kgs(b), [80, 81]);
    assert.deepEqual(sorted(health.weights().map((s) => s.syncId)), keys);
    assert.equal(health.weights().length, 2);
    assert.ok(
      health.weights().every((s) => !before.has(s.uuid)),
      "each sample was replaced in place (upsert), not left as it was"
    );
    assert.ok(JSON.parse(pref(b, "healthInstallations")).includes(A));
  }
);

test(
  "bug 4.1 (b): a v1 backup restored on the phone that made it keeps its installation; sync writes nothing twice",
  { skip: vault.skip },
  async (t) => {
    const health = appleHealth();
    const a = await phone(t, health);
    addWeight(a, 80, daysAgo(3));
    addWeight(a, 81, daysAgo(2));
    await enableSync(a);
    const A = pref(a, "installation");
    const samples = sorted(health.weights().map((s) => s.uuid));
    await restore(a, v1File(a, "v1.json"));
    assert.equal(pref(a, "installation"), A, "a v1 restore keeps the live installation");
    assert.deepEqual(JSON.parse(pref(a, "healthInstallations")), sorted(["*", A]));
    await enableSync(a);
    assert.deepEqual(kgs(a), [80, 81]);
    assert.deepEqual(
      sorted(health.weights().map((s) => s.uuid)),
      samples,
      "no sample written again"
    );
  }
);

test(
  "bug 4.1 (c): a v1 backup from another phone whose samples are in Health: none is imported as a reading",
  { skip: vault.skip },
  async (t) => {
    const health = appleHealth();
    const o = await phone(t, health);
    addWeight(o, 80, daysAgo(3));
    addWeight(o, 81, daysAgo(2));
    await enableSync(o);
    const O = pref(o, "installation");
    const file = v1File(o, "v1.json");

    const a = await freshPhone(t, health);
    await restore(a, carry(o, a, file));
    assert.deepEqual(JSON.parse(pref(a, "healthInstallations")), ["*"]);
    await enableSync(a);
    assert.deepEqual(kgs(a), [80, 81], "O's samples are this app's own: never imported");
    // The stated limitation of v1 files from another phone: they carry no client ids, so the weights are written
    // again under this phone's installation (spec §2.11).
    const A = pref(a, "installation");
    assert.deepEqual(
      sorted(health.weights().map((s) => s.syncId.split(":")[1])),
      sorted([O, O, A, A])
    );
  }
);

// ---------------------------------------------------------------------------------------------------------------
// §5.6 bug 4.2: imports deleted here came back after a restore

test(
  "bug 4.2 (a): an import deleted here stays deleted on the phone the archive is restored on",
  { skip: vault.skip },
  async (t) => {
    const health = appleHealth();
    health.external(79.4, daysAgo(5));
    const a = await phone(t, health);
    addWeight(a, 80, daysAgo(3));
    await enableSync(a);
    assert.deepEqual(kgs(a), [80, 79.4]);
    a.db.runSync("DELETE FROM weight_entries WHERE weight_kg = 79.4");
    await a.health.syncHealth();
    assert.deepEqual(kgs(a), [80]);
    const exported = await exportFrom(a, "a.pendumlift");

    const b = await freshPhone(t, health);
    await restore(b, carry(a, b, exported.file));
    await enableSync(b);
    assert.deepEqual(kgs(b), [80], "Health still has the reading; it stays deleted");
  }
);

test(
  "bug 4.2 (b): an older v2 archive or v1 file restored on the same phone keeps a later-deleted import deleted",
  { skip: vault.skip },
  async (t) => {
    const health = appleHealth();
    health.external(79.4, daysAgo(5));
    const a = await phone(t, health);
    addWeight(a, 80, daysAgo(3));
    // Both made before Health was turned on: they know nothing of the import.
    const older = await exportFrom(a, "before-health.pendumlift");
    const v1 = v1File(a, "before-health.json");
    await enableSync(a);
    a.db.runSync("DELETE FROM weight_entries WHERE weight_kg = 79.4");
    for (const [label, file] of [
      ["older v2", older.file],
      ["v1", v1],
    ]) {
      await restore(a, file);
      await enableSync(a);
      assert.deepEqual(kgs(a), [80], label);
    }
    // The tombstone (the import's link without a row) is what keeps it out.
    assert.ok(links(a).some((l) => l.origin === "health" && l.local_id === -1));
  }
);

// ---------------------------------------------------------------------------------------------------------------
// §5.6 bug 4.3: values outside the v1 bounds blocked backup and restore

test(
  "bug 4.3: an empty program name, a 121-character gym name and a 2,500 kg set export and restore unchanged",
  { skip: vault.skip },
  async (t) => {
    const a = await phone(t, appleHealth());
    a.w.seed(a.db);
    a.db.runSync("UPDATE mesocycles SET name = '' WHERE id = 1");
    a.db.runSync("UPDATE gyms SET name = ? WHERE id = 2", ["G".repeat(121)]);
    a.db.runSync("UPDATE sets SET weight_kg = 2500 WHERE id = 2");
    // The v1 backup refused these (and so did every restore, which needed one first).
    assert.throws(() => a.w.require("@/lib/backup-data").createBackup(), /invalid/);
    const exported = await exportFrom(a, "a.pendumlift");
    assert.deepEqual(
      exported.warnings.filter((w) => w.fatal),
      []
    );

    const b = await freshPhone(t, appleHealth());
    await restore(b, carry(a, b, exported.file));
    for (const { name } of a.app.tables.filter((x) => x.mode === "replace"))
      if (name !== "health_links") assert.deepEqual(rows(b, name), rows(a, name), name);
  }
);

// ---------------------------------------------------------------------------------------------------------------
// §5.6 bug 4.5: recovery copies piled up and were named by absolute paths

test(
  "bug 4.5: three restores leave two recovery sets named by id; a v1 copy is found by file name after a reinstall",
  { skip: vault.skip },
  async (t) => {
    const a = await phone(t, appleHealth());
    a.w.seed(a.db);
    const exported = await exportFrom(a, "a.pendumlift");
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await restore(a, exported.file)).recoveryId);
    const sets = fs.readdirSync(a.w.file("PendumVault", "recovery"));
    assert.equal(sets.length, 2);
    assert.ok(sets.includes(ids[2]), "the newest is kept");
    const latest = a.w.require("@/vault/engine/state").readState(a.db, "recovery.latest");
    assert.equal(latest, ids[2]);
    assert.doesNotMatch(latest, /file:|\//);
    // The last v2 restore superseded the fixture's v1 copy.
    assert.equal(pref(a, "recoveryBackupUri"), undefined);

    // A v1 copy named by a container path that no longer exists.
    const name = "before-restore-1787000000000.backup.json";
    fs.mkdirSync(a.w.file("LiftTrackBackups"), { recursive: true });
    fs.writeFileSync(a.w.file("LiftTrackBackups", name), "{}");
    setPref(
      a,
      "recoveryBackupUri",
      `file:///var/mobile/Containers/Data/Application/0A1B-OLD/Documents/LiftTrackBackups/${name}`
    );
    assert.equal(a.app.legacy.recoveryCopy(a.db).file.uri, a.w.uri("LiftTrackBackups", name));
    setPref(a, "recoveryBackupUri", "file:///x/LiftTrackBackups/..%2F..%2Fsecret.json");
    assert.equal(a.app.legacy.recoveryCopy(a.db), null);
  }
);

// ---------------------------------------------------------------------------------------------------------------
// §5.6 (new): Health sync broke for good after a restore on another phone

test(
  "after a restore on another phone whose Health lacks the source's samples, sync completes: one workout each, lastSync set",
  { skip: vault.skip },
  async (t) => {
    const a = await phone(t, appleHealth());
    addWeight(a, 80, daysAgo(4));
    addWeight(a, 81, daysAgo(3));
    const gone = addWeight(a, 82, daysAgo(2));
    addWorkout(a, "Upper", daysAgo(4, 18));
    addWorkout(a, "Lower", daysAgo(2, 18));
    await enableSync(a);
    // Deleted after the last sync: its sample is still linked and is removed on the next one.
    a.db.runSync("DELETE FROM weight_entries WHERE id = ?", [gone]);
    const exported = await exportFrom(a, "a.pendumlift");

    const elsewhere = appleHealth();
    const b = await freshPhone(t, elsewhere);
    await restore(b, carry(a, b, exported.file));
    await enableSync(b);
    assert.ok(pref(b, "lastSync"));
    assert.equal(pref(b, "healthSyncError") ?? "", "");
    assert.equal(elsewhere.workouts().length, finished(b));
    assert.equal(elsewhere.weights().length, 2);
    // The delete of a sample this store never had was tried and counted as done.
    assert.ok(elsewhere.deletes.some((d) => d.type === BODY_MASS && d.uuid));
    assert.ok(links(b).some((l) => l.local_kind === "weight" && l.fingerprint === "deleted"));
  }
);

// ---------------------------------------------------------------------------------------------------------------
// §5.6 (d)–(f): workouts linked by a v1 restore (`restored:workout:<id>` keys)

test(
  "restored:workout links: another iPhone replaces each original once; an empty store and Android write each once; the same phone rewrites nothing",
  { skip: vault.skip },
  async (t) => {
    const shared = appleHealth();
    // The phone that made the v1 file: its workouts are in Health as lift-track:O:workout:<id>.
    const o = await phone(t, shared);
    addWorkout(o, "Upper", daysAgo(6, 18));
    addWorkout(o, "Lower", daysAgo(4, 18));
    addWorkout(o, "Upper", daysAgo(2, 18));
    await enableSync(o);
    const originals = sorted(shared.workouts().map((s) => s.uuid));
    assert.equal(originals.length, 3);

    // iPhone 1 restores the v1 file through the vault, then exports without touching the workouts.
    const one = await freshPhone(t, shared);
    await restore(one, carry(o, one, v1File(o, "v1.json")));
    const restored = links(one).filter((l) => l.key.startsWith("restored:"));
    assert.deepEqual(sorted(restored.map((l) => l.remote_id)), originals);
    const exported = await exportFrom(one, "after-v1.pendumlift");
    const count = finished(one);

    // (d) Another iPhone on the same Apple Account: each original removed by its uuid, written once under this
    // phone's installation, the link moved to that key. Each `restored:` link stays behind as a tombstone parked at
    // -1 that holds its original (§5.8 item 3, red team F2).
    const b = await freshPhone(t, shared);
    await restore(b, carry(one, b, exported.file));
    await enableSync(b);
    const B = pref(b, "installation");
    assert.equal(shared.workouts().length, count);
    assert.ok(shared.workouts().every((s) => s.syncId.startsWith(`lift-track:${B}:workout:`)));
    for (const uuid of originals)
      assert.ok(
        shared.deletes.some((d) => d.type === WORKOUT && d.uuid === uuid),
        `${uuid} removed`
      );
    assert.deepEqual(
      links(b)
        .filter((l) => l.key.startsWith("restored:"))
        .map((l) => [l.key, l.local_id, l.remote_id, l.fingerprint]),
      restored.map((l) => [l.key, -1, l.remote_id, "deleted"])
    );

    // (d) The same archive on an iPhone whose Health never had them: the unknown uuids' deletes are done.
    const empty = appleHealth();
    const c = await freshPhone(t, empty);
    await restore(c, carry(one, c, exported.file));
    await enableSync(c);
    assert.ok(pref(c, "lastSync"));
    assert.equal(empty.workouts().length, count);

    // (e) Android: the links go in prepareScratch; nothing is deleted, each workout is written once.
    const droid = healthConnect();
    const d = await freshPhone(t, droid);
    await restore(d, carry(one, d, exported.file));
    assert.deepEqual(
      links(d).filter((l) => l.key.startsWith("restored:")),
      []
    );
    await enableSync(d);
    assert.deepEqual(droid.deletes, []);
    assert.equal(droid.workouts().length, count);

    // (f) Back on iPhone 1: the same phone's links still match, so no workout is written or removed.
    await restore(one, exported.file);
    const samples = sorted(shared.workouts().map((s) => s.uuid));
    const deletes = shared.deletes.length;
    await enableSync(one);
    assert.deepEqual(sorted(shared.workouts().map((s) => s.uuid)), samples);
    assert.equal(shared.deletes.length, deletes);
  }
);

// ---------------------------------------------------------------------------------------------------------------
// §5.6 (M1 review): a same-device restore brings back a `restored:workout` link whose workout this phone has
// rewritten since. Without the descriptor's swap hook Health ended with no copy of the workout.

/** A store's workouts as [title, client id], and their sample ids (Apple Health uuids, Health Connect record ids). */
const savedWorkouts = (store) => store.workouts().map((s) => [s.title, s.syncId ?? s.clientId]);
const workoutIds = (store) => sorted(store.workouts().map((s) => s.uuid ?? s.id));
const workoutLinks = (p) => links(p).filter((l) => l.local_kind === "workout");

/** After the re-enable sync: the next sync writes and removes nothing, and the link names the sample. */
async function settled(p, store, label) {
  const ids = workoutIds(store);
  const deletes = store.deletes.length;
  assert.equal((await p.health.syncHealth()).exported, 0, `${label}: nothing written again`);
  assert.deepEqual(workoutIds(store), ids, label);
  assert.equal(store.deletes.length, deletes, `${label}: nothing removed`);
}

test(
  "S1: a v1 file restored on the phone that made it, after the workout was renamed and synced, leaves exactly one Health workout: the restored one (iPhone and Android)",
  { skip: vault.skip },
  async (t) => {
    for (const store of [appleHealth(), healthConnect()]) {
      const label = store.platform;
      const a = await phone(t, store);
      const id = addWorkout(a, "Push", daysAgo(3, 18));
      await enableSync(a);
      const key = `lift-track:${pref(a, "installation")}:workout:${id}`;
      const original = workoutIds(store)[0];
      const file = v1File(a, `v1-${label}.json`);
      // Renamed after the backup: Health's copy is removed and the workout written again, under a new sample id.
      a.db.runSync("UPDATE workouts SET name = 'Push 2', updated_at = ? WHERE id = ?", [
        Date.now(),
        id,
      ]);
      await a.health.syncHealth();
      assert.deepEqual(savedWorkouts(store), [["Push 2", key]], label);
      const rewritten = workoutIds(store)[0];

      await restore(a, file);
      // The file's link names the sample the rename removed; the hook (legacy path) resets it, and the merge
      // carries this phone's link with local_id -1.
      assert.deepEqual(
        workoutLinks(a).map((l) => [l.key, l.local_id, l.fingerprint === ""]),
        [
          [key, -1, false],
          [`restored:workout:${id}`, id, true],
        ],
        label
      );
      await enableSync(a);
      assert.deepEqual(
        savedWorkouts(store),
        [["Push", key]],
        `${label}: one copy, the restored name`
      );
      // The `restored:` link gave way to the own key and stays as a tombstone parked at -1 that holds the sample the
      // rename removed (§5.8 item 3, red team F2).
      assert.deepEqual(
        workoutLinks(a).map((l) => [l.key, l.local_id, l.remote_id]),
        [
          [key, id, workoutIds(store)[0]],
          [`restored:workout:${id}`, -1, original],
        ],
        label
      );
      if (label === "ios") assert.notEqual(workoutIds(store)[0], rewritten);
      await settled(a, store, label);
    }
  }
);

test(
  "T3: a v1 file restored on the phone that made it, after one of its workouts was deleted and the delete synced, puts that workout back in Health once (iPhone and Android; the v2 case too)",
  { skip: vault.skip },
  async (t) => {
    for (const store of [appleHealth(), healthConnect()]) {
      const label = store.platform;
      const a = await phone(t, store);
      const push = addWorkout(a, "Push", daysAgo(3, 18));
      const pull = addWorkout(a, "Pull", daysAgo(2, 18));
      await enableSync(a);
      const key = (id) => `lift-track:${pref(a, "installation")}:workout:${id}`;
      const file = v1File(a, `v1-${label}.json`);
      // Deleted after the backup, and the delete synced: Health's copy is gone, and this phone's link is a tombstone
      // that holds the sample id the file's link names.
      a.db.runSync("DELETE FROM workouts WHERE id = ?", [push]);
      await a.health.syncHealth();
      assert.deepEqual(savedWorkouts(store), [["Pull", key(pull)]], label);
      const tombstone = links(a).find((l) => l.key === key(push));
      assert.equal(tombstone.fingerprint, "deleted", label);

      await restore(a, file);
      // The tombstone is carried at local_id -1 (rule A) and its key differs (rule B): the hook resets the file's link,
      // because this phone deleted that sample. The other workout's sample is still there, so its link stays as it is.
      assert.deepEqual(
        workoutLinks(a).map((l) => [l.key, l.local_id, l.remote_id, l.fingerprint === ""]),
        [
          [key(push), -1, tombstone.remote_id, false],
          [`restored:workout:${push}`, push, tombstone.remote_id, true],
          [`restored:workout:${pull}`, pull, workoutIds(store)[0], false],
        ],
        label
      );
      await enableSync(a);
      assert.deepEqual(
        savedWorkouts(store),
        [
          ["Pull", key(pull)],
          ["Push", key(push)],
        ],
        `${label}: the restored workout is back, once`
      );
      // The reset `restored:` link gave way to the own key and stays as a tombstone parked at -1 (§5.8 item 3, red
      // team F2); the other workout's link is untouched.
      assert.deepEqual(
        workoutLinks(a).map((l) => [l.key, l.local_id]),
        [
          [key(push), push],
          [`restored:workout:${push}`, -1],
          [`restored:workout:${pull}`, pull],
        ],
        label
      );
      await settled(a, store, label);
    }

    // The v2 case: a phone holding a `restored:` link exports, deletes that workout and syncs (the link is a tombstone
    // under the same key), then restores the archive. The merge gives the archive's link the tombstone (rule B).
    const health = appleHealth();
    const o = await phone(t, health);
    const legs = addWorkout(o, "Legs", daysAgo(4, 18));
    await enableSync(o);
    const b = await freshPhone(t, health);
    await restore(b, carry(o, b, v1File(o, "v1.json")));
    await enableSync(b);
    const archive = await exportFrom(b, "b.pendumlift");
    b.db.runSync("DELETE FROM workouts WHERE id = ?", [legs]);
    await b.health.syncHealth();
    assert.deepEqual(savedWorkouts(health), []);
    await restore(b, archive.file);
    await enableSync(b);
    assert.deepEqual(savedWorkouts(health), [
      ["Legs", `lift-track:${pref(b, "installation")}:workout:${legs}`],
    ]);
    await settled(b, health, "v2");
  }
);

test(
  "S3: a phone holding a restored:workout link exports, edits and syncs that workout, then restores the archive, or undoes a later restore: exactly one Health workout",
  { skip: vault.skip },
  async (t) => {
    // The phone that made a v1 file: its workout is in Health under its own key.
    const health = appleHealth();
    const o = await phone(t, health);
    const id = addWorkout(o, "Legs", daysAgo(4, 18));
    await enableSync(o);
    const file = v1File(o, "v1.json");

    // iPhone 1 restored that file through the vault: the workout is linked by a `restored:` key and stays as it is.
    const a = await freshPhone(t, health);
    await restore(a, carry(o, a, file));
    await enableSync(a);
    assert.deepEqual(
      workoutLinks(a).map((l) => l.key),
      [`restored:workout:${id}`]
    );
    const archive = await exportFrom(a, "a.pendumlift");
    // Edited and synced: the original sample is removed, the workout written under this phone's key.
    a.db.runSync("UPDATE workouts SET name = 'Legs 2', updated_at = ? WHERE id = ?", [
      Date.now(),
      id,
    ]);
    await a.health.syncHealth();
    const key = `lift-track:${pref(a, "installation")}:workout:${id}`;
    assert.deepEqual(savedWorkouts(health), [["Legs 2", key]]);
    // The archive on the same phone. Its `restored:` link names the sample the edit removed. Since that sync this
    // phone's link under the same key is a tombstone (the moved link, §5.8 item 3, red team F2), so the merge makes the
    // archive's link one (rule B), with the restored workout's id: the next sync writes it again, as the swap hook's
    // reset did when the moved link was deleted.
    await restore(a, archive.file);
    assert.deepEqual(
      workoutLinks(a)
        .filter((l) => l.key === `restored:workout:${id}`)
        .map((l) => [l.local_id, l.fingerprint]),
      [[id, "deleted"]],
      "a tombstone through rule B"
    );
    await enableSync(a);
    assert.deepEqual(savedWorkouts(health), [["Legs", key]]);
    assert.deepEqual(
      workoutLinks(a).map((l) => [l.key, l.local_id]),
      [
        [key, id],
        [`restored:workout:${id}`, -1],
      ]
    );
    await settled(a, health, "archive");

    // The undo of a later restore is a same-device restore too. iPhone 2 holds a `restored:` link, restores another
    // phone's archive and syncs (that phone's workout replaces this one in Health), then undoes the restore.
    const second = appleHealth();
    const p = await phone(t, second);
    const legs = addWorkout(p, "Legs", daysAgo(4, 18));
    await enableSync(p);
    const two = await freshPhone(t, second);
    await restore(two, carry(p, two, v1File(p, "v1-p.json")));
    await enableSync(two);
    const own = `lift-track:${pref(two, "installation")}:workout:${legs}`;
    const other = await phone(t, appleHealth("HK-OTHER"));
    addWorkout(other, "Pull", daysAgo(1, 18));
    await enableSync(other);
    const theirs = (await exportFrom(other, "o.pendumlift")).file;
    const { recoveryId } = await restore(two, carry(other, two, theirs));
    await enableSync(two);
    assert.deepEqual(
      savedWorkouts(second).map(([title]) => title),
      ["Pull"]
    );
    // What the import screen's undo does: open the restore's recovery set and restore it.
    const { exclusive } = two.w.require("@/vault/engine/lock");
    const { openRecovery } = two.w.require("@/vault/engine/recovery");
    const { archive: undo, media } = await exclusive("inspect", () => openRecovery(recoveryId), {
      wait: true,
    });
    try {
      await two.ops.runRestore(undo, { reason: "recovery", media });
    } finally {
      undo.close();
    }
    await enableSync(two);
    assert.deepEqual(savedWorkouts(second), [["Legs", own]], "undo");
    await settled(two, second, "undo");
  }
);

// ---------------------------------------------------------------------------------------------------------------
// §5.6 (provenance red team, §5.8 item 3): a workout lost from Health when a sync moved or removed a link's sample.

test(
  "F2: another phone's archive, then this phone's own v1 file with no sync between, a sync, then its own v2 archive: exactly one Health workout (iPhone and Android)",
  { skip: vault.skip },
  async (t) => {
    for (const [store, theirStore] of [
      [appleHealth("HK-A"), appleHealth("HK-B")],
      [healthConnect("hc-A"), healthConnect("hc-B")],
    ]) {
      const label = store.platform;
      // Phone A's workout is in its Health as lift-track:A:workout:<id>. The old Backup panel's v1 file (made just
      // before the app update) and a v2 archive made after it both link the workout to that sample.
      const a = await phone(t, store);
      const id = addWorkout(a, "Push", daysAgo(3, 18));
      await enableSync(a);
      const key = `lift-track:${pref(a, "installation")}:workout:${id}`;
      const original = workoutIds(store)[0];
      const file = v1File(a, `v1-${label}.json`);
      const archive = (await exportFrom(a, `a-${label}.pendumlift`)).file;

      // Phone B (its own Health) has its own workout under the same id.
      const b = await phone(t, theirStore);
      addWorkout(b, "Pull", daysAgo(1, 18));
      await enableSync(b);
      const theirs = (await exportFrom(b, `b-${label}.pendumlift`)).file;

      // B's archive parks A's link to the original at -1; the v1 file, restored before any sync, drops it (its
      // `restored:` link holds the same remote id) and the hook resets the `restored:` link. The sync removes the
      // original and writes the workout under the restore's fresh installation: the moved `restored:` link is this
      // phone's only record that the original is gone.
      await restore(a, carry(b, a, theirs));
      await restore(a, file);
      await enableSync(a);
      assert.ok(!workoutIds(store).includes(original), `${label}: the original was removed`);

      // The v2 archive still links the original: the tombstone makes the sync write the workout again under its own
      // key (rules A and D); the fresh installation's copy is removed.
      await restore(a, archive);
      await enableSync(a);
      assert.deepEqual(savedWorkouts(store), [["Push", key]], `${label}: one copy`);
      // The own key is the one live link, and the moved `restored:` link is still the original's tombstone. (The other
      // two tombstones are B's link, whose sample was never in this store, and the fresh installation's removed copy.)
      assert.deepEqual(
        workoutLinks(a)
          .filter((l) => l.fingerprint !== "deleted" || l.key.startsWith("restored:"))
          .map((l) => [l.key, l.local_id, l.remote_id, l.fingerprint === "deleted"]),
        [
          [key, id, workoutIds(store)[0], false],
          [`restored:workout:${id}`, -1, original, true],
        ],
        label
      );
      await settled(a, store, label);
    }
  }
);

test(
  "F3: this phone's own v1 file, then the archive of a device that restored this phone's earlier archive: exactly one Health workout, also after another sync (Android; iPhone as control)",
  { skip: vault.skip },
  async (t) => {
    for (const [store, tabletStore] of [
      [healthConnect("hc-A"), healthConnect("hc-T")],
      [appleHealth("HK-A"), appleHealth("HK-T")],
    ]) {
      const label = store.platform;
      // Phone A's workout is in its Health as lift-track:A:workout:<id>; its v1 file links it by a `restored:` key,
      // its v2 archive by that own key.
      const a = await phone(t, store);
      const id = addWorkout(a, "Push", daysAgo(3, 18));
      await enableSync(a);
      const key = `lift-track:${pref(a, "installation")}:workout:${id}`;
      const record = workoutIds(store)[0];
      const file = v1File(a, `v1-${label}.json`);
      const earlier = (await exportFrom(a, `a-${label}.pendumlift`)).file;

      // A tablet (its own Health) restores that archive, syncs (its copy under A's key) and exports.
      const tablet = await freshPhone(t, tabletStore);
      await restore(tablet, carry(a, tablet, earlier));
      await enableSync(tablet);
      const theirs = (await exportFrom(tablet, `tablet-${label}.pendumlift`)).file;

      // The v1 file, then the tablet's archive: its link under A's own key has its fingerprint reset (another device),
      // and the `restored:` link it covers is parked at -1 with the remote id of A's record. The sync upserts the own
      // key without a pre-delete: Health Connect updates that record in place (same id), which the parked link must
      // not remove.
      await restore(a, file);
      await restore(a, carry(tablet, a, theirs));
      await enableSync(a);
      assert.deepEqual(savedWorkouts(store), [["Push", key]], `${label}: one copy`);
      if (label === "android") assert.deepEqual(workoutIds(store), [record], "updated in place");
      // Android: the parked `restored:` link named the record just updated, so it went without a remove. iPhone: the
      // upsert saved a new uuid; the parked link's remove of the old one was done, leaving it a tombstone.
      assert.deepEqual(
        workoutLinks(a).map((l) => [l.key, l.local_id, l.remote_id, l.fingerprint === "deleted"]),
        [
          [key, id, workoutIds(store)[0], false],
          ...(label === "ios" ? [[`restored:workout:${id}`, -1, record, true]] : []),
        ],
        label
      );
      await settled(a, store, label);

      // The same v1 file once more: on Android its `restored:` link names the record the sync updated, so it stays
      // one copy. A tombstone left for that link would have made the file's link one (rule B), and the sync would
      // have written the workout again next to that record.
      await restore(a, file);
      await enableSync(a);
      assert.deepEqual(
        savedWorkouts(store).map(([title]) => title),
        ["Push"],
        `${label}: the v1 file again`
      );
      await settled(a, store, `${label}: the v1 file again`);
    }
  }
);

// ---------------------------------------------------------------------------------------------------------------
// (M1 review) Weight ids a restore gives to another phone's Health imports: the sync never exports an import, so the
// sample this phone saved under that id must be removed, not kept for good with nothing behind it.

test(
  "weights this phone synced leave its Health store when a restore gives their ids to another phone's imports (other iPhone, Android, v1 file); so does a link left at such an id",
  { skip: vault.skip },
  async (t) => {
    // Phone A imported three scale readings: in its archive and its v1 file, weights 1–3 are Health imports.
    const scale = appleHealth("HK-A");
    for (const [kg, day] of [
      [90, 6],
      [89.5, 5],
      [89, 4],
    ])
      scale.external(kg, daysAgo(day));
    const a = await phone(t, scale);
    await enableSync(a);
    assert.deepEqual(kgs(a), [90, 89.5, 89]);
    const archive = (await exportFrom(a, "a.pendumlift")).file;
    const file = v1File(a, "a-v1.json");
    for (const [label, store, source] of [
      ["other iPhone", appleHealth("HK-B"), archive],
      ["Android", healthConnect(), archive],
      ["v1 file", appleHealth("HK-C"), file],
    ]) {
      // Phone B typed weights 1–3 and synced them to its own Health store.
      const b = await phone(t, store);
      for (const [kg, day] of [
        [70, 3],
        [71, 2],
        [72, 1],
      ])
        addWeight(b, kg, daysAgo(day));
      await enableSync(b);
      assert.equal(store.weights().length, 3, label);
      await restore(b, carry(a, b, source));
      await enableSync(b);
      assert.deepEqual(kgs(b), [90, 89.5, 89], label);
      assert.deepEqual(store.weights(), [], `${label}: none of B's old samples stays`);
      assert.equal((await b.health.syncHealth()).exported, 0, label);
    }

    // The sync's own defence, whatever the merge did: a link of this phone kept at an id an import now holds (as
    // vault 1.0.0 left it) has its sample removed and is marked deleted; the import row stays out of Health.
    const store = appleHealth("HK-D");
    const d = await phone(t, store);
    const at = daysAgo(3);
    const id = addWeight(d, 70, at);
    await enableSync(d);
    const key = `lift-track:${pref(d, "installation")}:weight:${id}`;
    assert.equal(store.weights().length, 1);
    d.db.runSync("UPDATE weight_entries SET weight_kg = 90 WHERE id = ?", [id]);
    d.db.runSync(
      "INSERT INTO health_links (key, local_kind, local_id, remote_id, fingerprint, origin) VALUES (?, 'weight', ?, ?, ?, 'health')",
      ["health:weight:EXT-9999", id, "EXT-9999", `90:${at}`]
    );
    assert.deepEqual(await d.health.syncHealth(), { imported: 0, exported: 0 });
    assert.deepEqual(store.weights(), []);
    assert.equal(links(d).find((l) => l.key === key).fingerprint, "deleted");
    assert.deepEqual(kgs(d), [90]);
  }
);

// ---------------------------------------------------------------------------------------------------------------
// New-device round trip (spec §13.3): iPhone 1 → Android → new iPhone on iPhone 1's Apple Account

test(
  "round trip iPhone → Android → new iPhone: every record keeps its client id; Android's add and deletes reach Health; nothing is duplicated",
  { skip: vault.skip },
  async (t) => {
    const iphone = appleHealth();
    const one = await phone(t, iphone);
    addWeight(one, 80, daysAgo(6));
    const second = addWeight(one, 81, daysAgo(5));
    addWeight(one, 82, daysAgo(4));
    addWorkout(one, "Upper", daysAgo(6, 18));
    const lower = addWorkout(one, "Lower", daysAgo(4, 18));
    await enableSync(one);
    const A = pref(one, "installation");
    const original = {
      weights: sorted(iphone.weights().map((s) => s.syncId)),
      workouts: sorted(iphone.workouts().map((s) => s.syncId)),
    };
    assert.ok(
      [...original.weights, ...original.workouts].every((k) => k.startsWith(`lift-track:${A}:`))
    );
    const first = await exportFrom(one, "iphone.pendumlift");

    // Android: the archive's keys travel (remote ids cleared), so every record is upserted under its original id.
    const droid = healthConnect();
    const android = await freshPhone(t, droid);
    await restore(android, carry(one, android, first.file));
    assert.ok(
      links(android)
        .filter((l) => l.origin === "local")
        .every((l) => l.remote_id === "" && l.fingerprint === "")
    );
    await enableSync(android);
    assert.deepEqual(sorted(droid.weights().map((r) => r.clientId)), original.weights);
    assert.deepEqual(sorted(droid.workouts().map((r) => r.clientId)), original.workouts);
    assert.deepEqual(kgs(android), [80, 81, 82], "own samples are not imported");
    // On Android: one weight added, one weight and one workout deleted.
    const added = addWeight(android, 83, daysAgo(1));
    android.db.runSync("DELETE FROM weight_entries WHERE id = ?", [second]);
    android.db.runSync("DELETE FROM workouts WHERE id = ?", [lower]);
    await android.health.syncHealth();
    const X = pref(android, "installation");
    assert.notEqual(X, A);
    assert.equal(droid.weights().length, 3);
    assert.equal(droid.workouts().length, 1);
    const back = await exportFrom(android, "android.pendumlift");

    // A new iPhone on iPhone 1's Apple Account, whose Health still holds iPhone 1's samples.
    const two = await freshPhone(t, iphone);
    await restore(two, carry(android, two, back.file));
    const before = iphone.deletes.length;
    await enableSync(two);
    assert.deepEqual(kgs(two), [80, 82, 83], "nothing of this library is imported back");
    assert.deepEqual(
      sorted(iphone.weights().map((s) => s.syncId)),
      sorted([
        `lift-track:${A}:weight:1`,
        `lift-track:${A}:weight:3`,
        `lift-track:${X}:weight:${added}`,
      ])
    );
    assert.equal(iphone.weights().length, 3, "iPhone 1's three, plus one, minus one");
    assert.deepEqual(
      iphone.workouts().map((s) => s.syncId),
      original.workouts.filter((k) => !k.endsWith(`:workout:${lower}`))
    );
    // Android's deletes reached this store by client id; no delete went out with an empty uuid (the fake fails those).
    const since = iphone.deletes.slice(before);
    assert.deepEqual(
      sorted(since.map((d) => d.metadata?.value).filter(Boolean)),
      sorted([`lift-track:${A}:weight:${second}`, `lift-track:${A}:workout:${lower}`])
    );
    const lineage = JSON.parse(pref(two, "healthInstallations"));
    for (const id of [A, X, pref(two, "installation")]) assert.ok(lineage.includes(id), id);
  }
);

test(
  "two phones restored from one archive name their new records apart",
  { skip: vault.skip },
  async (t) => {
    const health = appleHealth();
    const a = await phone(t, health);
    addWeight(a, 80, daysAgo(3));
    await enableSync(a);
    const exported = await exportFrom(a, "a.pendumlift");
    const keys = [];
    for (const kg of [81, 82]) {
      const p = await freshPhone(t, health);
      await restore(p, carry(a, p, exported.file));
      const id = addWeight(p, kg, daysAgo(1));
      await enableSync(p);
      keys.push(links(p).find((l) => l.local_kind === "weight" && l.local_id === id).key);
    }
    assert.notEqual(keys[0], keys[1]);
    assert.equal(health.weights().length, 3);
  }
);

// ---------------------------------------------------------------------------------------------------------------
// Erase, the restore pause, content adoption

test(
  "erase keeps Health's lineage: re-enabling sync does not import the erased weights back",
  { skip: vault.skip },
  async (t) => {
    const health = appleHealth();
    const a = await phone(t, health, {
      // data-files.ts reaches React (data.ts) and the v1 file code (backup-files.ts); only these parts run here.
      "@/lib/data": { changed() {} },
      "@/lib/backup-files": (w) => {
        const { Directory, Paths } = w.require("expo-file-system");
        return { backupFolder: () => new Directory(Paths.document, "LiftTrackBackups") };
      },
    });
    addWeight(a, 80, daysAgo(3));
    addWeight(a, 81, daysAgo(2));
    await enableSync(a);
    const A = pref(a, "installation");
    // What the data panel does around "Erase all data".
    const { captureBeforeErase, onLocalDataErased } = a.w.require("@/vault/engine/erase");
    const keep = await captureBeforeErase();
    await a.w.require("@/lib/data-files").eraseLocalData();
    await onLocalDataErased(keep);
    assert.deepEqual(kgs(a), []);
    assert.equal(pref(a, "installation"), undefined);
    assert.deepEqual(JSON.parse(pref(a, "healthInstallations")), [A]);
    await enableSync(a);
    assert.deepEqual(kgs(a), [], "the erased weights stay erased");
  }
);

test(
  "pauseWhenIdle waits for a running sync, holds the next one off, and gives up after its timeout",
  { skip: vault.skip },
  async (t) => {
    const p = await phone(t, appleHealth());
    let release;
    const slow = {
      authorize: async () => ({ weightRead: true, weightWrite: false, workoutWrite: false }),
      read: () => new Promise((resolve) => (release = () => resolve([]))),
      write: async () => "",
      remove: async () => {},
    };
    const running = p.health.syncHealth(slow);
    await assert.rejects(
      p.health.pauseWhenIdle(async () => "never", 300),
      /healthBusy/
    );
    let ran = false;
    const paused = p.health.pauseWhenIdle(async () => {
      ran = true;
      await assert.rejects(p.health.syncHealth(slow), /syncing/);
      return "done";
    }, 5000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(ran, false, "waits while the sync runs");
    release();
    await running;
    assert.equal(await paused, "done");
    assert.equal(ran, true);
  }
);

test(
  "a reading Health re-issued under another id links to the same row, or stays deleted, instead of coming in twice",
  { skip: vault.skip },
  async (t) => {
    const health = appleHealth();
    const kept = health.external(79.4, daysAgo(5));
    const removed = health.external(78.9, daysAgo(4));
    const p = await phone(t, health);
    await enableSync(p);
    assert.deepEqual(kgs(p), [79.4, 78.9]);
    p.db.runSync("DELETE FROM weight_entries WHERE weight_kg = 78.9");
    const ids = [health.reissue(kept), health.reissue(removed)];
    assert.equal((await p.health.syncHealth()).imported, 0);
    assert.deepEqual(kgs(p), [79.4]);
    const imported = links(p).filter((l) => l.origin === "health");
    const twin = (uuid) => imported.find((l) => l.remote_id === uuid);
    const original = (uuid) => imported.find((l) => l.key === `health:weight:${uuid}`);
    assert.equal(twin(ids[0]).local_id, original(kept).local_id);
    assert.equal(twin(ids[1]).local_id, original(removed).local_id);
  }
);

// ---------------------------------------------------------------------------------------------------------------
// v1 files, preference repairs, validators, foreign keys

test(
  "an encrypted v1 backup asks for its password, refuses a wrong one, and restores with the right one",
  { skip: vault.skip },
  async (t) => {
    const a = await phone(t, appleHealth());
    a.w.seed(a.db);
    const backup = a.w.require("@/lib/backup-data").createBackup();
    const text = await a.w
      .require("@/lib/backup-crypto")
      .encryptBackupText(
        JSON.stringify(backup),
        PASSWORD,
        async (n) => new Uint8Array(randomBytes(n))
      );
    const b = await freshPhone(t, appleHealth());
    const file = carry(a, b, v1File(a, "v1-encrypted.json", text));
    const code = async (options) => {
      try {
        await b.ops.runOpen(file, options);
      } catch (e) {
        return e.code;
      }
      return "opened";
    };
    assert.equal(await code(), "legacyPasswordRequired");
    assert.equal(await code({ password: "not the password at all" }), "legacyPasswordWrong");
    const result = await restore(b, file, { password: PASSWORD });
    assert.equal(result.recoveryId, null, "the default gym alone is an empty library");
    assert.deepEqual(rows(b, "sets").length, backup.data.sets.length);
    assert.deepEqual(JSON.parse(pref(b, "healthInstallations")), ["*"]);
  }
);

test(
  "restored with foreign keys on: children of replaced rows kept, dangling preferences dropped, two open workouts only reported",
  { skip: vault.skip },
  async (t) => {
    const a = await phone(t, appleHealth());
    a.w.seed(a.db);
    setPref(a, "activeGym", "99");
    setPref(a, "travel", JSON.stringify({ gymId: 99, until: "2999-01-01" }));
    setPref(a, "feedbackSkipped", "999");
    // The app keeps one workout open and reads the first; a second is reported, not refused.
    a.db.runSync(
      "INSERT INTO workouts (name, started_at, ended_at, updated_at) VALUES ('Extra', ?, NULL, 1)",
      [daysAgo(1)]
    );
    const exported = await exportFrom(a, "a.pendumlift");
    assert.ok(
      exported.warnings.some(
        (w) => w.table === "workouts" && !w.fatal && w.message === "count:open"
      )
    );

    const b = await freshPhone(t, appleHealth());
    setPref(b, "activeGym", "1");
    assert.equal(b.db.getFirstSync("PRAGMA foreign_keys").foreign_keys, 1);
    await restore(b, carry(a, b, exported.file));
    assert.equal(b.db.getFirstSync("PRAGMA foreign_keys").foreign_keys, 1);
    for (const table of ["workouts", "workout_exercises", "sets", "muscle_feedback", "ai_nudges"])
      assert.deepEqual(rows(b, table), rows(a, table), table);
    for (const key of ["activeGym", "travel", "feedbackSkipped"])
      assert.equal(pref(b, key), undefined, key);
    assert.equal(
      b.db.getFirstSync("SELECT count(*) AS n FROM workouts WHERE ended_at IS NULL").n,
      2
    );
    assert.deepEqual(b.db.getAllSync("PRAGMA foreign_key_check"), []);
  }
);

test(
  "validators refuse what the app would crash on (bad JSON, unknown set kinds), on export as warnings and on restore",
  { skip: vault.skip },
  async (t) => {
    const a = await phone(t, appleHealth());
    a.w.seed(a.db);
    a.db.runSync("UPDATE gyms SET plates = 'not json' WHERE id = 1");
    a.db.runSync("UPDATE sets SET kind = 'giant' WHERE id = 1");
    const issues = a.app.validate(a.db);
    assert.deepEqual(
      issues.filter((i) => i.fatal).map((i) => `${i.table} ${i.message}`),
      ["gyms json:plates", "sets value:kind"]
    );
    const exported = await exportFrom(a, "a.pendumlift");
    assert.ok(exported.warnings.some((w) => w.fatal && w.message === "json:plates"));
    const b = await freshPhone(t, appleHealth());
    // Without the sync ids the vault adds on its first run.
    const gyms = () => rows(b, "gyms").map(({ sync_id, ...row }) => row);
    const before = gyms();
    await assert.rejects(restore(b, carry(a, b, exported.file)), { code: "invalidData" });
    assert.deepEqual(gyms(), before, "nothing changed");
  }
);
