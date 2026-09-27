const { test } = require("node:test");
const assert = require("node:assert/strict");
const { lift, load } = require("./harness.cjs");

const LB = 0.45359237;
const types = load("src/lib/exercises/types.ts");

const builderInput = (gym, days = 4) => ({
  days,
  minutes: 60,
  experience: "intermediate",
  weeks: 5,
  priorities: [],
  deprioritized: [],
  equipment: gym.equipment,
  excluded: gym.excluded,
  included: gym.included,
  settings: [],
});

/** Checks off every open set at its target, or at `weightKg` when given. */
function finishAtTargets(workouts, workoutId, weightKg) {
  for (const block of workouts.workoutDetail(workoutId).exercises)
    for (const s of block.sets) {
      workouts.updateSet(s.id, { weightKg: weightKg ?? s.targetWeightKg ?? 20, rir: 2 });
      workouts.completeSet(s.id);
    }
  workouts.finishWorkout(workoutId);
}

test("gym presets are valid, and a gym's exceptions decide what it can do", () => {
  const { loads, exercises, library } = lift();
  const ids = new Set(library.map((e) => e.id));
  for (const kind of loads.gymKinds) {
    for (const unit of ["kg", "lb"]) {
      const gym = loads.presetGym(kind, unit);
      assert.ok(gym.equipment.length && gym.equipment.every((e) => types.equipment.includes(e)));
      for (const id of gym.excluded) assert.ok(ids.has(id), `${kind}: ${id}`);
      assert.ok(gym.dumbbellMax > 0 && gym.dumbbellMax % gym.dumbbellStep === 0, kind);
    }
  }
  const none = loads.presetGym("none", "kg");
  const all = exercises.allExercises([]);
  const doable = all.filter((e) => exercises.canDoAt(e, none));
  assert.ok(doable.length >= 10 && doable.every((e) => e.equipment === "bodyweight"));
  // No bar in the room: pull-ups and dips are out until you add them back.
  const pullUp = all.find((e) => e.id === "pull-up");
  assert.equal(exercises.canDoAt(pullUp, none), false);
  assert.equal(exercises.canDoAt(pullUp, { ...none, included: ["pull-up"] }), true);
  // A full gym without the leg press it would normally have.
  const full = loads.presetGym("full", "kg");
  const legPress = all.find((e) => e.id === "leg-press");
  assert.equal(exercises.canDoAt(legPress, full), true);
  assert.equal(exercises.canDoAt(legPress, { ...full, excluded: ["leg-press"] }), false);
});

test("a gym switched to the other unit keeps a small dumbbell rack small", () => {
  const { loads } = lift();
  const hotel = loads.presetGym("hotel", "lb");
  const kg = loads.convertGym(hotel, "kg");
  assert.equal(kg.unit, "kg");
  assert.equal(kg.barWeight, 20);
  // 50 lb is 22.7 kg: the nearest 2 kg step.
  assert.equal(kg.dumbbellMax, 22);
  assert.deepEqual(loads.convertGym(hotel, "lb").plates, hotel.plates);
});

test("programs built for each gym use only what it can do, and stay full", () => {
  const { builder, exercises, loads } = lift();
  const all = exercises.allExercises([]);
  const byId = new Map(all.map((e) => [e.id, e]));
  for (const kind of loads.gymKinds) {
    const gym = loads.presetGym(kind, "lb");
    for (const days of [3, 4]) {
      const draft = builder.buildProgram(builderInput(gym, days), all);
      for (const day of draft.days) {
        // A bodyweight-only gym has no rows or curls, so its upper days run shorter.
        assert.ok(day.slots.length >= (kind === "none" ? 3 : 6), `${kind} ${day.name}`);
        for (const slot of day.slots)
          assert.ok(
            exercises.canDoAt(byId.get(slot.exerciseId), gym),
            `${kind}: ${slot.exerciseId}`
          );
      }
    }
  }
  // Leaving out the leg press and hack squat keeps them out; adding a cable station lets it in.
  const home = loads.presetGym("home", "kg");
  const custom = { ...home, included: ["cable-lateral-raise-single"] };
  const draft = builder.buildProgram(builderInput(custom), all);
  const chosen = draft.days.flatMap((d) => d.slots.map((s) => s.exerciseId));
  assert.ok(chosen.includes("cable-lateral-raise-single"));
  const full = { ...loads.presetGym("full", "kg"), excluded: ["leg-press", "hack-squat"] };
  const noPress = builder.buildProgram(builderInput(full), all);
  const picked = noPress.days.flatMap((d) => d.slots.map((s) => s.exerciseId));
  assert.ok(!picked.includes("leg-press") && !picked.includes("hack-squat"));
});

