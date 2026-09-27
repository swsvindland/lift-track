const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load, lift } = require("./harness.cjs");

/* The phone's model reading a session note into bounded nudges, and the progression method
   applying them on top of its own answer. The model is faked; its replies are what matter. */

function setup() {
  const ctx = lift();
  const ai = load("src/lib/lift-ai.ts", {
    "./exercises": ctx.exercises,
    "./exercises/types": load("src/lib/exercises/types.ts"),
    "./program-text": load("src/lib/program-text.ts"),
    "./workout-text": load("src/lib/workout-text.ts"),
    "./metrics": ctx.metrics,
    "./program-builder": ctx.builder,
  });
  const byId = (id) => ctx.exercises.exerciseById(id, []);
  return { ...ctx, ai, byId };
}

const summary = {
  exercises: [
    { id: "barbell-bench-press", name: "Barbell Bench Press", muscles: ["chest"], sets: "100×8" },
    { id: "ez-bar-skull-crusher", name: "Skull Crusher", muscles: ["triceps"], sets: "30×10" },
  ],
  muscles: ["chest", "triceps"],
};

test("a note becomes bounded nudges, and anything else in the reply is dropped", async () => {
  const { ai } = setup();
  let asked;
  const reading = await ai.readSessionNote(
    "bench flew up, elbow cranky on skulls, chest is wrecked, slept 4 hours",
    summary,
    async (request) => {
      asked = request;
      return {
        exercises: [
          { number: 1, change: "push", reason: "Bench flew up" },
          { number: 2, change: "hold", reason: "Cranky elbow" },
          { number: 2, change: "push", reason: "duplicate" },
          { number: 9, change: "push", reason: "no such exercise" },
          { number: 1, change: "double it", reason: "not a choice" },
        ],
        muscles: [
          { muscle: "chest", change: "fewer", reason: "Chest is wrecked" },
          { muscle: "quads", change: "more", reason: "not trained" },
        ],
        tired: true,
      };
    }
  );
  assert.match(asked.prompt, /1\. Barbell Bench Press \(chest\): 100×8/);
  assert.deepEqual(asked.schema.properties.muscles.items.properties.muscle.enum, [
    "chest",
    "triceps",
  ]);
  assert.deepEqual(reading, {
    exercises: [
      { exerciseId: "barbell-bench-press", value: 1, reason: "Bench flew up" },
      { exerciseId: "ez-bar-skull-crusher", value: -1, reason: "Cranky elbow" },
    ],
    muscles: [{ muscle: "chest", value: -1, reason: "Chest is wrecked" }],
    tired: true,
  });
  // No model, or one that fails: nothing, and the note stands on its own.
  assert.equal(await ai.readSessionNote("bench flew up", summary), null);
  assert.equal(
    await ai.readSessionNote("bench flew up", summary, async () => {
      throw new Error("busy");
    }),
    null
  );
  assert.deepEqual(await ai.readSessionNote("  ", summary, async () => ({})), {
    exercises: [],
    muscles: [],
    tired: false,
  });
});

test("push counts last time a rep easier; hold repeats last time's targets", () => {
  const { progression, loads } = setup();
  const gym = loads.defaultGym("kg");
  const last = [
    { weightKg: 100, reps: 8, rir: null, targetWeightKg: 100, targetReps: 8, targetRir: 2 },
    { weightKg: 100, reps: 7, rir: null, targetWeightKg: 100, targetReps: 8, targetRir: 2 },
  ];
  const input = { exercise: { equipment: "barbell" }, gym, reps: [6, 10], rir: 2, sets: 2, last };
  const plain = progression.prescribe(input);
  const pushed = progression.prescribe({ ...input, nudge: 1 });
  const held = progression.prescribe({ ...input, nudge: -1 });
  const top = (p) => [p.sets[0].weightKg, p.sets[0].reps];
  // A missed set holds on its own; the push reads it as a rep easier, so it moves on.
  assert.ok(
    top(pushed)[0] > top(plain)[0] || top(pushed)[1] > top(plain)[1],
    JSON.stringify([top(plain), top(pushed)])
  );
  assert.deepEqual(
    held.sets.map((s) => [s.weightKg, s.reps]),
    [
      [100, 8],
      [100, 8],
    ]
  );
});

