const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load, lift } = require("./harness.cjs");

const LB = 0.45359237;
const metrics = load("src/lib/metrics.ts");
const workoutText = load("src/lib/workout-text.ts");
const programText = load("src/lib/program-text.ts");
function ai() {
  const ctx = lift();
  const types = load("src/lib/exercises/types.ts");
  const mod = load("src/lib/lift-ai.ts", {
    "./exercises": ctx.exercises,
    "./exercises/types": types,
    "./program-text": programText,
    "./workout-text": workoutText,
    "./metrics": metrics,
  });
  return { ...ctx, ai: mod, all: ctx.exercises.allExercises([]) };
}
const reps = (e) => e.sets.map((s) => s.reps);

test("typed and dictated shorthand becomes sets", () => {
  const { exercises, unread } = workoutText.parseWorkoutText(
    "bench 225x5x3, incline db 30s for 12 12 10\npull ups bw 3x8 rir 2; lateral raise 3x15 @ 10 kg then leg press 8, 8, 7 at 300"
  );
  assert.deepEqual(unread, []);
  assert.deepEqual(
    exercises.map((e) => e.name),
    ["bench", "incline db", "pull ups", "lateral raise", "leg press"]
  );
  assert.deepEqual(
    exercises[0].sets,
    Array(3).fill({ weight: 225, unit: null, reps: 5, rir: null })
  );
  assert.deepEqual(reps(exercises[1]), [12, 12, 10]);
  assert.equal(exercises[1].sets[0].weight, 30);
  assert.deepEqual(exercises[2].sets[0], { weight: 0, unit: null, reps: 8, rir: 2 });
  assert.equal(exercises[2].sets.length, 3);
  assert.deepEqual(exercises[3].sets[0], { weight: 10, unit: "kg", reps: 15, rir: null });
  assert.deepEqual(reps(exercises[4]), [8, 8, 7]);
  const spoken = workoutText.parseWorkoutText("squat three sets of five at 100 kilos");
  assert.deepEqual(
    spoken.exercises[0].sets,
    Array(3).fill({ weight: 100, unit: "kg", reps: 5, rir: null })
  );
  const prose = workoutText.parseWorkoutText(
    "cable curls, the first two were 40 pounds for twelve"
  );
  assert.equal(prose.exercises.length, 0, "prose is left for the model");
  const loose = workoutText.parseWorkoutText("did some curls till failure");
  assert.equal(loose.exercises.length, 0);
  assert.equal(loose.unread.length, 1);
});

test("a written program becomes days, exercises, sets and rep ranges", () => {
  const { days, unread } = programText.parseProgramText(`
UPPER A
1. Bench Press 3x6-8
2) Chest-Supported Row: 3 sets of 8–12
• Lateral Raise 3 × 12-15
Rest 2 min between sets
Day 2 - Lower
Back Squat 4x5
Romanian Deadlift  3  8-10
Leg Curl 3 x 10 to 15
`);
  assert.deepEqual(
    days.map((d) => d.name),
    ["UPPER A", "Day 2 - Lower"]
  );
  assert.deepEqual(days[0].slots, [
    { name: "Bench Press", sets: 3, repMin: 6, repMax: 8 },
    { name: "Chest-Supported Row", sets: 3, repMin: 8, repMax: 12 },
    { name: "Lateral Raise", sets: 3, repMin: 12, repMax: 15 },
  ]);
  assert.deepEqual(days[1].slots[0], { name: "Back Squat", sets: 4, repMin: 5, repMax: 5 });
  assert.deepEqual(days[1].slots[1], { name: "Romanian Deadlift", sets: 3, repMin: 8, repMax: 10 });
  assert.deepEqual(days[1].slots[2], { name: "Leg Curl", sets: 3, repMin: 10, repMax: 15 });
  assert.deepEqual(unread, ["Rest 2 min between sets"]);
});

test("names match the library, with slang, and doubtful matches are flagged", () => {
  const { exercises } = lift();
  const all = exercises.allExercises([]);
  const m = (name) => exercises.matchExercise(all, name);
  assert.equal(m("bench").exercise.id, "barbell-bench-press");
  assert.equal(m("Bench Press").confident, true);
  assert.equal(m("RDL").exercise.pattern, "hinge");
  assert.equal(m("incline db").exercise.id, "db-incline-bench-press");
  assert.equal(m("lat pulldown").exercise.id, "lat-pulldown");
  assert.equal(m("Back Squat").exercise.pattern, "squat");
  assert.equal(m("pull ups").exercise.id, "pull-up");
  const odd = m("bench press heavy triples");
  assert.equal(odd.exercise.id, "barbell-bench-press");
  assert.equal(odd.confident, false);
  assert.equal(m("zzz").exercise, undefined);
  for (const id of Object.values(exercises.canonical))
    assert.ok(
      all.some((e) => e.id === id),
      id
    );
});

