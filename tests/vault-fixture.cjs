// Pendum Lift's vault test fixture (tests/vault-fixture.cjs; app-owned, docs/vault.md §12). `seed` writes what a
// long-time lifter has at a schema level: three gyms (one archived), a finished, an active and a saved program,
// finished workouts with sets of every kind, an open workout, feedback, AI nudges, custom exercises and settings,
// weights, preferences with Health provenance and device state, and Health links including a legacy `restored:`
// key and tombstones. `fresh` writes the default gym activeGym() creates the first time Settings renders. Rows go
// in parents first: lift's connection runs with foreign_keys = ON.

/** The vault ships at this schema level (journal length); `seed` writes the same rows at every later level. */
const FIRST_LEVEL = 5;

const INSTALLATION = "1788000000000-m4n5b6v7c8";
const ALL_EQUIPMENT = [
  "barbell",
  "ezBar",
  "trapBar",
  "smith",
  "dumbbell",
  "kettlebell",
  "cable",
  "machine",
  "plateLoaded",
  "bodyweight",
  "band",
];

const json = (value) => JSON.stringify(value);
const ms = (iso) => Date.parse(iso);
const seconds = (iso) => Math.floor(Date.parse(iso) / 1000);

function insert(db, table, rows) {
  for (const row of rows) {
    const columns = Object.keys(row);
    db.runSync(
      `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      columns.map((c) => row[c])
    );
  }
}

function seed(db, { level }) {
  if (level < FIRST_LEVEL)
    throw new Error(`lift fixture: no seed below schema level ${FIRST_LEVEL}`);
  db.withTransactionSync(() => {
    insert(db, "gyms", [
      {
        id: 1,
        name: "Home gym",
        unit: "kg",
        bar_weight: 20,
        plates: json([25, 20, 15, 10, 5, 2.5, 1.25]),
        dumbbell_step: 2,
        dumbbell_max: 50,
        machine_step: 5,
        equipment: json(["barbell", "dumbbell", "cable", "machine", "bodyweight", "band"]),
        excluded: json([]),
        included: json([]),
        archived: 0,
      },
      {
        id: 2,
        name: "Hotel gym",
        unit: "lb",
        bar_weight: 45,
        plates: json([45, 25, 10, 5]),
        dumbbell_step: 5,
        dumbbell_max: 75,
        machine_step: 10,
        equipment: json(["dumbbell", "cable", "machine", "bodyweight"]),
        excluded: json(["lat-pulldown"]),
        included: json(["cable-fly-single"]),
        archived: 0,
      },
      {
        id: 3,
        name: "Old gym — Södermalm",
        unit: "kg",
        bar_weight: 20,
        plates: json([20, 10, 5, 2.5]),
        dumbbell_step: 2.5,
        dumbbell_max: 40,
        machine_step: 5,
        equipment: json(ALL_EQUIPMENT),
        excluded: json([]),
        included: json([]),
        archived: 1,
      },
    ]);
    insert(db, "custom_exercises", [
      {
        id: "custom-mf2k3j-x9y8",
        name: "Landmine press",
        equipment: "barbell",
        pattern: "verticalPress",
        muscles: json({ frontDelts: 1, triceps: 0.5, chest: 0.5 }),
        unilateral: 1,
        load: null,
        rep_min: 8,
        rep_max: 12,
        cue: "Brace, then press up and out",
        archived: 0,
        updated_at: ms("2026-09-01T18:00:00.000Z"),
      },
      {
        id: "custom-mf3a1b-q7w6",
        name: "Nordic curl",
        equipment: "bodyweight",
        pattern: "legCurl",
        muscles: json({ hamstrings: 1 }),
        unilateral: 0,
        load: "bodyweight",
        rep_min: 4,
        rep_max: 8,
        cue: "",
        archived: 1,
        updated_at: ms("2026-07-12T18:00:00.000Z"),
      },
    ]);
    insert(db, "exercise_settings", [
      {
        exercise_id: "barbell-back-squat",
        favorite: 1,
        avoid: 0,
        rest_seconds: 180,
        note: "Belt from the second working set",
      },
      { exercise_id: "db-lateral-raise", favorite: 0, avoid: 0, rest_seconds: 75, note: "" },
      {
        exercise_id: "barbell-row",
        favorite: 0,
        avoid: 1,
        rest_seconds: null,
        note: "Lower back flares up",
      },
      { exercise_id: "custom-mf2k3j-x9y8", favorite: 1, avoid: 0, rest_seconds: 120, note: "" },
    ]);
    insert(db, "mesocycles", [
      {
        id: 1,
        name: "Strength base",
        rir: json([3, 2, 1]),
        deload: 1,
        deprioritized: json([]),
        gym_id: 1,
        method: 2,
        status: "finished",
        started_at: "2026-06-01T07:00:00.000Z",
        ended_at: "2026-07-06T08:00:00.000Z",
      },
      {
        id: 2,
        name: "Upper/Lower hypertrophy",
        rir: json([3, 2, 2, 1]),
        deload: 1,
        deprioritized: json(["calves"]),
        gym_id: 1,
        method: 2,
        status: "active",
        started_at: "2026-09-14T06:00:00.000Z",
        ended_at: null,
      },
      {
        id: 3,
        name: "Travel full body",
        rir: json([2, 1]),
        deload: 0,
        deprioritized: json([]),
        gym_id: 2,
        method: 2,
        status: "saved",
        started_at: "2026-09-20T18:00:00.000Z",
        ended_at: null,
      },
    ]);
    insert(db, "meso_days", [
      { id: 1, meso_id: 1, position: 0, name: "Full body A" },
      { id: 2, meso_id: 2, position: 0, name: "Upper" },
      { id: 3, meso_id: 2, position: 1, name: "Lower" },
      { id: 4, meso_id: 3, position: 0, name: "Full body" },
    ]);
    insert(db, "meso_slots", [
      {
        id: 1,
        day_id: 1,
        position: 0,
        exercise_id: "barbell-back-squat",
        sets: 3,
        rep_min: 5,
        rep_max: 8,
      },
      {
        id: 2,
        day_id: 2,
        position: 0,
        exercise_id: "barbell-bench-press",
        sets: 3,
        rep_min: 6,
        rep_max: 10,
      },
      {
        id: 3,
        day_id: 2,
        position: 1,
        exercise_id: "barbell-row",
        sets: 3,
        rep_min: 8,
        rep_max: 12,
      },
      {
        id: 4,
        day_id: 2,
        position: 2,
        exercise_id: "db-lateral-raise",
        sets: 2,
        rep_min: 12,
        rep_max: 20,
      },
      {
        id: 5,
        day_id: 3,
        position: 0,
        exercise_id: "barbell-back-squat",
        sets: 3,
        rep_min: 6,
        rep_max: 10,
      },
      {
        id: 6,
        day_id: 3,
        position: 1,
        exercise_id: "db-bulgarian-split-squat",
        sets: 2,
        rep_min: 8,
        rep_max: 12,
      },
      {
        id: 7,
        day_id: 4,
        position: 0,
        exercise_id: "custom-mf2k3j-x9y8",
        sets: 3,
        rep_min: 8,
        rep_max: 12,
      },
    ]);
    insert(db, "meso_skips", [{ id: 1, meso_id: 2, week: 0, day_id: 3 }]);
    const workout = (row) => ({
      gym_id: 1,
      body_weight_kg: null,
      meso_id: null,
      meso_week: null,
      meso_day_id: null,
      deload: 0,
      travel: 0,
      note: "",
      ...row,
      updated_at: ms(row.ended_at ?? row.started_at),
    });
    insert(db, "workouts", [
      workout({
        id: 1,
        name: "Full body A",
        started_at: "2026-06-01T07:05:00.000Z",
        ended_at: "2026-06-01T08:10:00.000Z",
        body_weight_kg: 81.9,
        meso_id: 1,
        meso_week: 0,
        meso_day_id: 1,
      }),
      workout({
        id: 2,
        name: "Upper",
        started_at: "2026-09-14T06:10:00.000Z",
        ended_at: "2026-09-14T07:15:00.000Z",
        body_weight_kg: 80.8,
        meso_id: 2,
        meso_week: 0,
        meso_day_id: 2,
        note: "Shoulder felt good 💪",
      }),
      workout({
        id: 3,
        name: "",
        started_at: "2026-09-19T17:30:00.000Z",
        ended_at: "2026-09-19T18:05:00.000Z",
        gym_id: 2,
        travel: 1,
        note: "Hotel, kurz und knapp",
      }),
      // In progress: at most one workout is open.
      workout({
        id: 4,
        name: "Upper",
        started_at: "2026-09-21T06:05:00.000Z",
        ended_at: null,
        body_weight_kg: 80.6,
        meso_id: 2,
        meso_week: 1,
        meso_day_id: 2,
      }),
    ]);
    const block = (row) => ({
      superset_group: null,
      note: "",
      slot_id: null,
      advice: null,
      ...row,
    });
    insert(db, "workout_exercises", [
      block({
        id: 1,
        workout_id: 1,
        exercise_id: "barbell-back-squat",
        position: 0,
        rep_min: 5,
        rep_max: 8,
        slot_id: 1,
        advice: json({ kind: "first", reps: 8, rir: 3 }),
      }),
      block({
        id: 2,
        workout_id: 2,
        exercise_id: "barbell-bench-press",
        position: 0,
        rep_min: 6,
        rep_max: 10,
        slot_id: 2,
        advice: json({ kind: "up", fromKg: 80, toKg: 82.5, fromReps: 8, toReps: 8, rir: 3 }),
      }),
      block({
        id: 3,
        workout_id: 2,
        exercise_id: "barbell-row",
        position: 1,
        superset_group: 1,
        rep_min: 8,
        rep_max: 12,
        slot_id: 3,
        advice: json({
          kind: "reps",
          kg: 70,
          fromReps: 10,
          toReps: 11,
          rir: 3,
          ai: 1,
          aiReason: "Rows felt easy last time",
          aiIds: "1",
        }),
      }),
      block({
        id: 4,
        workout_id: 2,
        exercise_id: "db-lateral-raise",
        position: 2,
        superset_group: 1,
        rep_min: 12,
        rep_max: 20,
        note: "Slow on the way down",
        slot_id: 4,
      }),
      block({
        id: 5,
        workout_id: 3,
        exercise_id: "custom-mf2k3j-x9y8",
        position: 0,
        rep_min: 8,
        rep_max: 12,
      }),
      block({
        id: 6,
        workout_id: 3,
        exercise_id: "db-bench-press-single",
        position: 1,
        rep_min: 8,
        rep_max: 12,
      }),
      block({
        id: 7,
        workout_id: 4,
        exercise_id: "barbell-bench-press",
        position: 0,
        rep_min: 6,
        rep_max: 10,
        slot_id: 2,
        advice: json({
          kind: "down",
          fromKg: 82.5,
          toKg: 80,
          fromReps: 6,
          toReps: 8,
          rir: 2,
          stalled: 2,
        }),
      }),
      block({
        id: 8,
        workout_id: 4,
        exercise_id: "barbell-row",
        position: 1,
        rep_min: 8,
        rep_max: 12,
        slot_id: 3,
        advice: json({ kind: "topOut", kg: 72.5, reps: 12, rir: 2 }),
      }),
    ]);
    const set = (row) => ({
      kind: "working",
      weight_kg: null,
      reps: null,
      rir: null,
      effort: null,
      side: null,
      completed_at: null,
      target_weight_kg: null,
      target_reps: null,
      target_rir: null,
      ...row,
    });
    insert(db, "sets", [
      set({
        id: 1,
        workout_exercise_id: 1,
        position: 0,
        kind: "warmup",
        weight_kg: 60,
        reps: 5,
        completed_at: "2026-06-01T07:12:00.000Z",
      }),
      set({
        id: 2,
        workout_exercise_id: 1,
        position: 1,
        weight_kg: 100,
        reps: 8,
        rir: 3,
        effort: "good",
        completed_at: "2026-06-01T07:18:00.000Z",
        target_weight_kg: 100,
        target_reps: 8,
        target_rir: 3,
      }),
      set({
        id: 3,
        workout_exercise_id: 1,
        position: 2,
        weight_kg: 100,
        reps: 7,
        rir: 1.5,
        effort: "hard",
        completed_at: "2026-06-01T07:22:30.000Z",
        target_weight_kg: 100,
        target_reps: 8,
        target_rir: 3,
      }),
      set({
        id: 4,
        workout_exercise_id: 2,
        position: 0,
        weight_kg: 82.5,
        reps: 8,
        rir: 3,
        effort: "good",
        completed_at: "2026-09-14T06:20:00.000Z",
        target_weight_kg: 82.5,
        target_reps: 8,
        target_rir: 3,
      }),
      set({
        id: 5,
        workout_exercise_id: 2,
        position: 1,
        weight_kg: 82.5,
        reps: 7,
        rir: 2,
        effort: "hard",
        completed_at: "2026-09-14T06:24:00.000Z",
        target_weight_kg: 82.5,
        target_reps: 8,
        target_rir: 3,
      }),
      set({
        id: 6,
        workout_exercise_id: 2,
        position: 2,
        kind: "drop",
        weight_kg: 70,
        reps: 10,
        effort: "hard",
        completed_at: "2026-09-14T06:25:00.000Z",
      }),
      set({
        id: 7,
        workout_exercise_id: 3,
        position: 0,
        weight_kg: 70,
        reps: 11,
        rir: 3,
        completed_at: "2026-09-14T06:35:00.000Z",
        target_weight_kg: 70,
        target_reps: 11,
        target_rir: 3,
      }),
      set({
        id: 8,
        workout_exercise_id: 3,
        position: 1,
        weight_kg: 70,
        reps: 10,
        rir: 2,
        completed_at: "2026-09-14T06:39:00.000Z",
        target_weight_kg: 70,
        target_reps: 11,
        target_rir: 3,
      }),
      set({
        id: 9,
        workout_exercise_id: 4,
        position: 0,
        kind: "myo",
        weight_kg: 10,
        reps: 15,
        rir: 1,
        completed_at: "2026-09-14T06:50:00.000Z",
      }),
      set({
        id: 10,
        workout_exercise_id: 5,
        position: 0,
        weight_kg: 20,
        reps: 10,
        rir: 2,
        effort: "good",
        completed_at: "2026-09-19T17:40:00.000Z",
      }),
      set({
        id: 11,
        workout_exercise_id: 6,
        position: 0,
        weight_kg: 22,
        reps: 10,
        rir: 2,
        effort: "good",
        side: "left",
        completed_at: "2026-09-19T17:50:00.000Z",
      }),
      set({
        id: 12,
        workout_exercise_id: 6,
        position: 1,
        weight_kg: 22,
        reps: 10,
        rir: 2,
        effort: "good",
        side: "right",
        completed_at: "2026-09-19T17:51:00.000Z",
      }),
      set({
        id: 13,
        workout_exercise_id: 7,
        position: 0,
        weight_kg: 80,
        reps: 8,
        completed_at: "2026-09-21T06:15:00.000Z",
        target_weight_kg: 80,
        target_reps: 8,
        target_rir: 2,
      }),
      set({
        id: 14,
        workout_exercise_id: 7,
        position: 1,
        target_weight_kg: 80,
        target_reps: 8,
        target_rir: 2,
      }),
      set({
        id: 15,
        workout_exercise_id: 8,
        position: 0,
        target_weight_kg: 72.5,
        target_reps: 12,
        target_rir: 2,
      }),
      set({ id: 16, workout_exercise_id: 8, position: 1, kind: "warmup", weight_kg: 40, reps: 8 }),
    ]);
    // Removed by the user: the sequence stays at 16.
    db.runSync("DELETE FROM sets WHERE id = 16");
    insert(db, "muscle_feedback", [
      { id: 1, workout_id: 1, muscle: "quads", rating: "good", soreness: "fresh" },
      { id: 2, workout_id: 1, muscle: "glutes", rating: "easy", soreness: null },
      { id: 3, workout_id: 2, muscle: "chest", rating: "hard", soreness: "justInTime" },
      { id: 4, workout_id: 2, muscle: "lats", rating: "good", soreness: null },
      { id: 5, workout_id: 2, muscle: "sideDelts", rating: "tooMuch", soreness: "sore" },
    ]);
    insert(db, "ai_nudges", [
      {
        id: 1,
        workout_id: 2,
        exercise_id: "barbell-row",
        muscle: null,
        value: 1,
        reason: "Rows felt easy",
        dismissed: 0,
      },
      {
        id: 2,
        workout_id: 2,
        exercise_id: null,
        muscle: "sideDelts",
        value: -1,
        reason: "Shoulders were sore",
        dismissed: 1,
      },
    ]);
    const weights = [
      [1, 81.9, "2026-06-01T06:30:00.000Z"],
      [2, 80.8, "2026-09-14T05:55:00.000Z"],
      [3, 80.75, "2026-09-17T06:00:00.000Z"],
      [4, 80.6, "2026-09-21T06:00:00.000Z"],
      [5, 80.2, "2026-09-25T06:00:00.000Z"],
    ];
    insert(
      db,
      "weight_entries",
      weights.map(([id, kg, at]) => ({
        id,
        weight_kg: kg,
        measured_at: at,
        created_at: seconds(at),
        updated_at: seconds(at),
      }))
    );
    // Deleted by the user (3) and an imported reading deleted here (5): the sequence stays at 5.
    db.runSync("DELETE FROM weight_entries WHERE id IN (3, 5)");

    const preferences = {
      units: "metric",
      theme: "light",
      language: "es",
      activeGym: "1",
      travel: json({ gymId: 2, until: "2026-09-20" }),
      feedbackSkipped: "1",
      installation: INSTALLATION,
      healthInstallations: json([INSTALLATION]),
      // Device state: never exported.
      restTimer: json({
        endsAt: ms("2026-09-21T06:17:00.000Z"),
        total: 120,
        label: "Bench press",
        setId: 13,
      }),
      restActivity: "7F3A9C21-5B6D-4E8F-A1B2-C3D4E5F60718",
      healthSyncEnabled: "true",
      healthSyncError: "",
      lastSync: "2026-09-21T07:00:00.000Z",
      recoveryBackupUri:
        "file:///var/mobile/Containers/Data/Application/0C1D2E3F-4A5B-6C7D-8E9F-A0B1C2D3E4F5/Documents/LiftTrackBackups/lift-track-recovery-1787000000000.backup.json",
    };
    insert(
      db,
      "preferences",
      Object.entries(preferences).map(([key, value]) => ({ key, value }))
    );

    const span = (id) =>
      db.getFirstSync(
        "SELECT started_at || '|' || ended_at || '|' || name AS f FROM workouts WHERE id = ?",
        [id]
      ).f;
    const local = (kind, id) => `lift-track:${INSTALLATION}:${kind}:${id}`;
    insert(
      db,
      "health_links",
      [
        [
          local("weight", 1),
          "weight",
          1,
          "C1D2E3F4-A5B6-4C7D-8E9F-0A1B2C3D4E01",
          "81.9:2026-06-01T06:30:00.000Z",
          "local",
        ],
        [
          local("weight", 2),
          "weight",
          2,
          "C1D2E3F4-A5B6-4C7D-8E9F-0A1B2C3D4E02",
          "80.8:2026-09-14T05:55:00.000Z",
          "local",
        ],
        // Deleted here and removed from Health.
        [
          local("weight", 3),
          "weight",
          3,
          "C1D2E3F4-A5B6-4C7D-8E9F-0A1B2C3D4E03",
          "deleted",
          "local",
        ],
        [
          local("workout", 1),
          "workout",
          1,
          "D1E2F3A4-B5C6-4D7E-8F9A-0B1C2D3E4F01",
          span(1),
          "local",
        ],
        [
          local("workout", 2),
          "workout",
          2,
          "D1E2F3A4-B5C6-4D7E-8F9A-0B1C2D3E4F02",
          span(2),
          "local",
        ],
        // Written by a v1 restore: the key is not the sample's sync id; the remote id reaches the original.
        [
          "restored:workout:3",
          "workout",
          3,
          "D1E2F3A4-B5C6-4D7E-8F9A-0B1C2D3E4F03",
          span(3),
          "local",
        ],
        // Imported from Health; the second one's row was deleted here (it must stay deleted).
        [
          "health:weight:E1F2A3B4-C5D6-4E7F-8A9B-0C1D2E3F4A04",
          "weight",
          4,
          "E1F2A3B4-C5D6-4E7F-8A9B-0C1D2E3F4A04",
          "80.6:2026-09-21T06:00:00.000Z",
          "health",
        ],
        [
          "health:weight:E1F2A3B4-C5D6-4E7F-8A9B-0C1D2E3F4A05",
          "weight",
          5,
          "E1F2A3B4-C5D6-4E7F-8A9B-0C1D2E3F4A05",
          "80.2:2026-09-25T06:00:00.000Z",
          "health",
        ],
      ].map(([key, local_kind, local_id, remote_id, fingerprint, origin]) => ({
        key,
        local_kind,
        local_id,
        remote_id,
        fingerprint,
        origin,
      }))
    );
  });
}

/** What activeGym() inserts when no gym exists: defaultGym("kg") of src/lib/loads.ts. */
function fresh(db) {
  insert(db, "gyms", [
    {
      name: "My gym",
      unit: "kg",
      bar_weight: 20,
      plates: json([25, 20, 15, 10, 5, 2.5, 1.25]),
      dumbbell_step: 2,
      dumbbell_max: 50,
      machine_step: 5,
      equipment: json(ALL_EQUIPMENT),
    },
  ]);
}

module.exports = {
  levels: [FIRST_LEVEL],
  seed,
  fresh,
  // Modules the descriptor imports lazily; each world records the calls (`w.called(module)`). The CSV builders
  // (`@/lib/data-ownership`) and the exercise library run for real.
  stubs: {
    "@/lib/health": (w) =>
      w.record("@/lib/health", {
        pauseWhenIdle: (work) => work(),
        withHealthPaused: (work) => work(),
      }),
    "@/lib/health-schedule": (w) =>
      w.record("@/lib/health-schedule", { configureHealthSchedule: async () => {} }),
    "@/lib/rest-timer": (w) => w.record("@/lib/rest-timer", { stopRest: () => {} }),
  },
};