test("stand-ins keep a day's movements at a smaller gym without doubling up", () => {
  const { exercises, loads } = lift();
  const all = exercises.allExercises([]);
  const byId = (id) => all.find((e) => e.id === id);
  const hotel = loads.presetGym("hotel", "lb");
  const day = [
    "barbell-bench-press",
    "db-bench-press",
    "lat-pulldown",
    "leg-press",
    "db-lateral-raise",
  ];
  const out = exercises.standIns(day.map(byId), all, hotel);
  assert.equal(out.length, day.length);
  // What the hotel has stays put; the rest become dumbbell or bodyweight moves.
  assert.equal(out[1].id, "db-bench-press");
  assert.equal(out[4].id, "db-lateral-raise");
  assert.ok(out.every((e) => exercises.canDoAt(e, hotel)));
  assert.equal(new Set(out.map((e) => e.id)).size, out.length);
  assert.equal(out[0].pattern, "horizontalPress");
  assert.ok(out[2].muscles.lats === 1);
  assert.ok(out[3].muscles.quads === 1);
  // Nothing in a bare room rows like a cable row: it stays, for the lifter to swap or skip.
  const none = loads.presetGym("none", "kg");
  assert.equal(exercises.standIns([byId("cable-row")], all, none)[0].id, "cable-row");
  // Avoided exercises never stand in.
  const avoided = exercises.standIns([byId("barbell-bench-press")], all, hotel, [
    { exerciseId: out[0].id, avoid: true, favorite: false },
  ]);
  assert.notEqual(avoided[0].id, out[0].id);
});

test("gyms: a main gym, adding, removing, and a trip that ends on its own", () => {
  const { workouts, loads } = lift();
  const home = workouts.activeGym("imperial");
  const hotel = workouts.addGym(loads.presetGym("hotel", "lb"));
  assert.equal(workouts.listGyms("imperial").length, 2);
  assert.equal(workouts.trainingGym("imperial").gym.id, home.id);
  // A program's gym wins over the main one while you're home.
  assert.equal(workouts.trainingGym("imperial", hotel).gym.id, hotel);
  workouts.setMainGym(hotel);
  assert.equal(workouts.activeGym("imperial").id, hotel);
  workouts.setMainGym(home.id);

  const metrics = load("src/lib/metrics.ts");
  const today = metrics.localDay();
  const yesterday = metrics.localDay(new Date(Date.now() - 86400000));
  workouts.startTravel(hotel, today);
  assert.deepEqual(workouts.trainingGym("imperial", home.id), {
    gym: workouts.gymById(hotel),
    travel: true,
  });
  assert.equal(workouts.travelPlan().until, today);
  // The last day is inclusive; the day after, you're home without doing anything.
  workouts.startTravel(hotel, yesterday);
  assert.equal(workouts.travelPlan(), undefined);
  assert.equal(workouts.trainingGym("imperial").travel, false);
  workouts.startTravel(hotel, today);
  workouts.endTravel();
  assert.equal(workouts.travelPlan(), undefined);

  // Removing the trip's gym ends the trip; the last gym can't go.
  workouts.startTravel(hotel, today);
  assert.equal(workouts.archiveGym(hotel), true);
  assert.equal(workouts.travelPlan(), undefined);
  assert.deepEqual(
    workouts.listGyms("imperial").map((g) => g.id),
    [home.id]
  );
  assert.equal(workouts.archiveGym(home.id), false);
});

