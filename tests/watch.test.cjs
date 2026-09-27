const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load, lift } = require("./harness.cjs");

function setup() {
  const ctx = lift();
  const mod = load("src/lib/watch.ts", {
    "@/db": { db: ctx.db, ...ctx.schema },
    "./loads": ctx.loads,
    "./programs": ctx.programs,
    "./workouts": ctx.workouts,
  });
  const all = ctx.exercises.allExercises([]);
  const byId = (id) => all.find((e) => e.id === id);
  const context = {
    units: "metric",
    bodyWeightKg: 80,
    byId,
    exercises: all,
    settings: [],
    restFor: (e) => (e.pattern === "curl" ? 90 : 180),
  };
  return { ...ctx, watch: mod, all, byId, context };
}

test("the Watch logs and rates sets the way the phone does, and ignores repeats", () => {
  const { watch, workouts, byId, context } = setup();
  const nothing = watch.watchState(context, null, []);
  assert.equal(nothing.workout, null);
  assert.equal(nothing.start, null, "nothing to start: set it up on the phone");

  const id = workouts.startWorkout({ name: "Upper" });
  workouts.addExercise(id, byId("barbell-bench-press"));
  const curlBlock = workouts.addExercise(id, byId("db-curl"));
  workouts.addSet(curlBlock, "warmup");
  let state = watch.watchState(context, null, ["a"]);
  assert.equal(state.unit, "kg");
  assert.deepEqual(state.acked, ["a"]);
  const [bench, curl] = state.workout.exercises;
  assert.equal(bench.name, byId("barbell-bench-press").name);
  assert.equal(bench.rest, 180);
  assert.equal(bench.sets.length, 3);
  assert.equal(curl.sets[0].kind, "warmup");

  const [s1, s2] = bench.sets;
  const effect = watch.applyWatchCommand(
    { id: "1", type: "log", setId: s1.id, weightKg: 100, reps: 8 },
    context
  );
  assert.deepEqual(effect.rest, {
    seconds: 180,
    label: `Next: ${bench.name}`,
    setId: s1.id,
  });
  // Delivered twice (a message, then its fallback): logged once.
  assert.deepEqual(
    watch.applyWatchCommand({ id: "1", type: "log", setId: s1.id, weightKg: 90, reps: 3 }, context),
    {}
  );
  watch.applyWatchCommand({ id: "2", type: "rate", setId: s1.id, effort: "hard" }, context);
  state = watch.watchState(context, null, []);
  assert.deepEqual(state.workout.exercises[0].sets[0], {
    id: s1.id,
    kind: "working",
    weightKg: 100,
    reps: 8,
    done: true,
    effort: "hard",
  });
  // The next set starts from what was just done, as on the phone.
  assert.equal(state.workout.exercises[0].sets[1].weightKg, 100);
  assert.equal(state.workout.exercises[0].sets[1].id, s2.id);

  // The last bench set rests toward the curls; a warm-up has no rest.
  watch.applyWatchCommand({ id: "3", type: "log", setId: s2.id, weightKg: 100, reps: 8 }, context);
  const last = watch.applyWatchCommand(
    { id: "4", type: "log", setId: bench.sets[2].id, weightKg: 100, reps: 7 },
    context
  );
  assert.equal(last.rest.label, `Next: ${curl.name}`);
  assert.deepEqual(
    watch.applyWatchCommand(
      { id: "5", type: "log", setId: curl.sets[0].id, weightKg: 8, reps: 10 },
      context
    ),
    {}
  );
  assert.deepEqual(watch.applyWatchCommand({ id: "6", type: "skipRest" }, context), {
    stopRest: true,
  });
});

test("supersets rest after their last exercise only", () => {
  const { watch, workouts, byId, context } = setup();
  const id = workouts.startWorkout();
  const first = workouts.addExercise(id, byId("barbell-bench-press"));
  workouts.addExercise(id, byId("db-curl"));
  workouts.toggleSuperset(first);
  const [a, b] = watch.watchState(context, null, []).workout.exercises;
  assert.equal(a.rest, 0);
  assert.equal(b.rest, 90);
  assert.deepEqual(
    watch.applyWatchCommand(
      { id: "1", type: "log", setId: a.sets[0].id, weightKg: 60, reps: 10 },
      context
    ),
    {}
  );
  assert.equal(
    watch.applyWatchCommand(
      { id: "2", type: "log", setId: b.sets[0].id, weightKg: 10, reps: 12 },
      context
    ).rest.seconds,
    90
  );
});

