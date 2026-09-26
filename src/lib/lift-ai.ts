import type { Exercise } from "./exercises";
import { matchExercise } from "./exercises";
import {
  equipment,
  muscles,
  patterns,
  type Equipment,
  type Muscle,
  type Pattern,
} from "./exercises/types";
import type { Experience } from "./program-builder";
import type { JsonSchema } from "./model-json";
import { parseProgramText, type ParsedProgram } from "./program-text";
import { toKg, type Units } from "./metrics";
import { parseWorkoutText, type LoadUnit, type ParsedWorkout } from "./workout-text";

/* What the on-device model is asked, and how its replies become drafts. The deterministic
   parsers answer first; the model is asked only when they leave something unread. Loads,
   progression and programming never come from the model: it only turns words into structure,
   and the person confirms every draft. */

export type Generate = (request: {
  instructions: string;
  prompt: string;
  schema: JsonSchema;
  maxTokens?: number;
}) => Promise<unknown>;

/** Thrown when the model was needed and didn't answer, so the screen can say so plainly. */
export class ModelUnavailableError extends Error {
  constructor() {
    super("The on-device model didn't answer. Shorthand still works, like “bench 225x5x3”.");
  }
}

/** A model that fails (busy, declined, too long) leaves the parsers' answer standing. */
async function tryGenerate(generate: Generate, request: Parameters<Generate>[0]): Promise<unknown> {
  try {
    return await generate(request);
  } catch (error) {
    if (typeof __DEV__ !== "undefined" && __DEV__) console.warn("On-device model failed", error);
    return null;
  }
}

const clampText = (text: string, max = 2500) => (text.length > max ? text.slice(0, max) : text);
const int = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : null;
const str = (v: unknown, max = 80) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// ——— A workout from words ———

const workoutSchema: JsonSchema = {
  type: "object",
  properties: {
    exercises: {
      type: "array",
      maxItems: 15,
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "exercise name as a lifter would write it" },
          sets: {
            type: "array",
            maxItems: 12,
            items: {
              type: "object",
              properties: {
                weight: { type: "number", description: "load per set; 0 for bodyweight" },
                unit: { type: "string", enum: ["kg", "lb", "none"] },
                reps: { type: "integer", minimum: 1, maximum: 100 },
                rir: {
                  type: "integer",
                  minimum: -1,
                  maximum: 10,
                  description: "reps in reserve, -1 if not said",
                },
              },
              required: ["weight", "unit", "reps", "rir"],
            },
          },
        },
        required: ["name", "sets"],
      },
    },
  },
  required: ["exercises"],
};

function readWorkoutReply(reply: unknown): ParsedWorkout {
  const list = (reply as { exercises?: unknown[] })?.exercises;
  const exercises = (Array.isArray(list) ? list : []).flatMap((item) => {
    const e = item as { name?: unknown; sets?: unknown[] };
    const name = str(e.name);
    const sets = (Array.isArray(e.sets) ? e.sets : []).flatMap((raw) => {
      const s = raw as { weight?: unknown; unit?: unknown; reps?: unknown; rir?: unknown };
      const reps = typeof s.reps === "number" && s.reps >= 1 ? int(s.reps, 1, 100) : null;
      const weight =
        typeof s.weight === "number" && s.weight >= 0 && s.weight <= 1000 ? s.weight : null;
      const rir = int(s.rir, -1, 10);
      if (!reps) return [];
      return [
        {
          weight,
          unit: s.unit === "kg" || s.unit === "lb" ? (s.unit as LoadUnit) : null,
          reps,
          rir: rir === null || rir < 0 ? null : rir,
        },
      ];
    });
    return name && sets.length ? [{ name, sets: sets.slice(0, 12) }] : [];
  });
  return { exercises: exercises.slice(0, 15), unread: [] };
}

/** Shorthand is read directly; anything left over goes to the model when there is one. */
export async function readWorkout(
  text: string,
  generate?: Generate
): Promise<ParsedWorkout & { usedModel: boolean }> {
  const direct = parseWorkoutText(text);
  if ((!direct.unread.length && direct.exercises.length) || !generate)
    return { ...direct, usedModel: false };
  const reply = await tryGenerate(generate, {
    instructions:
      "You turn a weightlifter's description of a workout into structured sets. Use only what the text says. Expand shorthand like 225x5x3 (load 225, 5 reps, 3 sets) and 3x10 @ 50 (3 sets of 10 at 50). Never invent exercises, loads or reps.",
    prompt: `Workout:\n${clampText(text)}`,
    schema: workoutSchema,
    maxTokens: 900,
  });
  if (reply === null && !direct.exercises.length) throw new ModelUnavailableError();
  const read = readWorkoutReply(reply);
  return read.exercises.length ? { ...read, usedModel: true } : { ...direct, usedModel: false };
}

