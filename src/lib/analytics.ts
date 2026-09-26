import { and, asc, gte, isNotNull } from "drizzle-orm";
import { db, workouts } from "@/db";
import type { Exercise } from "./exercises";
import type { Muscle } from "./exercises/types";
import { localDay } from "./metrics";
import { countsAsWork, e1rm, effectiveLoad } from "./strength";
import { setsPerMuscle, weekStart } from "./volume";
import { exerciseHistory, workoutDetail, type WorkoutDetail } from "./workouts";

/* Read-only summaries for Progress. Everything is computed from finished workouts on demand;
   nothing here is stored, so edits to history show up everywhere at once. */

const DAY = 86400000;

function finishedSince(fromIso: string): WorkoutDetail[] {
  return db
    .select({ id: workouts.id })
    .from(workouts)
    .where(and(isNotNull(workouts.endedAt), gte(workouts.startedAt, fromIso)))
    .orderBy(asc(workouts.startedAt))
    .all()
    .flatMap((w) => workoutDetail(w.id) ?? []);
}

export type WeekTotals = { workouts: number; sets: number; volumeKg: number; minutes: number };

function totals(list: WorkoutDetail[]): WeekTotals {
  let sets = 0;
  let volumeKg = 0;
  let minutes = 0;
  for (const w of list) {
    if (w.endedAt)
      minutes += Math.max(0, (Date.parse(w.endedAt) - Date.parse(w.startedAt)) / 60000);
    for (const block of w.exercises)
      for (const s of block.sets)
        if (s.completedAt && countsAsWork(s.kind)) {
          sets++;
          volumeKg += (s.weightKg ?? 0) * (s.reps ?? 0);
        }
  }
  return { workouts: list.length, sets, volumeKg, minutes: Math.round(minutes) };
}

export type WeeklyVolume = {
  /** Monday of each week, oldest first, as local days. */
  weeks: string[];
  /** Hard sets per muscle per week, aligned with `weeks`. */
  sets: Partial<Record<Muscle, number[]>>;
  totals: WeekTotals[];
};

/** Sets per muscle for the last `count` weeks, this week included. */
export function weeklyVolume(
  count: number,
  byId: (id: string) => Exercise,
  now = new Date()
): WeeklyVolume {
  const starts = Array.from({ length: count }, (_, i) => {
    const d = weekStart(now);
    d.setDate(d.getDate() - 7 * (count - 1 - i));
    return d;
  });
  const list = finishedSince(starts[0].toISOString());
  const byWeek = starts.map((start, i) => {
    const end = starts[i + 1]?.getTime() ?? Infinity;
    return list.filter((w) => {
      const t = Date.parse(w.startedAt);
      return t >= start.getTime() && t < end;
    });
  });
  const sets: Partial<Record<Muscle, number[]>> = {};
  byWeek.forEach((week, i) => {
    for (const [muscle, value] of Object.entries(setsPerMuscle(week, byId)) as [Muscle, number][]) {
      if (!value) continue;
      (sets[muscle] ??= Array(count).fill(0))[i] = value;
    }
  });
  return { weeks: starts.map((d) => localDay(d)), sets, totals: byWeek.map(totals) };
}

export type StrengthPoint = { day: string; e1rmKg: number; topKg: number; reps: number };

/**
 * Best estimated 1RM per day for an exercise, oldest first. Bodyweight and assisted
 * movements count the body weight recorded with the workout. Unrecorded reps in reserve count
 * as none, so estimates never assume effort that wasn't reported.
 */
export function strengthSeries(exercise: Exercise): StrengthPoint[] {
  return exerciseHistory(exercise.id, { limit: 1000 })
    .map((p) => {
      let best: StrengthPoint | null = null;
      for (const s of p.sets) {
        if (!countsAsWork(s.kind) || !s.reps) continue;
        const load = effectiveLoad(s.weightKg, exercise.load, p.bodyWeightKg);
        const value = e1rm(load, s.reps, s.rir);
        if (!best || value > best.e1rmKg)
          best = {
            day: localDay(new Date(p.startedAt)),
            e1rmKg: value,
            topKg: s.weightKg ?? 0,
            reps: s.reps,
          };
      }
      return best;
    })
    .filter((p): p is StrengthPoint => !!p && p.e1rmKg > 0)
    .reverse()
    .reduce<StrengthPoint[]>((days, point) => {
      // Two sessions on one day are one point: the day's best.
      const last = days.at(-1);
      if (last?.day !== point.day) days.push(point);
      else if (point.e1rmKg > last.e1rmKg) days[days.length - 1] = point;
      return days;
    }, []);
}

/** Exercises done most often lately, for the strength list. */
export function frequentExercises(days = 90, limit = 6, now = Date.now()): string[] {
  const counts = new Map<string, number>();
  for (const w of finishedSince(new Date(now - days * DAY).toISOString()))
    for (const id of new Set(w.exercises.map((b) => b.exerciseId)))
      counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);
}

export type RecordEvent = {
  day: string;
  workoutId: number;
  exerciseId: string;
  kind: "e1rm" | "weight";
  valueKg: number;
  previousKg: number;
};

/**
 * Every personal record in order: a session whose best estimated 1RM or heaviest load beats all
 * earlier sessions of that exercise. An exercise's first session sets a baseline, not a record.
 */
export function recordTimeline(byId: (id: string) => Exercise): RecordEvent[] {
  const best = new Map<string, { e1rm: number; weight: number }>();
  const events: RecordEvent[] = [];
  for (const w of finishedSince(new Date(0).toISOString())) {
    const session = new Map<string, { e1rm: number; weight: number }>();
    for (const block of w.exercises) {
      const exercise = byId(block.exerciseId);
      for (const s of block.sets) {
        if (!s.completedAt || !countsAsWork(s.kind) || !s.reps) continue;
        const load = effectiveLoad(s.weightKg, exercise.load, w.bodyWeightKg);
        const current = session.get(block.exerciseId) ?? { e1rm: 0, weight: 0 };
        session.set(block.exerciseId, {
          e1rm: Math.max(current.e1rm, e1rm(load, s.reps, s.rir)),
          weight: Math.max(current.weight, s.weightKg ?? 0),
        });
      }
    }
    const day = localDay(new Date(w.startedAt));
    for (const [exerciseId, now] of session) {
      const before = best.get(exerciseId);
      if (before) {
        if (now.e1rm > before.e1rm + 0.01)
          events.push({
            day,
            workoutId: w.id,
            exerciseId,
            kind: "e1rm",
            valueKg: now.e1rm,
            previousKg: before.e1rm,
          });
        if (now.weight > before.weight + 0.01)
          events.push({
            day,
            workoutId: w.id,
            exerciseId,
            kind: "weight",
            valueKg: now.weight,
            previousKg: before.weight,
          });
      }
      best.set(exerciseId, {
        e1rm: Math.max(before?.e1rm ?? 0, now.e1rm),
        weight: Math.max(before?.weight ?? 0, now.weight),
      });
    }
  }
  return events;
}
