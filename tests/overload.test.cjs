const { test } = require("node:test");
const assert = require("node:assert/strict");
const { lift } = require("./harness.cjs");

/* Progression method 2: a session done as prescribed always earns a step; effort ratings and
   soreness steer how big. */

const LB = 0.45359237;
const done = (weightKg, reps, extra = {}) => ({
  weightKg,
  reps,
  rir: null,
  effort: null,
  targetReps: reps,
  targetRir: 2,
  ...extra,
});
const top = (p) => [Math.round((p.sets[0].weightKg / LB) * 10) / 10, p.sets[0].reps];

test("effort colors stand for reps in reserve near the set's target", () => {
  const { progression } = lift();
  const rir = (effort, target) => progression.effortRir(effort, target);
  assert.deepEqual(
    [rir("hard", 3), rir("hard", 2), rir("hard", 1), rir("hard", 0)],
    [1, 1, 0, 0],
    "hard is 1 or fewer"
  );
  assert.deepEqual(
    [rir("good", 3), rir("good", 2), rir("good", 0), rir("good", null)],
    [3, 2, 1, 2],
    "good is 1–3, the target when it's in that band"
  );
  assert.deepEqual([rir("easy", 2), rir("easy", 3), rir("easy", 0)], [4, 5, 4], "easy is 4+");
  // A typed RIR wins over a rating.
  assert.equal(progression.assumedRir(done(100, 8, { rir: 3, effort: "hard" })), 3);
});

test("a week that asks for the same reps in reserve still earns a step", () => {
  const { progression, loads } = lift();
  const gym = loads.defaultGym("lb");
  const at = (weightLb, reps, extra) =>
    progression.prescribe({
      exercise: { equipment: "barbell" },
      gym,
      reps: [8, 12],
      rir: 2,
      sets: 3,
      last: [done(weightLb * LB, reps), done(weightLb * LB, reps)],
      ...extra,
    });
  // 185 × 10 at 2 RIR, this week 2 RIR again: one more rep.
  let p = at(185, 10);
  assert.deepEqual(top(p), [185, 11]);
  assert.deepEqual(p.advice, { kind: "reps", kg: 185 * LB, fromReps: 10, toReps: 11, rir: 2 });
  // At the top of the range the step is the next load.
  p = at(185, 12);
  assert.equal(p.advice.kind, "up");
  assert.ok(top(p)[0] > 185 && top(p)[0] <= 195 && top(p)[1] >= 7, JSON.stringify(top(p)));
  // Rated hard (behind the plan): hold instead.
  p = at(185, 10, {
    last: [done(185 * LB, 10, { effort: "hard" }), done(185 * LB, 10, { effort: "hard" })],
  });
  assert.ok(top(p)[0] <= 185 && top(p)[1] <= 10, JSON.stringify(top(p)));
  // Rated easy: a bigger step than one rep.
  p = at(185, 10, { last: [done(185 * LB, 10, { effort: "easy" })] });
  assert.ok(top(p)[0] > 185 || top(p)[1] >= 12, JSON.stringify(top(p)));
  // A missed set holds or backs off.
  p = at(185, 10, { last: [done(185 * LB, 10), done(185 * LB, 8, { targetReps: 10 })] });
  assert.ok(top(p)[0] <= 185 && top(p)[1] <= 10, JSON.stringify(top(p)));
  // A new block asks for more in reserve: no step owed, the load holds with fewer reps.
  p = progression.prescribe({
    exercise: { equipment: "barbell" },
    gym,
    reps: [8, 12],
    rir: 3,
    sets: 1,
    last: [done(190 * LB, 12, { targetRir: 0 })],
  });
  assert.deepEqual(top(p), [190, 9]);
});

