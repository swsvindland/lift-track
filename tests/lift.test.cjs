const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load, lift } = require("./harness.cjs");

const close = (a, b, epsilon = 1e-6) => assert.ok(Math.abs(a - b) < epsilon, `${a} ≠ ${b}`);
const metrics = load("src/lib/metrics.ts");
const loads = load("src/lib/loads.ts", { "./metrics": metrics });
const strength = load("src/lib/strength.ts");
const kgGym = loads.defaultGym("kg");
const lbGym = loads.defaultGym("lb");
const LB = 0.45359237;

test("loads round to what the gym's plates, dumbbells and machines can make", () => {
  close(loads.roundLoad(101, "barbell", kgGym), 100);
  // Paired 1.25 kg plates move the bar in 2.5 kg steps.
  close(loads.roundLoad(101.3, "barbell", kgGym), 102.5);
  close(loads.roundLoad(99, "barbell", kgGym, "down"), 97.5);
  // 225 lb is two 45s a side on a 45 lb bar, and stays exactly 225 in pounds.
  close(loads.roundLoad(225 * LB, "barbell", lbGym) / LB, 225);
  close(loads.roundLoad(226 * LB, "barbell", lbGym) / LB, 225);
  assert.deepEqual(loads.platesPerSide(100, "barbell", kgGym), [25, 15]);
  assert.deepEqual(loads.platesPerSide(102.5, "barbell", kgGym), [25, 15, 1.25]);
  assert.deepEqual(loads.platesPerSide(315 * LB, "barbell", lbGym), [45, 45, 45]);
  assert.equal(loads.platesPerSide(15, "barbell", kgGym), null);
  assert.equal(loads.platesPerSide(20, "dumbbell", kgGym), null);
  // Dumbbells come in the gym's steps up to its heaviest pair; ties round down.
  close(loads.roundLoad(23, "dumbbell", kgGym), 22);
  close(loads.roundLoad(80, "dumbbell", kgGym), 50);
  close(loads.stepLoad(22, "dumbbell", kgGym, 1), 24);
  close(loads.stepLoad(22, "dumbbell", kgGym, -1), 20);
  close(loads.stepLoad(0, "cable", kgGym, 1), 5);
  close(loads.stepLoad(100, "barbell", kgGym, 1), 102.5);
  close(loads.roundLoad(0, "barbell", kgGym), 0);
});

test("estimated 1RM counts reps in reserve and inverts cleanly", () => {
  close(strength.e1rm(100, 5, 2), 100 * (1 + 7 / 30));
  close(strength.e1rm(100, 5), 100 * (1 + 5 / 30));
  assert.equal(strength.e1rm(100, 1), 100);
  assert.equal(strength.e1rm(0, 5), 0);
  close(strength.repsToFailure(strength.e1rm(80, 8, 2), 80), 10);
  assert.equal(strength.effectiveLoad(10, "bodyweight", 80), 90);
  assert.equal(strength.effectiveLoad(30, "assisted", 80), 50);
  assert.equal(strength.effectiveLoad(60, undefined, 80), 60);
});

test("the bundled library is consistent", () => {
  const { library } = lift();
  const types = load("src/lib/exercises/types.ts");
  const ids = new Set();
  const names = new Set();
  assert.ok(library.length >= 200);
  for (const e of library) {
    assert.match(e.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, e.id);
    assert.ok(!ids.has(e.id), `duplicate ${e.id}`);
    ids.add(e.id);
    assert.ok(!names.has(e.name.toLowerCase()), `duplicate name ${e.name}`);
    names.add(e.name.toLowerCase());
    assert.ok(types.equipment.includes(e.equipment), e.id);
    assert.ok(types.patterns.includes(e.pattern), e.id);
    const entries = Object.entries(e.muscles);
    assert.ok(
      entries.some(([, w]) => w === 1),
      `${e.id} has no primary muscle`
    );
    for (const [m, w] of entries) assert.ok(types.muscles.includes(m) && (w === 1 || w === 0.5));
    assert.ok(e.reps[0] < e.reps[1], e.id);
    if (e.equipment === "bodyweight") assert.equal(e.load, "bodyweight", e.id);
  }
});

