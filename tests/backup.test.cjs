const { test } = require("node:test");
const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
const { load, lift, schema } = require("./harness.cjs");

const random = async (n) => webcrypto.getRandomValues(new Uint8Array(n));
const crypto = load("src/lib/backup-crypto.ts");

function withBackup(ctx) {
  const types = load("src/lib/exercises/types.ts");
  return load("src/lib/backup-data.ts", {
    "@/db": { db: ctx.db, ...schema },
    "./exercises/types": types,
  });
}

/**
 * A realistic history: a main gym and a hotel gym, a program with a finished session done while
 * traveling, feedback, a custom exercise.
 */
function seed(ctx) {
  const { workouts, programs, builder, exercises, loads, db } = ctx;
  const types = load("src/lib/exercises/types.ts");
  const all = exercises.allExercises([]);
  const byId = (id) => all.find((e) => e.id === id);
  const gym = db.insert(schema.gyms).values(loads.defaultGym("lb")).returning().get();
  db.insert(schema.preferences)
    .values({ key: "activeGym", value: String(gym.id) })
    .run();
  const hotel = workouts.addGym({ ...loads.presetGym("hotel", "lb"), included: ["custom-abc"] });
  workouts.startTravel(hotel, "2999-01-01");
  db.insert(schema.weightEntries)
    .values({ weightKg: 82.5, measuredAt: "2026-09-01T07:00:00Z" })
    .run();
  db.insert(schema.customExercises)
    .values({
      id: "custom-abc",
      name: "Cable Y-Raise",
      equipment: "cable",
      pattern: "lateralRaise",
      muscles: { sideDelts: 1 },
      unilateral: false,
      load: null,
      repMin: 12,
      repMax: 20,
      cue: "",
      archived: false,
      updatedAt: 1,
    })
    .run();
  db.insert(schema.exerciseSettings)
    .values({ exerciseId: "barbell-bench-press", favorite: true })
    .run();
  const draft = builder.buildProgram(
    {
      days: 2,
      minutes: 45,
      experience: "intermediate",
      weeks: 4,
      priorities: [],
      deprioritized: [],
      equipment: types.equipment,
      settings: [],
    },
    all
  );
  const mesoId = programs.startProgram({ ...draft, gymId: gym.id });
  const detail = programs.programDetail(mesoId);
  const w = programs.startSession(detail, 0, detail.days[0].id, {
    gym: workouts.gymById(hotel),
    travel: true,
    bodyWeightKg: 82.5,
    byId,
    exercises: all,
  });
  for (const block of workouts.workoutDetail(w).exercises)
    for (const s of block.sets) {
      workouts.updateSet(s.id, { weightKg: 40, rir: 2 });
      workouts.completeSet(s.id);
    }
  workouts.finishWorkout(w);
  programs.saveFeedback(w, programs.trainedMuscles(workouts.workoutDetail(w), byId)[0], "good");
  programs.skipSession(mesoId, 0, detail.days[1].id);
  return { gym, mesoId, workoutId: w };
}

const tables = [
  "weightEntries",
  "customExercises",
  "exerciseSettings",
  "gyms",
  "mesocycles",
  "mesoDays",
  "mesoSlots",
  "mesoSkips",
  "workouts",
  "workoutExercises",
  "sets",
  "muscleFeedback",
];
const dump = (db) =>
  Object.fromEntries(
    tables.map((t) => [
      t,
      db
        .select()
        .from(schema[t])
        .all()
        .map((r) => JSON.stringify(r))
        .sort(),
    ])
  );

test("encryption round-trips, and a wrong password or a changed byte restores nothing", async () => {
  const sealed = await crypto.encryptBackupText(
    '{"hello":"lift"}',
    "correct horse battery",
    random
  );
  assert.equal(await crypto.decryptBackupText(sealed, "correct horse battery"), '{"hello":"lift"}');
  await assert.rejects(crypto.decryptBackupText(sealed, "wrong password!!"), /Wrong password/);
  const envelope = JSON.parse(sealed);
  const flipped =
    envelope.ciphertext.slice(0, -1) + (envelope.ciphertext.endsWith("0") ? "1" : "0");
  await assert.rejects(
    crypto.decryptBackupText(
      JSON.stringify({ ...envelope, ciphertext: flipped }),
      "correct horse battery"
    ),
    /Wrong password or damaged/
  );
  await assert.rejects(crypto.encryptBackupText("x", "short", random), /10 and 256/);
  assert.notEqual(
    JSON.parse(await crypto.encryptBackupText("x", "correct horse battery", random)).nonce,
    envelope.nonce
  );
});

