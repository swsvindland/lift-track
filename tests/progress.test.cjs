const { test } = require("node:test");
const assert = require("node:assert/strict");
const { eq } = require("drizzle-orm");
const { lift } = require("./harness.cjs");

const DAY = 86400000;

/** Logs a finished workout on a given date with (exercise, [[kg, reps], ...]) blocks. */
function logWorkout(ctx, date, blocks, bodyWeightKg = null) {
  const { workouts, db, schema, exercises } = ctx;
  const all = exercises.allExercises([]);
  const id = workouts.startWorkout();
  for (const [exerciseId, sets] of blocks) {
    const exercise = all.find((e) => e.id === exerciseId);
    const block = workouts.addExercise(id, exercise, sets.length);
    const rows = workouts.workoutDetail(id).exercises.find((b) => b.id === block).sets;
    sets.forEach(([weightKg, reps], i) => {
      workouts.updateSet(rows[i].id, { weightKg, reps });
      workouts.completeSet(rows[i].id);
    });
  }
  workouts.finishWorkout(id);
  const iso = date.toISOString();
  db.update(schema.workouts)
    .set({
      startedAt: iso,
      endedAt: new Date(date.getTime() + 3600000).toISOString(),
      bodyWeightKg,
    })
    .where(eq(schema.workouts.id, id))
    .run();
  return id;
}

test("weekly volume buckets sessions by week and counts muscles", () => {
  const ctx = lift();
  const all = ctx.exercises.allExercises([]);
  const byId = (id) => all.find((e) => e.id === id);
  const now = new Date(2026, 8, 26, 12); // Saturday
  logWorkout(ctx, new Date(2026, 8, 22, 18), [
    [
      "barbell-bench-press",
      [
        [80, 8],
        [80, 8],
        [80, 7],
      ],
    ],
  ]);
  logWorkout(ctx, new Date(2026, 8, 15, 18), [
    [
      "barbell-bench-press",
      [
        [80, 8],
        [80, 8],
      ],
    ],
  ]);
  logWorkout(ctx, new Date(2026, 8, 16, 18), [
    [
      "db-lateral-raise",
      [
        [10, 15],
        [10, 15],
      ],
    ],
  ]);
  const v = ctx.analytics.weeklyVolume(3, byId, now);
  assert.deepEqual(v.weeks, ["2026-09-07", "2026-09-14", "2026-09-21"]);
  assert.deepEqual(v.sets.chest, [0, 2, 3]);
  assert.deepEqual(v.sets.triceps, [0, 1, 1.5]);
  assert.deepEqual(v.sets.sideDelts, [0, 2, 0]);
  assert.deepEqual(
    v.totals.map((t) => t.workouts),
    [0, 2, 1]
  );
  assert.equal(v.totals[2].sets, 3);
  assert.equal(v.totals[2].volumeKg, 80 * 23);
  assert.equal(v.totals[2].minutes, 60);
});

test("strength series and records follow the best set per session", () => {
  const ctx = lift();
  const all = ctx.exercises.allExercises([]);
  const byId = (id) => all.find((e) => e.id === id);
  const start = new Date(2026, 7, 3, 18).getTime();
  const sessions = [
    [
      [80, 8],
      [80, 7],
    ],
    [
      [80, 9],
      [80, 8],
    ],
    [
      [82.5, 8],
      [82.5, 7],
    ],
    [[80, 8]],
  ];
  sessions.forEach((sets, i) =>
    logWorkout(ctx, new Date(start + i * 7 * DAY), [["barbell-bench-press", sets]])
  );
  const series = ctx.analytics.strengthSeries(byId("barbell-bench-press"));
  assert.equal(series.length, 4);
  assert.ok(series[0].day < series[3].day, "oldest first");
  assert.equal(series[1].reps, 9);
  assert.ok(Math.abs(series[1].e1rmKg - 80 * (1 + 9 / 30)) < 1e-9);
  const records = ctx.analytics.recordTimeline(byId);
  // Session 2 beats the estimate; session 3 beats both; session 4 nothing; the first is a baseline.
  assert.deepEqual(
    records.map((r) => r.kind),
    ["e1rm", "e1rm", "weight"]
  );
  assert.equal(records[2].valueKg, 82.5);
  assert.equal(records[2].previousKg, 80);
  assert.deepEqual(ctx.analytics.frequentExercises(90, 6, start + 30 * DAY), [
    "barbell-bench-press",
  ]);
});

test("bodyweight movements count the body weight recorded with the workout", () => {
  const ctx = lift();
  const all = ctx.exercises.allExercises([]);
  const pullUp = all.find((e) => e.id === "pull-up");
  logWorkout(ctx, new Date(2026, 8, 1, 18), [["pull-up", [[0, 8]]]], 80);
  logWorkout(ctx, new Date(2026, 8, 8, 18), [["pull-up", [[10, 6]]]], 80);
  const series = ctx.analytics.strengthSeries(pullUp);
  assert.ok(Math.abs(series[0].e1rmKg - 80 * (1 + 8 / 30)) < 1e-9);
  assert.ok(Math.abs(series[1].e1rmKg - 90 * (1 + 6 / 30)) < 1e-9);
});

test("two sessions on one day make one strength point", () => {
  const ctx = lift();
  const bench = ctx.exercises.allExercises([]).find((e) => e.id === "barbell-bench-press");
  logWorkout(ctx, new Date(2026, 8, 1, 8), [["barbell-bench-press", [[80, 8]]]]);
  logWorkout(ctx, new Date(2026, 8, 1, 18), [["barbell-bench-press", [[85, 6]]]]);
  const series = ctx.analytics.strengthSeries(bench);
  assert.equal(series.length, 1);
  assert.equal(series[0].topKg, 85);
});
