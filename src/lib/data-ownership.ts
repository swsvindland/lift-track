import { asc, sql } from "drizzle-orm";
import {
  aiNudges,
  customExercises,
  db,
  exerciseSettings,
  gyms,
  healthLinks,
  mesoDays,
  mesoSkips,
  mesoSlots,
  mesocycles,
  muscleFeedback,
  preferences,
  sets,
  weightEntries,
  workoutExercises,
  workouts,
} from "@/db";
import { LB } from "./metrics";

function cell(value: unknown) {
  let text = value == null ? "" : String(value);
  // User-entered names must not turn into spreadsheet formulas.
  if (typeof value === "string" && /^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
export function csv(rows: unknown[][]) {
  return "﻿" + rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
const pounds = (kg: number | null) => (kg === null ? null : Math.round((kg / LB) * 100) / 100);

/**
 * One row per completed set, oldest first: when, which workout and exercise, what was done and
 * what was prescribed. Loads are in kg and lb; bodyweight exercises list added load.
 */
export function exportSetsCsv(exerciseName: (id: string) => string) {
  return db.transaction((tx) => {
    const programs = new Map(
      tx
        .select()
        .from(mesocycles)
        .all()
        .map((m) => [m.id, m.name])
    );
    const rows = tx
      .select({ workout: workouts, block: workoutExercises, set: sets })
      .from(sets)
      .innerJoin(workoutExercises, sql`${workoutExercises.id} = ${sets.workoutExerciseId}`)
      .innerJoin(workouts, sql`${workouts.id} = ${workoutExercises.workoutId}`)
      .where(sql`${workouts.endedAt} IS NOT NULL AND ${sets.completedAt} IS NOT NULL`)
      .orderBy(asc(workouts.startedAt), asc(workoutExercises.position), asc(sets.position))
      .all();
    return csv([
      [
        "workout_started_at",
        "workout",
        "program",
        "program_week",
        "exercise",
        "exercise_id",
        "set_type",
        "load_kg",
        "load_lb",
        "reps",
        "rir",
        "effort",
        "target_load_kg",
        "target_reps",
        "target_rir",
        "completed_at",
      ],
      ...rows.map(({ workout, block, set }) => [
        workout.startedAt,
        workout.name,
        workout.mesoId ? programs.get(workout.mesoId) : "",
        workout.mesoWeek !== null ? (workout.deload ? "deload" : workout.mesoWeek + 1) : "",
        exerciseName(block.exerciseId),
        block.exerciseId,
        set.kind,
        set.weightKg,
        pounds(set.weightKg),
        set.reps,
        set.rir,
        set.effort,
        set.targetWeightKg,
        set.targetReps,
        set.targetRir,
        set.completedAt,
      ]),
    ]);
  });
}

export function exportWeightCsv() {
  return csv([
    ["measured_at", "weight_kg", "weight_lb"],
    ...db
      .select()
      .from(weightEntries)
      .orderBy(weightEntries.measuredAt)
      .all()
      .map((row) => [row.measuredAt, row.weightKg, pounds(row.weightKg)]),
  ]);
}

/** Call only while Health sync is paused, after an explicit confirmation. */
export function erasePersonalRecords() {
  // Deleted rows are overwritten instead of left readable in free pages. Pragmas that return a
  // row go through `all`, which steps them to completion; VACUUM refuses to run past an open one.
  db.all(sql`PRAGMA secure_delete = ON`);
  db.transaction((tx) => {
    for (const table of [
      aiNudges,
      muscleFeedback,
      sets,
      workoutExercises,
      workouts,
      mesoSkips,
      mesoSlots,
      mesoDays,
      mesocycles,
      gyms,
      exerciseSettings,
      customExercises,
      weightEntries,
      healthLinks,
      preferences,
    ])
      tx.delete(table).run();
    tx.insert(preferences).values({ key: "healthSyncEnabled", value: "false" }).run();
  });
  // The erase has committed; a full disk here must not report it as failed.
  try {
    db.run(sql`VACUUM`);
  } catch (error) {
    console.warn("Could not compact the database after erasing", error);
  }
  try {
    db.all(sql`PRAGMA wal_checkpoint(TRUNCATE)`);
  } catch (error) {
    console.warn("Could not checkpoint the database after erasing", error);
  }
}
