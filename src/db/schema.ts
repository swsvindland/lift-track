import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { Equipment, Muscle, Pattern } from "@/lib/exercises/types";
import type { Advice } from "@/lib/progression";

export const weightEntries = sqliteTable("weight_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  weightKg: real("weight_kg").notNull(),
  measuredAt: text("measured_at").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export type WeightEntry = typeof weightEntries.$inferSelect;

export const preferences = sqliteTable("preferences", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// A mapping also remembers imported records after local deletion, so sync won't resurrect them.
export const healthLinks = sqliteTable("health_links", {
  key: text("key").primaryKey(),
  localKind: text("local_kind").notNull(),
  localId: integer("local_id").notNull(),
  remoteId: text("remote_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  origin: text("origin", { enum: ["local", "health"] }).notNull(),
});

/** Exercises the user made. Bundled ones live in code; both share one id space ("custom-…"). */
export const customExercises = sqliteTable("custom_exercises", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  equipment: text("equipment").$type<Equipment>().notNull(),
  pattern: text("pattern").$type<Pattern>().notNull(),
  muscles: text("muscles", { mode: "json" }).$type<Partial<Record<Muscle, 1 | 0.5>>>().notNull(),
  unilateral: integer("unilateral", { mode: "boolean" }).notNull().default(false),
  load: text("load").$type<"bodyweight" | "assisted">(),
  repMin: integer("rep_min").notNull(),
  repMax: integer("rep_max").notNull(),
  cue: text("cue").notNull().default(""),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  updatedAt: integer("updated_at").notNull(),
});
export type CustomExercise = typeof customExercises.$inferSelect;

/** Per-exercise preferences for bundled and custom exercises alike. */
export const exerciseSettings = sqliteTable("exercise_settings", {
  exerciseId: text("exercise_id").primaryKey(),
  favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
  /** Hurts or can't be done; left out of substitutions and generated programs. */
  avoid: integer("avoid", { mode: "boolean" }).notNull().default(false),
  restSeconds: integer("rest_seconds"),
  note: text("note").notNull().default(""),
});
export type ExerciseSetting = typeof exerciseSettings.$inferSelect;

/** Loads are stored in kg; a gym's plates and steps are kept in its own unit so 45 lb stays 45. */
export const gyms = sqliteTable("gyms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  unit: text("unit", { enum: ["kg", "lb"] }).notNull(),
  barWeight: real("bar_weight").notNull(),
  /** Plate sizes available, each assumed to come in pairs. */
  plates: text("plates", { mode: "json" }).$type<number[]>().notNull(),
  dumbbellStep: real("dumbbell_step").notNull(),
  dumbbellMax: real("dumbbell_max").notNull(),
  machineStep: real("machine_step").notNull(),
  equipment: text("equipment", { mode: "json" }).$type<Equipment[]>().notNull(),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
});
export type Gym = typeof gyms.$inferSelect;

/** A training block: accumulation weeks with falling reps in reserve, then a deload week. */
export const mesocycles = sqliteTable("mesocycles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  /** Reps in reserve per accumulation week; the deload week follows them. */
  rir: text("rir", { mode: "json" }).$type<number[]>().notNull(),
  deload: integer("deload", { mode: "boolean" }).notNull().default(true),
  /** Muscles brought down: they start at low volume and never gain sets week to week. */
  deprioritized: text("deprioritized", { mode: "json" }).$type<Muscle[]>().notNull().default([]),
  /** Progression method version, so later changes don't reinterpret old blocks. */
  method: integer("method").notNull(),
  status: text("status", { enum: ["active", "finished"] }).notNull(),
  startedAt: text("started_at").notNull(),
  endedAt: text("ended_at"),
});
export type Mesocycle = typeof mesocycles.$inferSelect;

export const mesoDays = sqliteTable(
  "meso_days",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    mesoId: integer("meso_id")
      .notNull()
      .references(() => mesocycles.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    name: text("name").notNull(),
  },
  (t) => [index("meso_days_meso").on(t.mesoId)]
);
export type MesoDay = typeof mesoDays.$inferSelect;

export const mesoSlots = sqliteTable(
  "meso_slots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dayId: integer("day_id")
      .notNull()
      .references(() => mesoDays.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    exerciseId: text("exercise_id").notNull(),
    /** Working sets in the first week; later weeks adjust from feedback and performance. */
    sets: integer("sets").notNull(),
    repMin: integer("rep_min").notNull(),
    repMax: integer("rep_max").notNull(),
  },
  (t) => [index("meso_slots_day").on(t.dayId)]
);
export type MesoSlot = typeof mesoSlots.$inferSelect;