export type WorkoutDraftItem = {
  said: string;
  exercise: Exercise | undefined;
  confident: boolean;
  sets: { weightKg: number | null; reps: number; rir: number | null }[];
};

/** Matches each said exercise to the library and converts loads to kg. */
export function workoutDraft(
  parsed: ParsedWorkout,
  exercises: Exercise[],
  units: Units,
  boost?: (e: Exercise) => number
): WorkoutDraftItem[] {
  return parsed.exercises.map((e) => {
    const { exercise, confident } = matchExercise(exercises, e.name, boost);
    return {
      said: e.name,
      exercise,
      confident,
      sets: e.sets.map((s) => ({
        weightKg:
          s.weight === null
            ? null
            : s.unit
              ? toKg(s.weight, s.unit === "kg" ? "metric" : "imperial")
              : toKg(s.weight, units),
        reps: s.reps,
        rir: s.rir,
      })),
    };
  });
}

// ——— A program from a page ———

const programSchema: JsonSchema = {
  type: "object",
  properties: {
    days: {
      type: "array",
      maxItems: 7,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          exercises: {
            type: "array",
            maxItems: 12,
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                sets: { type: "integer", minimum: 1, maximum: 10 },
                repMin: { type: "integer", minimum: 1, maximum: 100 },
                repMax: { type: "integer", minimum: 1, maximum: 100 },
              },
              required: ["name", "sets", "repMin", "repMax"],
            },
          },
        },
        required: ["name", "exercises"],
      },
    },
  },
  required: ["days"],
};

function readProgramReply(reply: unknown): ParsedProgram {
  const list = (reply as { days?: unknown[] })?.days;
  const days = (Array.isArray(list) ? list : []).flatMap((raw, i) => {
    const d = raw as { name?: unknown; exercises?: unknown[] };
    const slots = (Array.isArray(d.exercises) ? d.exercises : []).flatMap((x) => {
      const e = x as { name?: unknown; sets?: unknown; repMin?: unknown; repMax?: unknown };
      const name = str(e.name);
      // A day's label read as an exercise ("push") isn't one.
      if (/^(push|pull|legs?|upper|lower|full body|arms|day \d+)$/i.test(name)) return [];
      const sets = int(e.sets, 1, 10);
      const a = int(e.repMin, 1, 100);
      const b = int(e.repMax, 1, 100) ?? a;
      return name && sets && a && b
        ? [{ name, sets, repMin: Math.min(a, b), repMax: Math.max(a, b) }]
        : [];
    });
    return slots.length
      ? [{ name: str(d.name, 40) || `Day ${i + 1}`, slots: slots.slice(0, 12) }]
      : [];
  });
  return { days: days.slice(0, 7), unread: [] };
}

/** A clean list is read directly; a messy page (OCR columns, prose) goes to the model. */
export async function readProgram(
  text: string,
  generate?: Generate
): Promise<ParsedProgram & { usedModel: boolean }> {
  const direct = parseProgramText(text);
  const slots = direct.days.reduce((n, d) => n + d.slots.length, 0);
  const messy = !slots || direct.unread.length > slots;
  if (!messy || !generate) return { ...direct, usedModel: false };
  const reply = await tryGenerate(generate, {
    instructions:
      "You read a written weightlifting program and list its training days and exercises with sets and a rep range. A day's heading is its name, not an exercise. A single rep target means repMin equals repMax. Skip warm-ups, notes and rest times. Never invent exercises.",
    prompt: `Program:\n${clampText(text, 3000)}`,
    schema: programSchema,
    maxTokens: 1500,
  });
  if (reply === null && !direct.days.length) throw new ModelUnavailableError();
  const read = readProgramReply(reply);
  return read.days.length ? { ...read, usedModel: true } : { ...direct, usedModel: false };
}

// ——— What someone wants from a program ———

export type BuilderHints = {
  days?: number;
  minutes?: 45 | 60 | 75 | 90;
  experience?: Experience;
  weeks?: number;
  priorities: Muscle[];
  equipment?: Equipment[];
  avoid: string[];
};

const hintsSchema: JsonSchema = {
  type: "object",
  properties: {
    days: {
      type: "integer",
      minimum: 0,
      maximum: 6,
      description: "training days a week, 0 if not said",
    },
    minutes: {
      type: "integer",
      minimum: 0,
      maximum: 120,
      description: "minutes a session, 0 if not said",
    },
    experience: { type: "string", enum: ["unknown", "beginner", "intermediate", "advanced"] },
    priorities: { type: "array", maxItems: 3, items: { type: "string", enum: [...muscles] } },
    equipment: {
      type: "array",
      description: "equipment they have, empty if not said",
      items: { type: "string", enum: [...equipment] },
    },
    avoid: {
      type: "array",
      maxItems: 6,
      items: { type: "string" },
      description: "exercises or movements to avoid",
    },
  },
  required: ["days", "minutes", "experience", "priorities", "equipment", "avoid"],
};