test("Start on the Watch repeats the last workout or begins the program's next session", () => {
  const { watch, workouts, programs, builder, byId, all, context } = setup();
  const first = workouts.startWorkout({ name: "Pull" });
  const block = workouts.addExercise(first, byId("barbell-bench-press"));
  const set = workouts.workoutDetail(first).exercises[0].sets[0];
  workouts.updateSet(set.id, { weightKg: 60, reps: 10 });
  workouts.completeSet(set.id);
  workouts.finishWorkout(first);
  assert.ok(block);

  assert.deepEqual(watch.watchState(context, null, []).start, {
    title: "Pull",
    detail: "Repeat last workout",
  });
  assert.deepEqual(watch.applyWatchCommand({ id: "1", type: "start" }, context), { started: true });
  const repeat = workouts.activeWorkout();
  assert.equal(repeat.name, "Pull");
  // Start again (a retried message) keeps the same workout.
  assert.deepEqual(watch.applyWatchCommand({ id: "1", type: "start" }, context), {});
  assert.equal(workouts.activeWorkout().id, repeat.id);
  workouts.discardWorkout(repeat.id);

  const types = load("src/lib/exercises/types.ts");
  const draft = builder.buildProgram(
    {
      days: 3,
      minutes: 60,
      experience: "intermediate",
      weeks: 5,
      priorities: [],
      deprioritized: [],
      equipment: types.equipment,
      settings: [],
    },
    all
  );
  const mesoId = programs.startProgram(draft);
  const detail = programs.programDetail(mesoId);
  assert.deepEqual(watch.watchState(context, null, []).start, {
    title: detail.days[0].name,
    detail: `${detail.name} · Week 1`,
  });
  watch.applyWatchCommand({ id: "2", type: "start" }, context);
  const session = workouts.activeWorkout();
  assert.equal(session.mesoId, mesoId);
  assert.equal(session.mesoDayId, detail.days[0].id);
  const state = watch.watchState(context, null, []);
  assert.equal(state.start, null);
  assert.equal(state.workout.exercises.length, detail.days[0].slots.length);

  // Finish from the Watch: the clock stops and the questions wait on the phone.
  const opening = state.workout.exercises[0];
  for (const s of opening.sets)
    watch.applyWatchCommand(
      {
        id: `log-${s.id}`,
        type: "log",
        setId: s.id,
        weightKg: s.weightKg ?? 20,
        reps: s.reps ?? 10,
      },
      context
    );
  assert.deepEqual(
    watch.applyWatchCommand({ id: "3", type: "finish", workoutId: session.id + 1 }, context),
    {},
    "only the workout the Watch showed"
  );
  assert.deepEqual(
    watch.applyWatchCommand({ id: "4", type: "finish", workoutId: session.id }, context),
    { finished: session.id, stopRest: true }
  );
  assert.equal(workouts.activeWorkout(), undefined);
  assert.deepEqual(
    watch.applyWatchCommand({ id: "4", type: "finish", workoutId: session.id }, context),
    {}
  );
  assert.equal(programs.awaitingFeedback(byId).id, session.id);
  const [muscle] = programs.trainedMuscles(programs.awaitingFeedback(byId), byId);
  programs.saveFeedback(session.id, muscle, "good");
  assert.equal(programs.awaitingFeedback(byId), undefined, "answered");
  programs.saveFeedback(session.id, muscle, null);
  assert.equal(programs.awaitingFeedback(byId).id, session.id);
  programs.skipFeedback(session.id);
  assert.equal(programs.awaitingFeedback(byId), undefined, "skipped");
});

test("the crown steps through loads the gym can make, around the target", () => {
  const { watch, loads, byId } = setup();
  const gym = { ...loads.defaultGym("kg"), id: 1 };
  const bench = watch.crownLoads(byId("barbell-bench-press"), gym, "metric", 100);
  assert.ok(bench.includes(100));
  const at = bench.indexOf(100);
  assert.ok(bench[at + 1] > 100 && bench[at + 1] - 100 <= 2.5);
  assert.ok(bench.length <= 81);
  assert.ok(bench.every((k, i) => i === 0 || k > bench[i - 1]));
  // A load the gym can't make stays selectable.
  assert.ok(watch.crownLoads(byId("barbell-bench-press"), gym, "metric", 101.1).includes(101.1));
  // Without a gym: 5 lb steps in pounds.
  const lb = watch.crownLoads(byId("barbell-bench-press"), undefined, "imperial", 0);
  assert.ok(Math.abs(lb[1] - 5 * 0.45359237) < 1e-9);
  // Bodyweight moves can go back to no added load.
  const pullUp = byId("pull-up");
  assert.equal(watch.crownLoads(pullUp, gym, "metric", 10)[0], 0);
});

test("commands from the Watch are validated", () => {
  const { watch } = setup();
  assert.equal(watch.parseWatchCommand("nope"), undefined);
  assert.equal(watch.parseWatchCommand('{"id":"1","type":"finish"}'), undefined);
  assert.equal(
    watch.parseWatchCommand('{"id":"1","type":"log","setId":1,"weightKg":-5,"reps":8}'),
    undefined
  );
  assert.equal(
    watch.parseWatchCommand('{"id":"1","type":"rate","setId":1,"effort":"meh"}'),
    undefined
  );
  assert.deepEqual(watch.parseWatchCommand('{"id":"1","type":"rate","setId":1,"effort":null}'), {
    id: "1",
    type: "rate",
    setId: 1,
    effort: null,
  });
});