test("search understands gym shorthand, typos and muscles", () => {
  const { library, exercises } = lift();
  const all = exercises.allExercises([]);
  assert.equal(all.length, library.length);
  const top = (q) => exercises.searchExercises(all, q)[0]?.id;
  assert.match(top("rdl"), /romanian|rdl/);
  assert.equal(top("db lateral raise"), "db-lateral-raise");
  assert.equal(top("Barbell Bench Press"), "barbell-bench-press");
  assert.ok(exercises.searchExercises(all, "tricpes pushdown").length > 0);
  const quads = exercises.searchExercises(all, "quads");
  assert.ok(quads.length > 5 && quads.every((e) => e.muscles.quads));
  assert.equal(exercises.searchExercises(all, "zzzz").length, 0);
});

test("swaps stay on the movement, respect the gym's equipment and skip avoided exercises", () => {
  const { exercises } = lift();
  const all = exercises.allExercises([]);
  const bench = all.find((e) => e.id === "barbell-bench-press");
  const dumbbellsOnly = exercises.substitutes(bench, all, {
    gym: { equipment: ["dumbbell", "bodyweight"] },
  });
  assert.ok(dumbbellsOnly.length > 0);
  assert.ok(dumbbellsOnly.every((e) => ["dumbbell", "bodyweight"].includes(e.equipment)));
  assert.equal(dumbbellsOnly[0].pattern, "horizontalPress");
  const first = exercises.substitutes(bench, all)[0];
  const avoided = exercises.substitutes(bench, all, {
    settings: [{ exerciseId: first.id, avoid: true, favorite: false }],
  });
  assert.ok(!avoided.some((e) => e.id === first.id));
  const lateral = all.find((e) => e.id === "db-lateral-raise");
  assert.ok(exercises.substitutes(lateral, all).every((e) => e.muscles.sideDelts));
});

test("a workout logs in one tap per set, prefills from last time and survives finishing", () => {
  const { workouts, db, schema, exercises } = lift();
  const all = exercises.allExercises([]);
  const bench = all.find((e) => e.id === "barbell-bench-press");
  const curl = all.find((e) => e.id === "db-curl") ?? all.find((e) => e.pattern === "curl");

  const id = workouts.startWorkout({ name: "Upper" });
  assert.equal(workouts.startWorkout(), id, "only one workout is open at a time");
  const block = workouts.addExercise(id, bench);
  workouts.addExercise(id, curl);
  let detail = workouts.workoutDetail(id);
  assert.equal(detail.exercises[0].sets.length, 3);
  const [s1, s2, s3] = detail.exercises[0].sets;
  // With no history there's nothing to confirm in one tap.
  assert.equal(workouts.completeSet(s1.id), false);
  workouts.updateSet(s1.id, { weightKg: 100, reps: 8 });
  assert.equal(workouts.completeSet(s1.id), true);
  // The next set now defaults to what was just done: one tap.
  assert.equal(workouts.completeSet(s2.id), true);
  detail = workouts.workoutDetail(id);
  assert.deepEqual(
    detail.exercises[0].sets.slice(0, 2).map((s) => [s.weightKg, s.reps]),
    [
      [100, 8],
      [100, 8],
    ]
  );
  // Undo a deleted set.
  const undo = workouts.deleteSet(s3.id);
  assert.equal(workouts.workoutDetail(id).exercises[0].sets.length, 2);
  undo();
  assert.equal(workouts.workoutDetail(id).exercises[0].sets.length, 3);
  workouts.addSet(block, "warmup");
  assert.equal(workouts.workoutDetail(id).exercises[0].sets[0].kind, "warmup");

  assert.equal(workouts.finishWorkout(id), id);
  detail = workouts.workoutDetail(id);
  assert.ok(detail.endedAt);
  // Unchecked sets and the untouched curl are gone.
  assert.equal(detail.exercises.length, 1);
  assert.equal(detail.exercises[0].sets.length, 2);
  assert.equal(workouts.activeWorkout(), undefined);

  // Repeating it prefills targets from last time, so each set is one tap.
  const next = workouts.startWorkout({ from: id });
  const repeat = workouts.workoutDetail(next);
  assert.equal(repeat.name, "Upper");
  assert.deepEqual(
    repeat.exercises[0].sets.map((s) => [s.targetWeightKg, s.targetReps, s.weightKg]),
    [
      [100, 8, null],
      [100, 8, null],
    ]
  );
  workouts.completeSet(repeat.exercises[0].sets[0].id);
  workouts.updateSet(repeat.exercises[0].sets[1].id, { weightKg: 105, reps: 7 });
  workouts.completeSet(repeat.exercises[0].sets[1].id);
  workouts.finishWorkout(next);
  const records = workouts.workoutRecords(workouts.workoutDetail(next));
  assert.deepEqual(
    records.map((r) => [r.exerciseId, r.kind]),
    [
      ["barbell-bench-press", "e1rm"],
      ["barbell-bench-press", "weight"],
    ]
  );
  assert.equal(workouts.finishedWorkouts().length, 2);
  assert.equal(workouts.exerciseHistory("barbell-bench-press").length, 2);
  close(workouts.bestE1rm("barbell-bench-press"), 105 * (1 + 7 / 30));

  // An empty workout is discarded on finish, not saved.
  const empty = workouts.startWorkout();
  assert.equal(workouts.finishWorkout(empty), null);
  assert.equal(db.select().from(schema.workouts).all().length, 2);
});

