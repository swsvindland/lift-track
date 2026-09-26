const { test } = require("node:test");
const assert = require("node:assert/strict");
const { lift } = require("./harness.cjs");

const LB = 0.45359237;
const close = (a, b, epsilon = 1e-6) => assert.ok(Math.abs(a - b) < epsilon, `${a} ≠ ${b}`);
const done = (weightKg, reps, extra = {}) => ({
  weightKg,
  reps,
  rir: null,
  targetReps: null,
  targetRir: 2,
  ...extra,
});

test("progression keeps the load while reps fit the range, then moves up", () => {
  const { progression, loads } = lift();
  const gym = loads.defaultGym("kg");
  const barbell = { equipment: "barbell" };
  // 100 × 8 at 2 RIR, this week 1 RIR: one more rep at the same load.
  let p = progression.prescribe({
    exercise: barbell,
    gym,
    reps: [6, 10],
    rir: 1,
    sets: 3,
    last: [done(100, 8)],
  });
  assert.deepEqual(
    p.sets.map((s) => [s.weightKg, s.reps, s.rir]),
    [
      [100, 9, 1],
      [100, 9, 1],
      [100, 9, 1],
    ]
  );
  assert.equal(p.advice.kind, "reps");
  // At the top of the range the load goes up to the lightest one that lands in range.
  p = progression.prescribe({
    exercise: barbell,
    gym,
    reps: [6, 10],
    rir: 1,
    sets: 2,
    last: [done(100, 10)],
  });
  assert.equal(p.advice.kind, "up");
  assert.ok(p.sets[0].weightKg > 100 && p.sets[0].weightKg <= 105);
  assert.ok(p.sets[0].reps >= 6 && p.sets[0].reps <= 10);
  // Later sets keep last time's drop-off.
  p = progression.prescribe({
    exercise: barbell,
    gym,
    reps: [6, 10],
    rir: 1,
    sets: 3,
    last: [done(100, 8), done(100, 7), done(100, 6)],
  });
  assert.deepEqual(
    p.sets.map((s) => s.reps),
    [9, 8, 7]
  );
});

test("progression backs off after missed reps and adds reps when the next dumbbell is too heavy", () => {
  const { progression, loads } = lift();
  const gym = loads.defaultGym("kg");
  // Target 10 at 1 RIR, only 7 done: taken as failure, so the load comes down.
  const missed = progression.prescribe({
    exercise: { equipment: "barbell" },
    gym,
    reps: [8, 12],
    rir: 0,
    sets: 1,
    last: [done(100, 7, { targetReps: 10, targetRir: 1 })],
  });
  assert.equal(missed.advice.kind, "down");
  assert.ok(missed.sets[0].weightKg < 100 && missed.sets[0].reps >= 8);
  // 12 kg dumbbells for 12 at 2 RIR; 14 kg would drop below 8 reps next week at 1 RIR? Stay and top out.
  const small = { ...gym, dumbbellStep: 4 };
  const db = progression.prescribe({
    exercise: { equipment: "dumbbell" },
    gym: small,
    reps: [10, 15],
    rir: 1,
    sets: 1,
    last: [done(8, 15)],
  });
  assert.ok(db.sets[0].weightKg === 8 || db.sets[0].reps >= 10, JSON.stringify(db));
  // Pounds: 225 lb × 5 progresses to a load the lb gym can make.
  const lbGym = loads.defaultGym("lb");
  const lb = progression.prescribe({
    exercise: { equipment: "barbell" },
    gym: lbGym,
    reps: [3, 5],
    rir: 1,
    sets: 1,
    last: [done(225 * LB, 5)],
  });
  const pounds = lb.sets[0].weightKg / LB;
  close(pounds % 5, 0, 1e-6);
  assert.ok(pounds > 225);
});