test("a week at a hotel adapts the program, and home loads pick up where they left off", () => {
  const { programs, builder, exercises, workouts, loads, db, schema } = lift();
  const all = exercises.allExercises([]);
  const byId = (id) => all.find((e) => e.id === id);
  const home = db.insert(schema.gyms).values(loads.defaultGym("lb")).returning().get();
  const hotelGym = loads.presetGym("hotel", "lb");
  const hotel = workouts.gymById(workouts.addGym(hotelGym));
  const draft = builder.buildProgram(builderInput(loads.presetGym("full", "lb"), 4), all);
  const mesoId = programs.startProgram({ ...draft, gymId: home.id });
  const detail = programs.programDetail(mesoId);
  assert.equal(detail.gymId, home.id);
  assert.equal(programs.draftFrom(detail).gymId, home.id);
  const upper = detail.days[0];
  const context = { gym: home, bodyWeightKg: 80, byId, exercises: all, settings: [] };

  // Week 1 at home: heavy dumbbell bench and a barbell bench, done at 2 RIR.
  const w1 = programs.startSession(detail, 0, upper.id, context);
  const week1 = workouts.workoutDetail(w1);
  assert.deepEqual(
    week1.exercises.map((b) => b.exerciseId),
    upper.slots.map((s) => s.exerciseId)
  );
  const homeLoad = 100 * LB;
  for (const block of week1.exercises)
    for (const s of block.sets) {
      workouts.updateSet(s.id, { weightKg: homeLoad, reps: 8, rir: 2 });
      workouts.completeSet(s.id);
    }
  workouts.finishWorkout(w1);
  for (const day of detail.days.slice(1)) programs.skipSession(mesoId, 0, day.id);

  // Week 2 at the hotel: every exercise is one it can do, in the same slots, marked as travel.
  const away = { ...context, gym: hotel, travel: true };
  const w2 = programs.startSession(detail, 1, upper.id, away);
  const week2 = workouts.workoutDetail(w2);
  assert.equal(week2.travel, true);
  assert.equal(week2.gymId, hotel.id);
  assert.deepEqual(
    week2.exercises.map((b) => b.slotId),
    upper.slots.map((s) => s.id)
  );
  for (const block of week2.exercises) {
    assert.ok(exercises.canDoAt(byId(block.exerciseId), hotelGym), block.exerciseId);
    // Loads come from the hotel's rack: nothing past its heaviest dumbbell.
    for (const s of block.sets)
      if (byId(block.exerciseId).equipment === "dumbbell" && s.targetWeightKg)
        assert.ok(s.targetWeightKg <= hotelGym.dumbbellMax * LB + 1e-6, block.exerciseId);
  }
  // Sets carry through: the trip keeps the program's volume moving.
  const plannedSets = (w) =>
    workouts
      .workoutDetail(w)
      .exercises.map((b) => b.sets.filter((s) => s.kind === "working").length);
  assert.ok(plannedSets(w2).reduce((a, b) => a + b) >= plannedSets(w1).reduce((a, b) => a + b));
  // Lighter work at the hotel...
  finishAtTargets(workouts, w2, 20 * LB);
  for (const day of detail.days.slice(1)) programs.skipSession(mesoId, 1, day.id);

  // ...doesn't pull home loads down: back home, week 3 builds on week 1.
  const w3 = programs.startSession(detail, 2, upper.id, context);
  const week3 = workouts.workoutDetail(w3);
  assert.equal(week3.travel, false);
  assert.deepEqual(
    week3.exercises.map((b) => b.exerciseId),
    upper.slots.map((s) => s.exerciseId)
  );
  for (const block of week3.exercises) {
    const exercise = byId(block.exerciseId);
    if (exercise.load) continue;
    const target = block.sets[0].targetWeightKg;
    assert.ok(target >= homeLoad * 0.85, `${block.exerciseId}: ${target / LB} lb`);
  }
});

test("on the next trip, a stand-in's load comes from the last trip, not from home", () => {
  const { programs, builder, exercises, workouts, loads, db, schema } = lift();
  const all = exercises.allExercises([]);
  const byId = (id) => all.find((e) => e.id === id);
  const home = db.insert(schema.gyms).values(loads.defaultGym("kg")).returning().get();
  const hotel = workouts.gymById(workouts.addGym(loads.presetGym("hotel", "kg")));
  const draft = builder.buildProgram(builderInput(loads.presetGym("full", "kg"), 3), all);
  const detail = programs.programDetail(programs.startProgram({ ...draft, gymId: home.id }));
  const day = detail.days[0];
  const away = { gym: hotel, travel: true, bodyWeightKg: 80, byId, exercises: all };
  // A first trip: the barbell bench becomes a dumbbell bench, done with 20 kg dumbbells.
  const w1 = programs.startSession(detail, 0, day.id, away);
  assert.ok(workouts.workoutDetail(w1).exercises.some((b) => b.exerciseId === "db-bench-press"));
  finishAtTargets(workouts, w1, 20);
  // Meanwhile at home, 40 kg dumbbells.
  const w2 = workouts.startWorkout({ gymId: home.id });
  workouts.addExercise(w2, byId("db-bench-press"), 1);
  finishAtTargets(workouts, w2, 40);
  // On the next trip, the hotel's own history sets the load, not the heavier home one.
  assert.equal(programs.lastComparable("db-bench-press", undefined, true)[0].weightKg, 20);
  assert.equal(programs.lastComparable("db-bench-press")[0].weightKg, 40);
  programs.skipSession(detail.id, 0, detail.days[1].id);
  programs.skipSession(detail.id, 0, detail.days[2].id);
  const w3 = programs.startSession(detail, 1, day.id, away);
  const next = workouts.workoutDetail(w3).exercises.find((b) => b.exerciseId === "db-bench-press");
  assert.ok(next.sets[0].targetWeightKg <= 24, `${next.sets[0].targetWeightKg} kg`);
});