test("reps run past the range until a big dumbbell jump fits, then it's taken", () => {
  const { progression, loads } = lift();
  const gym = loads.defaultGym("lb");
  let last = [done(30 * LB, 12)];
  const seen = [];
  for (let week = 0; week < 8; week++) {
    const p = progression.prescribe({
      exercise: { equipment: "dumbbell" },
      gym,
      reps: [8, 12],
      rir: 2,
      sets: 3,
      last,
    });
    seen.push(top(p));
    last = p.sets.map((s) => done(s.weightKg, s.reps));
  }
  // 30 × 12 → 13, 14 … until 35 lands at 7 or more, then reps climb again at 35.
  assert.deepEqual(seen.slice(0, 2), [
    [30, 13],
    [30, 14],
  ]);
  const jump = seen.findIndex(([w]) => w === 35);
  assert.ok(jump > 0 && seen[jump][1] >= 7, JSON.stringify(seen));
  for (let i = 1; i < seen.length; i++) {
    const [w0, r0] = seen[i - 1];
    const [w1, r1] = seen[i];
    assert.ok(w1 > w0 || (w1 === w0 && r1 > r0), `week ${i + 1} went up: ${JSON.stringify(seen)}`);
    assert.ok(r1 <= 15, "never more than 3 past the range");
  }
});

test("a five-week block goes up every week for a lifter who just taps done", () => {
  const { progression, loads } = lift();
  const gym = loads.defaultGym("lb");
  for (const [equipment, start] of [
    ["barbell", 185],
    ["cable", 100],
    ["dumbbell", 30],
  ]) {
    let last = [done(start * LB, 10, { targetRir: 3 })];
    let previous = [start, 10];
    for (const rir of [2, 2, 1, 0]) {
      const p = progression.prescribe({
        exercise: { equipment },
        gym,
        reps: [8, 12],
        rir,
        sets: 3,
        last,
      });
      const [w, r] = top(p);
      assert.ok(
        w > previous[0] || (w === previous[0] && r > previous[1]),
        `${equipment} at ${rir} RIR: ${JSON.stringify(previous)} → ${JSON.stringify([w, r])}`
      );
      assert.ok(w <= previous[0] * 1.2, `${equipment} jumped too far`);
      previous = [w, r];
      last = p.sets.map((s) => done(s.weightKg, s.reps, { targetRir: s.rir }));
    }
  }
});

test("three sessions in a row behind the prescription count as a stall", () => {
  const { progression, loads } = lift();
  const gym = loads.defaultGym("kg");
  const behind = [done(100, 8, { targetReps: 10 })];
  const kept = [done(100, 10, { targetReps: 10 })];
  const input = (last, history) => ({
    exercise: { equipment: "barbell" },
    gym,
    reps: [8, 12],
    rir: 2,
    sets: 1,
    last,
    history,
  });
  assert.equal(progression.prescribe(input(behind, [behind, kept])).advice.stalled, undefined);
  assert.equal(progression.prescribe(input(behind, [behind, behind, kept])).advice.stalled, 3);
  assert.equal(
    progression.prescribe(input(kept, [behind, behind, behind])).advice.stalled,
    undefined
  );
  assert.equal(progression.sessionsBehind([behind, behind, behind, behind]), 4);
});

test("bodyweight reps climb past the range when there's no body weight to load", () => {
  const { progression } = lift();
  const p = progression.prescribe({
    exercise: { equipment: "bodyweight", load: "bodyweight" },
    reps: [6, 10],
    rir: 2,
    sets: 2,
    last: [done(0, 10), done(0, 9)],
  });
  assert.deepEqual(
    p.sets.map((s) => s.reps),
    [11, 10]
  );
  const capped = progression.prescribe({
    exercise: { equipment: "bodyweight", load: "bodyweight" },
    reps: [6, 10],
    rir: 2,
    sets: 1,
    last: [done(0, 13)],
  });
  assert.equal(capped.advice.kind, "topOut");
  assert.equal(capped.sets[0].reps, 13);
});