test("a session's nudges apply next time, show on the exercise, and undo cleanly", () => {
  const { programs, workouts, loads, byId } = setup();
  const context = { gym: { id: null, ...loads.defaultGym("kg") }, bodyWeightKg: 80, byId };
  const mesoId = programs.startProgram({
    name: "Push",
    rir: [3, 2, 2, 1],
    days: [
      {
        name: "Push",
        slots: [
          { exerciseId: "barbell-bench-press", sets: 3, reps: [6, 10] },
          { exerciseId: "ez-bar-skull-crusher", sets: 2, reps: [8, 12] },
        ],
      },
    ],
  });
  const detail = programs.programDetail(mesoId);
  const day = detail.days[0].id;
  const run = (week, reps) => {
    const id = programs.startSession(detail, week, day, context);
    for (const block of workouts.workoutDetail(id).exercises)
      for (const set of block.sets) {
        workouts.updateSet(set.id, { weightKg: 60, reps: reps ?? set.targetReps ?? 8 });
        workouts.completeSet(set.id);
      }
    workouts.finishWorkout(id);
    return id;
  };
  const w1 = run(0);
  // Chest: +1 set on its own for hitting every rep; the note takes one back. Bench pushed,
  // skull crushers held.
  workouts.saveNudges(w1, {
    exercises: [
      { exerciseId: "barbell-bench-press", value: 1, reason: "Bench flew up" },
      { exerciseId: "ez-bar-skull-crusher", value: -1, reason: "Cranky elbow" },
    ],
    muscles: [{ muscle: "chest", value: -1, reason: "Chest is wrecked" }],
    tired: false,
  });
  const plainNext = (() => {
    // What week 2 would be without the note, for comparison.
    const dismissed = workouts.nudgesFor(w1).map((n) => n.id);
    workouts.dismissNudges(dismissed);
    const id = programs.startSession(detail, 1, day, context);
    const out = workouts.workoutDetail(id).exercises.map((b) => ({
      sets: b.sets.length,
      top: [b.sets[0].targetWeightKg, b.sets[0].targetReps],
    }));
    workouts.discardWorkout(id);
    return out;
  })();
  // Bring the nudges back.
  workouts.saveNudges(w1, {
    exercises: [
      { exerciseId: "barbell-bench-press", value: 1, reason: "Bench flew up" },
      { exerciseId: "ez-bar-skull-crusher", value: -1, reason: "Cranky elbow" },
    ],
    muscles: [{ muscle: "chest", value: -1, reason: "Chest is wrecked" }],
    tired: false,
  });
  const w2 = programs.startSession(detail, 1, day, context);
  let session = workouts.workoutDetail(w2);
  const [bench, skulls] = session.exercises;
  assert.equal(bench.sets.length, plainNext[0].sets - 1, "chest lost the set it would have got");
  assert.equal(bench.advice.ai, 1);
  assert.equal(bench.advice.aiSets, -1);
  assert.equal(bench.advice.aiReason, "Bench flew up; Chest is wrecked");
  const benchTop = [bench.sets[0].targetWeightKg, bench.sets[0].targetReps];
  assert.ok(
    benchTop[0] > plainNext[0].top[0] || benchTop[1] > plainNext[0].top[1],
    "the push went further than the method alone"
  );
  assert.equal(skulls.advice.ai, -1);
  assert.deepEqual(
    [skulls.sets[0].targetWeightKg, skulls.sets[0].targetReps],
    [60, 10],
    "held at last time's targets"
  );

  // Undo on bench: the set comes back, the load goes back to the method's, the nudges are
  // dismissed and not applied again.
  programs.undoAi(bench.id, byId);
  session = workouts.workoutDetail(w2);
  const undone = session.exercises[0];
  assert.equal(undone.sets.length, plainNext[0].sets);
  assert.deepEqual([undone.sets[0].targetWeightKg, undone.sets[0].targetReps], plainNext[0].top);
  assert.equal(undone.advice.ai, undefined);
  assert.equal(undone.advice.aiReason, undefined);
  const live = workouts.nudgesFor(w1).filter((n) => !n.dismissed);
  assert.deepEqual(
    live.map((n) => n.exerciseId),
    ["ez-bar-skull-crusher"]
  );
});

test("on a rough day, exercises that fell behind hold instead of backing off", () => {
  const { workouts, exercises } = setup();
  const all = exercises.allExercises([]);
  const bench = all.find((e) => e.id === "barbell-bench-press");
  const row = all.find((e) => e.id === "barbell-row");
  // Last time: bench 100 × 10 and row 80 × 10.
  const first = workouts.startWorkout({ name: "Upper" });
  for (const exercise of [bench, row]) workouts.addExercise(first, exercise, 2);
  for (const [i, block] of workouts.workoutDetail(first).exercises.entries())
    for (const set of block.sets) {
      workouts.updateSet(set.id, { weightKg: i ? 80 : 100, reps: 10 });
      workouts.completeSet(set.id);
    }
  workouts.finishWorkout(first);
  // This time bench fell short of its targets (a step on), row kept up.
  const second = workouts.startWorkout({ name: "Upper", from: first });
  const missed = workouts
    .workoutDetail(second)
    .exercises[0].sets.map((s) => [s.targetWeightKg, s.targetReps]);
  for (const [i, block] of workouts.workoutDetail(second).exercises.entries())
    for (const set of block.sets) {
      if (i === 0) workouts.updateSet(set.id, { reps: 7 });
      workouts.completeSet(set.id);
    }
  workouts.finishWorkout(second);
  workouts.saveNudges(second, { exercises: [], muscles: [], tired: true });
  assert.deepEqual(
    workouts.nudgesFor(second).map((n) => [n.exerciseId, n.value]),
    [["barbell-bench-press", -1]]
  );
  // Next time bench is held at the targets it missed, not dropped below them.
  const third = workouts.startWorkout({ name: "Upper", from: second });
  const [b] = workouts.workoutDetail(third).exercises;
  assert.deepEqual(
    b.sets.map((s) => [s.targetWeightKg, s.targetReps]),
    missed
  );
  assert.equal(b.advice.aiReason, "Rough day: hold, don't back off");
});