test("first time, deload, bodyweight and assisted exercises", () => {
  const { progression, loads } = lift();
  const gym = loads.defaultGym("kg");
  const first = progression.prescribe({
    exercise: { equipment: "cable" },
    gym,
    reps: [10, 15],
    rir: 3,
    sets: 2,
  });
  assert.equal(first.advice.kind, "first");
  assert.deepEqual(first.sets[0], { weightKg: null, reps: 13, rir: 3 });
  const deload = progression.prescribe({
    exercise: { equipment: "barbell" },
    gym,
    reps: [6, 10],
    rir: 1,
    sets: 2,
    last: [done(100, 8)],
    deload: true,
  });
  assert.equal(deload.advice.kind, "deload");
  assert.deepEqual(deload.sets[0], { weightKg: 90, reps: 6, rir: progression.DELOAD_RIR });
  // Pull-ups at 80 kg body weight with no added load: reps first, then added plates.
  const pullUp = { equipment: "bodyweight", load: "bodyweight" };
  let p = progression.prescribe({
    exercise: pullUp,
    gym,
    reps: [6, 10],
    rir: 1,
    sets: 1,
    last: [done(0, 8)],
    bodyWeightKg: 80,
  });
  assert.deepEqual([p.sets[0].weightKg, p.sets[0].reps], [0, 9]);
  p = progression.prescribe({
    exercise: pullUp,
    gym,
    reps: [6, 10],
    rir: 1,
    sets: 1,
    last: [done(0, 12)],
    bodyWeightKg: 80,
  });
  assert.equal(p.advice.kind, "up");
  assert.ok(p.sets[0].weightKg > 0);
  // Without a body weight, bodyweight exercises progress by reps.
  p = progression.prescribe({
    exercise: pullUp,
    gym,
    reps: [6, 10],
    rir: 1,
    sets: 1,
    last: [done(0, 8)],
  });
  assert.equal(p.sets[0].reps, 9);
  // Assisted: less assistance is progress.
  const assisted = { equipment: "machine", load: "assisted" };
  p = progression.prescribe({
    exercise: assisted,
    gym,
    reps: [6, 10],
    rir: 1,
    sets: 1,
    last: [done(30, 12)],
    bodyWeightKg: 80,
  });
  assert.ok(p.sets[0].weightKg < 30, JSON.stringify(p));
});

test("a simulated lifter's five-week block progresses and never jumps wildly", () => {
  const { progression, loads } = lift();
  const gym = loads.defaultGym("kg");
  const rir = progression.rirPlan(5);
  assert.deepEqual(rir, [3, 2, 2, 1, 0]);
  // True 1RM 120 kg, gaining 0.5% a week; the lifter does exactly what's possible at the target RIR.
  let last = [];
  let oneRm = 120;
  let previousLoad = 0;
  for (let week = 0; week < 5; week++) {
    const p = progression.prescribe({
      exercise: { equipment: "barbell" },
      gym,
      reps: [6, 10],
      rir: rir[week],
      sets: 3,
      last,
    });
    const load = p.sets[0].weightKg ?? 80;
    if (previousLoad)
      assert.ok(
        load >= previousLoad - 0.01 && load <= previousLoad * 1.06,
        `${previousLoad} → ${load}`
      );
    previousLoad = load;
    const possible = Math.floor(30 * (oneRm / load - 1)) - rir[week];
    last = p.sets.map((s) => ({
      weightKg: load,
      reps: Math.max(1, Math.min(possible, 15)),
      rir: null,
      targetReps: s.reps,
      targetRir: rir[week],
    }));
    for (const s of p.sets) assert.ok(s.reps >= 6 && s.reps <= 10);
    oneRm *= 1.005;
  }
});