test("a backup restores every training record exactly, on another phone", async () => {
  const from = lift();
  seed(from);
  const backup = withBackup(from).createBackup();
  const text = await crypto.encryptBackupText(
    JSON.stringify(backup),
    "correct horse battery",
    random
  );

  const to = lift();
  to.db
    .insert(schema.weightEntries)
    .values({ weightKg: 99, measuredAt: "2026-01-01T07:00:00Z" })
    .run();
  const restored = withBackup(to).parseBackup(
    await crypto.decryptBackupText(text, "correct horse battery")
  );
  withBackup(to).restoreBackup(restored, "file:///recovery.json");
  assert.deepEqual(dump(to.db), dump(from.db));
  const pref = (key) =>
    to.db
      .select()
      .from(schema.preferences)
      .all()
      .find((p) => p.key === key)?.value;
  assert.equal(pref("healthSyncEnabled"), "false");
  assert.equal(pref("recoveryBackupUri"), "file:///recovery.json");
  assert.ok(pref("activeGym"));
  // A trip names a gym by id; restored gyms start at home.
  assert.equal(pref("travel"), undefined);
  assert.equal(from.workouts.travelPlan().gym.name, "Hotel gym");
  assert.equal(to.workouts.travelPlan(), undefined);
  // The restored program runs on: week-one day B was skipped, so week two day A is next.
  const detail = to.programs.programDetail(to.programs.activeMeso().id);
  const next = to.programs.nextSession(detail);
  assert.deepEqual([next.week, next.dayId], [1, detail.days[0].id]);
  const summary = withBackup(to).backupSummary(restored);
  assert.equal(summary.workouts, 1);
  assert.equal(summary.programs, 1);
});

test("a backup from before gyms had exceptions and trips still restores", () => {
  const from = lift();
  seed(from);
  const old = withBackup(from).createBackup();
  for (const gym of old.data.gyms) {
    delete gym.excluded;
    delete gym.included;
  }
  for (const meso of old.data.mesocycles) delete meso.gymId;
  for (const workout of old.data.workouts) delete workout.travel;
  const to = lift();
  withBackup(to).restoreBackup(old);
  for (const gym of to.db.select().from(schema.gyms).all()) {
    assert.deepEqual(gym.excluded, []);
    assert.deepEqual(gym.included, []);
  }
  assert.equal(to.programs.activeMeso().gymId, null);
  assert.ok(
    to.db
      .select()
      .from(schema.workouts)
      .all()
      .every((w) => w.travel === false)
  );
});

test("inconsistent or foreign files are rejected before anything changes", () => {
  const ctx = lift();
  seed(ctx);
  const backups = withBackup(ctx);
  const good = backups.createBackup();
  const broken = [
    (b) => (b.data.sets[0].workoutExerciseId = 99999),
    (b) => (b.data.workouts[0].mesoId = 424242),
    (b) => b.data.workouts.push({ ...b.data.workouts[0] }),
    (b) => (b.data.customExercises[0].id = "../../etc"),
    (b) => (b.data.gyms[0].plates = []),
    (b) => (b.data.mesocycles[0].gymId = 424242),
    (b) => (b.format = "macro-track-backup"),
    (b) => (b.data.extra = []),
  ];
  const before = dump(ctx.db);
  for (const breakIt of broken) {
    const copy = structuredClone(good);
    breakIt(copy);
    assert.throws(() => backups.restoreBackup(copy), /invalid|unsupported/);
  }
  assert.deepEqual(dump(ctx.db), before);
  assert.throws(() => backups.parseBackup("not json"), /could not be read/);
});

test("a restored workout keeps its Health copy instead of being saved again", async () => {
  const ctx = lift();
  const { workoutId } = seed(ctx);
  const metrics = load("src/lib/metrics.ts");
  const health = load("src/lib/health.ts", {
    "expo-constants": { appOwnership: "standalone" },
    "@/db": { db: ctx.db, ...schema },
    "./health-native": {},
    "./metrics": metrics,
  });
  let written = 0;
  const adapter = {
    authorize: async () => ({ weightRead: false, weightWrite: false, workoutWrite: true }),
    read: async () => [],
    write: async () => "w",
    remove: async () => {},
    writeWorkout: async () => `hk-${++written}`,
    removeWorkout: async () => {},
  };
  await health.syncHealth(adapter);
  assert.equal(written, 1);
  const backup = withBackup(ctx).createBackup();
  assert.equal(backup.data.workouts.find((w) => w.id === workoutId).healthId, "hk-1");
  withBackup(ctx).restoreBackup(backup);
  await health.syncHealth(adapter);
  assert.equal(written, 1, "not saved twice");
});

test("erase clears every personal table; CSV lists completed sets and neutralizes formulas", () => {
  const ctx = lift();
  seed(ctx);
  const metrics = load("src/lib/metrics.ts");
  const ownership = load("src/lib/data-ownership.ts", {
    "@/db": { db: ctx.db, ...schema },
    "./metrics": metrics,
  });
  const text = ownership.exportSetsCsv((id) =>
    id === "barbell-bench-press" ? "=HYPERLINK()" : id
  );
  const lines = text.trim().split("\r\n");
  assert.ok(lines[0].includes('"load_kg","load_lb"'));
  const completed = ctx.db
    .select()
    .from(schema.sets)
    .all()
    .filter((s) => s.completedAt).length;
  assert.equal(lines.length, completed + 1);
  assert.ok(!text.includes('"=HYPERLINK'));
  assert.ok(ownership.exportWeightCsv().includes('"82.5","181.88"'));
  ownership.erasePersonalRecords();
  for (const t of tables) assert.equal(ctx.db.select().from(schema[t]).all().length, 0, t);
  assert.deepEqual(
    ctx.db
      .select()
      .from(schema.preferences)
      .all()
      .map((p) => [p.key, p.value]),
    [["healthSyncEnabled", "false"]]
  );
});