test("swapping keeps finished sets and reorders, supersets pair with the next exercise", () => {
  const { workouts, exercises } = lift();
  const all = exercises.allExercises([]);
  const [a, b, c] = ["barbell-bench-press", "db-lateral-raise", "barbell-back-squat"].map(
    (id) => all.find((e) => e.id === id) ?? all[0]
  );
  const id = workouts.startWorkout();
  const first = workouts.addExercise(id, a);
  const second = workouts.addExercise(id, b);
  workouts.addExercise(id, c);
  workouts.moveExercise(second, -1);
  assert.deepEqual(
    workouts.workoutDetail(id).exercises.map((x) => x.exerciseId),
    [b.id, a.id, c.id]
  );
  workouts.toggleSuperset(second);
  let detail = workouts.workoutDetail(id);
  assert.ok(detail.exercises[0].supersetGroup !== null);
  assert.equal(detail.exercises[0].supersetGroup, detail.exercises[1].supersetGroup);
  workouts.toggleSuperset(second);
  detail = workouts.workoutDetail(id);
  assert.ok(detail.exercises.every((x) => x.supersetGroup === null));

  const set = detail.exercises.find((x) => x.id === first).sets[0];
  workouts.updateSet(set.id, { weightKg: 60, reps: 10 });
  workouts.completeSet(set.id);
  const dumbbellBench = all.find((e) => e.id === "db-bench-press") ?? all[1];
  workouts.replaceExercise(first, dumbbellBench);
  detail = workouts.workoutDetail(id);
  const ids = detail.exercises.map((x) => x.exerciseId);
  assert.deepEqual(ids, [b.id, a.id, dumbbellBench.id, c.id]);
  assert.equal(detail.exercises[1].sets.length, 1, "the finished set stays with the original");
  assert.equal(detail.exercises[2].sets.length, 2, "the replacement takes the open sets");
});

test("weekly volume counts secondary muscles as half sets and skips warm-ups", () => {
  const { workouts, exercises, volume } = lift();
  const all = exercises.allExercises([]);
  const byId = (id) => all.find((e) => e.id === id);
  const bench = byId("barbell-bench-press");
  const id = workouts.startWorkout();
  const block = workouts.addExercise(id, bench);
  workouts.addSet(block, "warmup");
  for (const s of workouts.workoutDetail(id).exercises[0].sets) {
    workouts.updateSet(s.id, { weightKg: 60, reps: 10 });
    workouts.completeSet(s.id);
  }
  workouts.finishWorkout(id);
  const totals = volume.setsPerMuscle([workouts.workoutDetail(id)], byId);
  assert.equal(totals.chest, 3);
  assert.equal(totals.triceps, 1.5);
  const monday = volume.weekStart(new Date(2026, 8, 27, 15));
  assert.equal(monday.getDay(), 1);
  assert.equal(monday.getDate(), 21);
});