/** Sessions deliberately skipped, so the plan moves on without inventing a workout. */
export const mesoSkips = sqliteTable("meso_skips", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  mesoId: integer("meso_id")
    .notNull()
    .references(() => mesocycles.id, { onDelete: "cascade" }),
  week: integer("week").notNull(),
  dayId: integer("day_id")
    .notNull()
    .references(() => mesoDays.id, { onDelete: "cascade" }),
});

export const feedbackRatings = ["easy", "good", "hard", "tooMuch", "pain"] as const;
export type FeedbackRating = (typeof feedbackRatings)[number];

/** How a muscle felt after a session; adjusts that day's sets next week. */
export const muscleFeedback = sqliteTable(
  "muscle_feedback",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workoutId: integer("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "cascade" }),
    muscle: text("muscle").$type<Muscle>().notNull(),
    rating: text("rating").$type<FeedbackRating>().notNull(),
  },
  (t) => [uniqueIndex("muscle_feedback_workout_muscle").on(t.workoutId, t.muscle)]
);
export type MuscleFeedback = typeof muscleFeedback.$inferSelect;

export const workouts = sqliteTable(
  "workouts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull().default(""),
    startedAt: text("started_at").notNull(),
    /** Null while the workout is in progress. At most one workout is open at a time. */
    endedAt: text("ended_at"),
    gymId: integer("gym_id").references(() => gyms.id, { onDelete: "set null" }),
    /** Body weight at the time, for bodyweight and assisted exercises. */
    bodyWeightKg: real("body_weight_kg"),
    /** Set when the workout is a session of a program; week 0 is the first. */
    mesoId: integer("meso_id").references(() => mesocycles.id, { onDelete: "set null" }),
    mesoWeek: integer("meso_week"),
    mesoDayId: integer("meso_day_id").references(() => mesoDays.id, { onDelete: "set null" }),
    deload: integer("deload", { mode: "boolean" }).notNull().default(false),
    note: text("note").notNull().default(""),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("workouts_started").on(t.startedAt)]
);
export type Workout = typeof workouts.$inferSelect;

export const workoutExercises = sqliteTable(
  "workout_exercises",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workoutId: integer("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "cascade" }),
    exerciseId: text("exercise_id").notNull(),
    position: integer("position").notNull(),
    /** Exercises sharing a group number are done as a superset. */
    supersetGroup: integer("superset_group"),
    repMin: integer("rep_min").notNull(),
    repMax: integer("rep_max").notNull(),
    note: text("note").notNull().default(""),
    /** The program slot this came from; null for exercises added on the day. */
    slotId: integer("slot_id").references(() => mesoSlots.id, { onDelete: "set null" }),
    /** Why the prescription is what it is, as structured data the screen formats. */
    advice: text("advice", { mode: "json" }).$type<Advice>(),
  },
  (t) => [
    index("workout_exercises_workout").on(t.workoutId),
    index("workout_exercises_exercise").on(t.exerciseId),
  ]
);
export type WorkoutExercise = typeof workoutExercises.$inferSelect;

export const setKinds = ["warmup", "working", "drop", "myo"] as const;
export type SetKind = (typeof setKinds)[number];

export const sets = sqliteTable(
  "sets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workoutExerciseId: integer("workout_exercise_id")
      .notNull()
      .references(() => workoutExercises.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    kind: text("kind").$type<SetKind>().notNull().default("working"),
    /** Added load for bodyweight exercises, assistance for assisted ones. */
    weightKg: real("weight_kg"),
    reps: integer("reps"),
    /** Reps in reserve as the lifter judged it; null when not recorded. */
    rir: real("rir"),
    side: text("side", { enum: ["left", "right"] }),
    /** Null until the set is checked off. */
    completedAt: text("completed_at"),
    /** What was prescribed, kept so history doesn't move when the method changes. */
    targetWeightKg: real("target_weight_kg"),
    targetReps: integer("target_reps"),
    targetRir: real("target_rir"),
  },
  (t) => [index("sets_workout_exercise").on(t.workoutExerciseId)]
);
export type WorkoutSet = typeof sets.$inferSelect;