test("the builder fits the gym, the session length and priorities", () => {
  const { builder, exercises } = lift();
  const all = exercises.allExercises([]);
  const byId = new Map(all.map((e) => [e.id, e]));
  const types = require("./harness.cjs").load("src/lib/exercises/types.ts");
  const base = {
    minutes: 60,
    experience: "intermediate",
    weeks: 5,
    priorities: [],
    equipment: types.equipment,
    settings: [],
  };
  for (const days of [2, 3, 4, 5, 6]) {
    const draft = builder.buildProgram({ ...base, days }, all);
    assert.equal(draft.days.length, days);
    for (const day of draft.days) {
      assert.equal(day.slots.length, 6, day.name);
      assert.equal(new Set(day.slots.map((s) => s.exerciseId)).size, day.slots.length);
      for (const slot of day.slots)
        assert.ok(byId.has(slot.exerciseId) && slot.sets >= 1 && slot.sets <= 4);
    }
  }
  // Week one starts low: no muscle above the starting volume in primary sets.
  for (const days of [3, 4, 6]) {
    const draft = builder.buildProgram({ ...base, days, minutes: 90 }, all);
    const totals = {};
    for (const slot of draft.days.flatMap((d) => d.slots))
      for (const [m, w] of Object.entries(byId.get(slot.exerciseId).muscles))
        if (w === 1) totals[m] = (totals[m] ?? 0) + slot.sets;
    for (const [m, total] of Object.entries(totals))
      assert.ok(total <= builder.startingVolume.intermediate, `${days} days: ${m} ${total}`);
  }
  const upperLower = builder.buildProgram({ ...base, days: 4 }, all);
  assert.deepEqual(
    upperLower.days.map((d) => d.name),
    ["Upper A", "Lower A", "Upper B", "Lower B"]
  );
  // A dumbbell-and-bodyweight home gym gets only those.
  const home = builder.buildProgram(
    { ...base, days: 3, equipment: ["dumbbell", "bodyweight", "band"] },
    all
  );
  for (const slot of home.days.flatMap((d) => d.slots))
    assert.ok(
      ["dumbbell", "bodyweight", "band"].includes(byId.get(slot.exerciseId).equipment),
      slot.exerciseId
    );
  // Short sessions keep a priority muscle and give it more sets; avoided exercises stay out.
  const short = builder.buildProgram(
    {
      ...base,
      days: 4,
      minutes: 45,
      priorities: ["calves"],
      settings: [{ exerciseId: "barbell-bench-press", avoid: true, favorite: false }],
    },
    all
  );
  const lower = short.days[1].slots;
  assert.equal(lower.length, 5);
  const calf = lower.find((s) => byId.get(s.exerciseId).muscles.calves === 1);
  assert.ok(calf && calf.sets >= 3);
  assert.ok(
    !short.days.flatMap((d) => d.slots).some((s) => s.exerciseId === "barbell-bench-press")
  );
});