test("the model is asked only when shorthand leaves something unread, and its reply is checked", async () => {
  const { ai: liftAi, all } = ai();
  let asked = 0;
  const generate = async () => {
    asked++;
    return {
      exercises: [
        {
          name: "Barbell Curl",
          sets: [
            { weight: 30, unit: "kg", reps: 10, rir: 1 },
            { weight: 30, unit: "kg", reps: 9, rir: -1 },
          ],
        },
        { name: "", sets: [{ weight: 5, unit: "kg", reps: 5, rir: 0 }] },
        { name: "Plank", sets: [{ weight: 0, unit: "none", reps: 0, rir: -1 }] },
      ],
    };
  };
  const quick = await liftAi.readWorkout("bench 100x5x3", generate);
  assert.equal(asked, 0);
  assert.equal(quick.usedModel, false);
  const loose = await liftAi.readWorkout(
    "did barbell curls, 30 kilos, ten then nine, last one hard",
    generate
  );
  assert.equal(asked, 1);
  assert.equal(loose.usedModel, true);
  assert.equal(loose.exercises.length, 1, "unnamed and zero-rep items are dropped");
  assert.deepEqual(loose.exercises[0].sets[1], { weight: 30, unit: "kg", reps: 9, rir: null });
  const draft = liftAi.workoutDraft(loose, all, "imperial");
  assert.equal(draft[0].exercise.id, "barbell-curl");
  assert.equal(draft[0].sets[0].weightKg, 30);
  const lb = liftAi.workoutDraft(quick, all, "imperial");
  assert.ok(Math.abs(lb[0].sets[0].weightKg - 100 * LB) < 1e-9, "no unit means the user's unit");
  // Without a model the shorthand result stands, unread parts and all.
  const offline = await liftAi.readWorkout("did some curls", undefined);
  assert.equal(offline.exercises.length, 0);
  assert.equal(offline.unread.length, 1);
});

test("messy pages go to the model; hints read numbers directly and the rest from the model", async () => {
  const { ai: liftAi, all } = ai();
  const page = await liftAi.readProgram(
    "Mon  Bench  3  6  8  Row  3  10  Wed  Squat  5  5",
    async () => ({
      days: [
        {
          name: "Mon",
          exercises: [
            { name: "Bench", sets: 3, repMin: 8, repMax: 6 },
            { name: "Row", sets: 3, repMin: 10, repMax: 10 },
          ],
        },
        { name: "", exercises: [{ name: "Squat", sets: 5, repMin: 5, repMax: 5 }] },
        { name: "Empty", exercises: [] },
      ],
    })
  );
  assert.equal(page.usedModel, true);
  assert.deepEqual(
    page.days.map((d) => d.name),
    ["Mon", "Day 2"]
  );
  assert.deepEqual(page.days[0].slots[0], { name: "Bench", sets: 3, repMin: 6, repMax: 8 });

  const offline = await liftAi.readBuilderHints("4 days a week, about 50 minutes, 5 weeks");
  assert.deepEqual([offline.days, offline.minutes, offline.weeks], [4, 45, 5]);
  const hints = await liftAi.readBuilderHints(
    "an hour, only dumbbells at home, cranky left shoulder, want bigger arms",
    async () => ({
      days: 3,
      minutes: 0,
      experience: "unknown",
      priorities: ["biceps", "triceps", "not-a-muscle"],
      deprioritized: ["quads", "biceps"],
      equipment: ["dumbbell"],
      avoid: ["overhead press"],
    })
  );
  assert.equal(hints.days, 3);
  assert.equal(hints.minutes, 60);
  assert.equal(hints.experience, undefined);
  assert.deepEqual(hints.priorities, ["biceps", "triceps"]);
  assert.deepEqual(hints.deprioritized, ["quads"]);
  assert.deepEqual(hints.equipment, ["dumbbell", "bodyweight"]);
  assert.deepEqual(hints.avoid, ["overhead press"]);

  const found = await liftAi.describeExercise(
    "machine where you push your knees out",
    all,
    async () => ({
      pattern: "hipAbduction",
      muscles: ["glutes"],
      equipment: "machine",
    })
  );
  assert.equal(found[0].id, "hip-abduction-machine");
});

test("a failing model leaves the parsers' answer, and Apple gets complete schemas", async () => {
  const { ai: liftAi } = ai();
  const failing = async () => {
    throw new Error("ERR_LOCAL_AI_BUSY");
  };
  const read = await liftAi.readWorkout("bench 100x5x3, then some curls", failing);
  assert.equal(read.usedModel, false);
  assert.equal(read.exercises.length, 1);
  assert.deepEqual(read.unread, ["some curls"]);
  await assert.rejects(liftAi.readWorkout("did some curls", failing), /didn't answer/);
  await assert.rejects(liftAi.describeExercise("knees out machine", [], failing), /didn't answer/);
  const hints = await liftAi.readBuilderHints("3 days a week", failing);
  assert.equal(hints.days, 3);

  const localAi = load("src/lib/local-ai.ts", {
    "react-native": { Platform: { OS: "ios" } },
    expo: { requireOptionalNativeModule: () => null },
    "./model-json": load("src/lib/model-json.ts"),
  });
  const schema = localAi.appleSchema({
    type: "object",
    properties: {
      days: { type: "array", items: { type: "object", properties: { name: { type: "string" } } } },
    },
  });
  assert.equal(schema.title, "Reply");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema["x-order"], ["days"]);
  const item = schema.properties.days.items;
  assert.equal(item.title, "DaysItem");
  assert.deepEqual(item.required, ["name"]);
  assert.deepEqual(item["x-order"], ["name"]);
  assert.equal(
    localAi.linesToText([
      { text: "Bench", x: 0.1, y: 0.2, width: 0.2, height: 0.03 },
      { text: "3x8", x: 0.6, y: 0.205, width: 0.1, height: 0.03 },
      { text: "Day 1", x: 0.1, y: 0.1, width: 0.2, height: 0.03 },
    ]),
    "Day 1\nBench  3x8"
  );
});
