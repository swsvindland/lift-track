import { eq } from "drizzle-orm";
import { customExercises, db, exerciseSettings, type ExerciseSetting } from "@/db";
import { changed, useQuery } from "./data";
import { allExercises, exerciseById, type Exercise } from "./exercises";
import type { LibraryExercise } from "./exercises/types";

export function useExercises() {
  return useQuery(() => {
    const custom = db.select().from(customExercises).all();
    const settings = db.select().from(exerciseSettings).all();
    const all = allExercises(custom);
    const byId = new Map(all.map((e) => [e.id, e]));
    const settingFor = (id: string) => settings.find((s) => s.exerciseId === id);
    return {
      all,
      custom,
      settings,
      settingFor,
      byId: (id: string): Exercise =>
        byId.get(id) ??
        exerciseById(id, custom) ?? {
          // History can outlive a library entry; show it rather than crash.
          id,
          name: "Unknown exercise",
          equipment: "machine",
          pattern: "core",
          muscles: {},
          reps: [8, 12],
          cue: "",
        },
    };
  }, []);
}

export function saveExerciseSetting(
  exerciseId: string,
  patch: Partial<Omit<ExerciseSetting, "exerciseId">>
) {
  db.insert(exerciseSettings)
    .values({ exerciseId, ...patch })
    .onConflictDoUpdate({ target: exerciseSettings.exerciseId, set: patch })
    .run();
  changed();
}

export function saveCustomExercise(exercise: Omit<LibraryExercise, "id"> & { id?: string }) {
  const id =
    exercise.id ?? `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const row = {
    id,
    name: exercise.name.trim(),
    equipment: exercise.equipment,
    pattern: exercise.pattern,
    muscles: exercise.muscles,
    unilateral: !!exercise.unilateral,
    load: exercise.load ?? null,
    repMin: exercise.reps[0],
    repMax: exercise.reps[1],
    cue: exercise.cue,
    updatedAt: Date.now(),
  };
  db.insert(customExercises)
    .values(row)
    .onConflictDoUpdate({ target: customExercises.id, set: row })
    .run();
  changed();
  return id;
}

/** Custom exercises are archived, not deleted, because history refers to them. */
export function archiveCustomExercise(id: string, archived = true) {
  db.update(customExercises).set({ archived }).where(eq(customExercises.id, id)).run();
  changed();
}