test("a program runs week by week: prescriptions, feedback-driven sets, skips and the deload", () => {
  const { programs, builder, exercises, workouts, loads, db, schema } = lift();
  const all = exercises.allExercises([]);
  const byId = (id) => all.find((e) => e.id === id);
  const types = require("./harness.cjs").load("src/lib/exercises/types.ts");
  const draft = builder.buildProgram(
    {
      days: 2,
      minutes: 45,
      experience: "intermediate",
      weeks: 4,
      priorities: [],
      equipment: types.equipment,
      settings: [],
    },
    all
  );
  const mesoId = programs.startProgram(draft);
  let detail = programs.programDetail(mesoId);
  assert.equal(programs.totalWeeks(detail), 5);
  const gym = db.insert(schema.gyms).values(loads.defaultGym("kg")).returning().get();
  const context = { gym, bodyWeightKg: 80, byId };
  const dayA = detail.days[0];

  // Week 1, day A: first-time prescriptions; do everything with 60 × target reps.
  let next = programs.nextSession(detail);
  assert.deepEqual([next.week, next.dayId], [0, dayA.id]);
  const w1 = programs.startSession(detail, 0, dayA.id, context);
  assert.equal(
    programs.startSession(detail, 0, detail.days[1].id, context),
    w1,
    "one open workout"
  );
  let session = workouts.workoutDetail(w1);
  assert.equal(session.exercises.length, dayA.slots.length);
  assert.equal(session.exercises[0].advice.kind, "first");
  assert.equal(session.exercises[0].sets[0].targetRir, 3);
  for (const block of session.exercises)
    for (const set of block.sets) {
      workouts.updateSet(set.id, { weightKg: 60 });
      workouts.completeSet(set.id);
    }
  workouts.finishWorkout(w1);
  const muscles = programs.trainedMuscles(workouts.workoutDetail(w1), byId);
  assert.ok(muscles.length >= 3);
  // Feedback: the first muscle felt easy (+2), the second too much (−1), the rest skipped.
  programs.saveFeedback(w1, muscles[0], "easy");
  programs.saveFeedback(w1, muscles[1], "tooMuch");
  programs.saveFeedback(w1, muscles[1], "tooMuch");
  assert.equal(programs.feedbackFor(w1).length, 2);

  // Day B is skipped; week 2 day A is next.
  detail = programs.programDetail(mesoId);
  programs.skipSession(mesoId, 0, detail.days[1].id);
  next = programs.nextSession(detail);
  assert.deepEqual([next.week, next.dayId], [1, dayA.id]);

  const w2 = programs.startSession(detail, 1, dayA.id, context);
  session = workouts.workoutDetail(w2);
  const setsOf = (m) =>
    session.exercises
      .filter((b) => byId(b.exerciseId).muscles[m] === 1)
      .reduce((n, b) => n + b.sets.length, 0);
  const plannedOf = (m) =>
    dayA.slots.filter((s) => byId(s.exerciseId).muscles[m] === 1).reduce((n, s) => n + s.sets, 0);
  assert.equal(setsOf(muscles[0]), plannedOf(muscles[0]) + 2);
  assert.equal(setsOf(muscles[1]), Math.max(1, plannedOf(muscles[1]) - 1));
  // Muscles without feedback met every target, so they gain a set.
  for (const m of muscles.slice(2)) assert.equal(setsOf(m), plannedOf(m) + 1, m);
  // Loads now progress from 60 at week-2 RIR.
  assert.equal(session.exercises[0].sets[0].targetRir, 2);
  assert.ok(session.exercises[0].sets[0].targetWeightKg >= 60);
  assert.notEqual(session.exercises[0].advice.kind, "first");
  workouts.discardWorkout(w2);

  // Jump to the deload week: half the sets, lighter loads, 4 RIR.
  const deloadWeek = programs.totalWeeks(detail) - 1;
  assert.ok(programs.isDeloadWeek(detail, deloadWeek));
  const wd = programs.startSession(detail, deloadWeek, dayA.id, context);
  const deload = workouts.workoutDetail(wd);
  assert.equal(deload.deload, true);
  const first = deload.exercises[0];
  assert.equal(first.advice.kind, "deload");
  assert.equal(first.sets[0].targetRir, 4);
  assert.ok(first.sets[0].targetWeightKg <= 60 * 0.9 + 0.01);
  const week1First = workouts.workoutDetail(w1).exercises[0].sets.length;
  assert.equal(first.sets.length, Math.max(1, Math.ceil(week1First / 2)));
  workouts.discardWorkout(wd);

  // Editing keeps surviving slots; ending finishes the program.
  const edited = programs.draftFrom(programs.programDetail(mesoId));
  edited.days[0].slots.pop();
  edited.days[0].name = "Monday";
  programs.updateProgram(mesoId, edited);
  detail = programs.programDetail(mesoId);
  assert.equal(detail.days[0].name, "Monday");
  assert.equal(detail.days[0].slots[0].id, dayA.slots[0].id);
  assert.equal(detail.days[0].slots.length, dayA.slots.length - 1);
  // Past sessions keep their exercises after the slot is gone.
  assert.equal(workouts.workoutDetail(w1).exercises.length, dayA.slots.length);
  programs.endProgram(mesoId);
  assert.equal(programs.activeMeso(), undefined);
});