const snapMinutes = (m: number) =>
  ([45, 60, 75, 90] as const).reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a));

/** Numbers are read directly; muscles, equipment and injuries need the model. */
export async function readBuilderHints(text: string, generate?: Generate): Promise<BuilderHints> {
  const lower = text.toLowerCase();
  const hints: BuilderHints = { priorities: [], avoid: [] };
  const days = /(\d)\s*(?:days?|x|times)\s*(?:a|per|\/)?\s*week/.exec(lower);
  if (days) hints.days = Math.min(6, Math.max(2, +days[1]));
  const minutes =
    /(\d{2,3})\s*(?:min|minutes)/.exec(lower) ??
    (/(an?|one)\s*hour/.test(lower) ? ["", "60"] : null);
  if (minutes) hints.minutes = snapMinutes(+minutes[1]);
  const weeks = /(\d)\s*weeks?/.exec(lower);
  if (weeks) hints.weeks = Math.min(6, Math.max(4, +weeks[1]));
  if (/\b(beginner|new to|just start)/.test(lower)) hints.experience = "beginner";
  if (!generate) return hints;
  const reply = (await tryGenerate(generate, {
    instructions:
      "You read what someone wants from a weightlifting program. Fill only what they said; use 0, 'unknown' or empty lists otherwise. Priorities are muscles they want to grow; 'delts' or 'shoulders' means sideDelts, 'arms' means biceps and triceps, 'back' means lats and upperBack. Equipment lists only what they say they have. Avoid lists exercises or movements that hurt or that they can't do.",
    prompt: `They said:\n${clampText(text, 1000)}`,
    schema: hintsSchema,
    maxTokens: 400,
  })) as Record<string, unknown>;
  const d = int(reply?.days, 0, 6);
  if (d && d >= 2 && !hints.days) hints.days = d;
  const m = int(reply?.minutes, 0, 120);
  if (m && !hints.minutes) hints.minutes = snapMinutes(m);
  if (
    !hints.experience &&
    ["beginner", "intermediate", "advanced"].includes(reply?.experience as string)
  )
    hints.experience = reply.experience as Experience;
  const known = <T extends string>(list: readonly T[], v: unknown) =>
    (Array.isArray(v) ? v : []).filter((x): x is T => list.includes(x as T));
  hints.priorities = known(muscles, reply?.priorities).slice(0, 3);
  const kit = known(equipment, reply?.equipment);
  // Bodyweight is always available; a list of what they have narrows the rest.
  if (kit.length) hints.equipment = [...new Set([...kit, "bodyweight" as const])];
  hints.avoid = (Array.isArray(reply?.avoid) ? reply.avoid : [])
    .map((a) => str(a, 60))
    .filter(Boolean)
    .slice(0, 6);
  return hints;
}

// ——— An exercise from a description ———

const describeSchema: JsonSchema = {
  type: "object",
  properties: {
    pattern: { type: "string", enum: [...patterns] },
    muscles: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: { type: "string", enum: [...muscles] },
    },
    equipment: { type: "string", enum: ["any", ...equipment] },
  },
  required: ["pattern", "muscles", "equipment"],
};

/** "the machine where you push your knees out" → hip abduction on a machine. */
export async function describeExercise(
  text: string,
  exercises: Exercise[],
  generate: Generate
): Promise<Exercise[]> {
  const reply = (await tryGenerate(generate, {
    instructions:
      "You identify a gym exercise from a description. Choose its movement pattern, the main muscles it trains and the equipment it uses.",
    prompt: `Description: ${clampText(text, 300)}`,
    schema: describeSchema,
    maxTokens: 200,
  })) as { pattern?: string; muscles?: string[]; equipment?: string } | null;
  if (reply === null) throw new ModelUnavailableError();
  const pattern = patterns.includes(reply?.pattern as Pattern) ? (reply.pattern as Pattern) : null;
  const trained = (Array.isArray(reply?.muscles) ? reply.muscles : []).filter((m): m is Muscle =>
    muscles.includes(m as Muscle)
  );
  const kit = equipment.includes(reply?.equipment as Equipment)
    ? (reply.equipment as Equipment)
    : null;
  return exercises
    .filter((e) => !e.archived)
    .map((e) => ({
      e,
      score:
        (pattern && e.pattern === pattern ? 4 : 0) +
        trained.reduce((s, m) => s + (e.muscles[m] ?? 0) * 2, 0) +
        (kit && e.equipment === kit ? 2 : 0),
    }))
    .filter((x) => x.score >= 4)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((x) => x.e);
}