test("soreness caps a muscle's sets: just recovered holds, still sore takes one away", () => {
  const { programs, workouts, exercises, db, schema } = lift();
  const byId = (id) => exercises.exerciseById(id, []);
  const bench = byId("barbell-bench-press");
  // A finished session where every target was hit: +1 set on its own.
  const session = (startedAt) => {
    const id = workouts.startWorkout({ name: "Push" });
    const block = workouts.addExercise(id, bench);
    for (const set of workouts.workoutDetail(id).exercises[0].sets) {
      workouts.updateSet(set.id, { weightKg: 80, reps: 8 });
      db.update(schema.sets)
        .set({ targetReps: 8, targetRir: 2 })
        .where(require("drizzle-orm").eq(schema.sets.id, set.id))
        .run();
      workouts.completeSet(set.id);
    }
    workouts.finishWorkout(id);
    db.update(schema.workouts)
      .set({ startedAt })
      .where(require("drizzle-orm").eq(schema.workouts.id, id))
      .run();
    return { id, block };
  };
  const first = session("2026-09-01T10:00:00.000Z");
  const detail = workouts.workoutDetail(first.id);
  assert.equal(programs.muscleDelta(detail, "chest", byId, undefined), 1);
  assert.equal(programs.muscleDelta(detail, "chest", byId, "easy", "fresh"), 2);
  assert.equal(programs.muscleDelta(detail, "chest", byId, "easy", "justInTime"), 0);
  assert.equal(programs.muscleDelta(detail, "chest", byId, undefined, "sore"), -1);
  assert.equal(programs.muscleDelta(detail, "chest", byId, "tooMuch", "sore"), -1);

  // Soreness is answered at the next session that trains the muscle, and belongs to this one.
  const second = session("2026-09-04T10:00:00.000Z");
  programs.saveSoreness(second.id, "chest", "sore");
  programs.saveFeedback(second.id, "chest", "good");
  const firstRow = db
    .select()
    .from(schema.workouts)
    .where(require("drizzle-orm").eq(schema.workouts.id, first.id))
    .get();
  assert.deepEqual(programs.sorenessAfter(firstRow, byId), { chest: "sore" });
  // Clearing one answer keeps the other; clearing both removes the row.
  programs.saveSoreness(second.id, "chest", null);
  assert.deepEqual(
    programs.feedbackFor(second.id).map((f) => [f.rating, f.soreness]),
    [["good", null]]
  );
  programs.saveFeedback(second.id, "chest", null);
  assert.equal(programs.feedbackFor(second.id).length, 0);
});

test("running a block again starts a muscle that grew and recovered a set higher", () => {
  const { programs, workouts, exercises, loads } = lift();
  const byId = (id) => exercises.exerciseById(id, []);
  const context = { gym: { id: null, ...loads.defaultGym("kg") }, bodyWeightKg: 80, byId };
  const mesoId = programs.startProgram({
    name: "Upper",
    rir: [3, 2, 1],
    days: [
      {
        name: "Upper",
        slots: [
          { exerciseId: "barbell-bench-press", sets: 2, reps: [6, 10] },
          { exerciseId: "db-curl", sets: 2, reps: [8, 12] },
        ],
      },
    ],
  });
  const detail = programs.programDetail(mesoId);
  const day = detail.days[0].id;
  const run = (week) => {
    const id = programs.startSession(detail, week, day, context);
    for (const block of workouts.workoutDetail(id).exercises)
      for (const set of block.sets) {
        workouts.updateSet(set.id, { weightKg: 40 });
        workouts.completeSet(set.id);
      }
    workouts.finishWorkout(id);
    return id;
  };
  const w1 = run(0);
  programs.saveFeedback(w1, "chest", "easy");
  const w2 = run(1);
  // Chest went 2 → 4 sets; biceps came in still sore and dropped a set.
  programs.saveSoreness(w2, "biceps", "sore");
  const counts = (id) => workouts.workoutDetail(id).exercises.map((b) => b.sets.length);
  assert.deepEqual(counts(w2), [4, 3]);
  const w3 = run(2);
  assert.deepEqual(counts(w3), [5, 2], "biceps' soreness took the set back");

  const next = programs.nextBlock(programs.programDetail(mesoId), byId);
  assert.deepEqual(
    next.days[0].slots.map((s) => s.sets),
    [3, 2]
  );
});
