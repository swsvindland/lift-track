import type { ExerciseSetting } from "@/db/schema";
import { canDoAt, type Exercise } from "./exercises";
import type { Equipment, Muscle, Pattern } from "./exercises/types";
import { rirPlan } from "./progression";

/* Builds a program from a few answers. Pure: the library, settings and gym equipment come in,
   a draft the user can edit comes out. */

export type Experience = "beginner" | "intermediate" | "advanced";
export const sessionMinutes = [30, 45, 60, 75, 90] as const;
export type SessionMinutes = (typeof sessionMinutes)[number];
export type BuilderInput = {
  days: number;
  minutes: SessionMinutes;
  experience: Experience;
  weeks: number;
  /** Muscles to bring up: always trained, a set more, a higher starting cap. */
  priorities: Muscle[];
  /** Muscles to bring down: one movement a day at most, fewer sets, a low cap that never grows. */
  deprioritized: Muscle[];
  equipment: readonly Equipment[];
  /** The gym's exercise exceptions: ones it can't do despite the equipment, and extras it can. */
  excluded?: readonly string[];
  included?: readonly string[];
  settings: ExerciseSetting[];
};

export type DraftSlot = { exerciseId: string; sets: number; reps: [number, number] };
export type DraftDay = { name: string; slots: DraftSlot[] };
export type ProgramDraft = {
  name: string;
  rir: number[];
  days: DraftDay[];
  deprioritized?: Muscle[];
  /** The gym it's built for; none means your main gym. */
  gymId?: number | null;
};

type Spec = { pattern: Pattern; muscle: Muscle };
const s = (pattern: Pattern, muscle: Muscle): Spec => ({ pattern, muscle });

// Each day lists movements in order of importance; shorter sessions take fewer from the top.
const dayTemplates: Record<string, Spec[]> = {
  "Full Body A": [
    s("squat", "quads"),
    s("horizontalPress", "chest"),
    s("verticalPull", "lats"),
    s("legCurl", "hamstrings"),
    s("lateralRaise", "sideDelts"),
    s("curl", "biceps"),
    s("tricepsExtension", "triceps"),
    s("calfRaise", "calves"),
  ],
  "Full Body B": [
    s("hinge", "hamstrings"),
    s("inclinePress", "chest"),
    s("horizontalRow", "upperBack"),
    s("legExtension", "quads"),
    s("lateralRaise", "sideDelts"),
    s("tricepsExtension", "triceps"),
    s("curl", "biceps"),
    s("crunch", "abs"),
  ],
  "Full Body C": [
    s("legPress", "quads"),
    s("verticalPress", "frontDelts"),
    s("verticalPull", "lats"),
    s("chestFly", "chest"),
    s("legCurl", "hamstrings"),
    s("rearDeltFly", "rearDelts"),
    s("curl", "biceps"),
    s("calfRaise", "calves"),
  ],
  Upper: [
    s("horizontalPress", "chest"),
    s("horizontalRow", "upperBack"),
    s("inclinePress", "chest"),
    s("verticalPull", "lats"),
    s("lateralRaise", "sideDelts"),
    s("tricepsExtension", "triceps"),
    s("curl", "biceps"),
    s("rearDeltFly", "rearDelts"),
  ],
  Lower: [
    s("squat", "quads"),
    s("hinge", "hamstrings"),
    s("legPress", "quads"),
    s("legCurl", "hamstrings"),
    s("calfRaise", "calves"),
    s("legExtension", "quads"),
    s("crunch", "abs"),
    s("hipAdduction", "adductors"),
  ],
  Push: [
    s("horizontalPress", "chest"),
    s("inclinePress", "chest"),
    s("verticalPress", "frontDelts"),
    s("lateralRaise", "sideDelts"),
    s("tricepsExtension", "triceps"),
    s("chestFly", "chest"),
    s("tricepsExtension", "triceps"),
    s("lateralRaise", "sideDelts"),
  ],
  Pull: [
    s("verticalPull", "lats"),
    s("horizontalRow", "upperBack"),
    s("curl", "biceps"),
    s("rearDeltFly", "rearDelts"),
    s("pullover", "lats"),
    s("curl", "biceps"),
    s("shrug", "traps"),
    s("horizontalRow", "lats"),
  ],
  Legs: [
    s("squat", "quads"),
    s("hinge", "hamstrings"),
    s("legPress", "quads"),
    s("legCurl", "hamstrings"),
    s("legExtension", "quads"),
    s("calfRaise", "calves"),
    s("legRaise", "abs"),
    s("hipThrust", "glutes"),
  ],
};

export const splits: Record<number, { name: string; days: string[] }> = {
  2: { name: "Full Body", days: ["Full Body A", "Full Body B"] },
  3: { name: "Full Body", days: ["Full Body A", "Full Body B", "Full Body C"] },
  4: { name: "Upper / Lower", days: ["Upper", "Lower", "Upper", "Lower"] },
  5: { name: "Upper / Lower + PPL", days: ["Upper", "Lower", "Push", "Pull", "Legs"] },
  6: { name: "Push / Pull / Legs", days: ["Push", "Pull", "Legs", "Push", "Pull", "Legs"] },
};

// Preferred choices per movement: well-tolerated, easy to load, good for hypertrophy.
const preferred: Partial<Record<Pattern, string[]>> = {
  squat: [
    "hack-squat",
    "barbell-back-squat",
    "pendulum-squat",
    "smith-squat",
    "belt-squat",
    "goblet-squat",
  ],
  legPress: ["leg-press", "leg-press-seated", "db-bulgarian-split-squat"],
  hinge: ["barbell-rdl", "db-rdl", "smith-rdl", "stiff-leg-deadlift", "cable-pull-through"],
  horizontalPress: [
    "barbell-bench-press",
    "db-bench-press",
    "machine-chest-press",
    "smith-bench-press",
    "push-up",
  ],
  inclinePress: [
    "db-incline-bench-press",
    "smith-incline-press",
    "barbell-incline-bench-press",
    "machine-incline-chest-press",
  ],
  verticalPress: [
    "db-shoulder-press",
    "machine-shoulder-press",
    "barbell-overhead-press",
    "smith-overhead-press",
    "pike-push-up",
  ],
  chestFly: ["cable-fly", "pec-deck", "db-fly", "cable-crossover"],
  horizontalRow: [
    "chest-supported-db-row",
    "cable-row",
    "machine-row",
    "t-bar-row-chest-supported",
    "barbell-row",
    "db-row-single",
    "inverted-row",
  ],
  verticalPull: [
    "lat-pulldown",
    "pull-up",
    "lat-pulldown-neutral",
    "machine-pulldown",
    "chin-up",
    "assisted-pull-up",
  ],
  pullover: ["straight-arm-pulldown", "db-pullover", "machine-pullover"],
  lateralRaise: [
    "cable-lateral-raise-single",
    "db-lateral-raise",
    "machine-lateral-raise",
    "db-lateral-raise-lean-away",
    "band-lateral-raise",
  ],
  rearDeltFly: [
    "reverse-pec-deck",
    "cable-rear-delt-fly",
    "db-rear-delt-fly-chest-supported",
    "db-rear-delt-fly",
    "band-pull-apart",
  ],
  curl: [
    "db-incline-curl",
    "cable-curl",
    "ez-bar-curl",
    "bayesian-curl",
    "db-hammer-curl",
    "db-curl",
    "band-curl",
  ],
  tricepsExtension: [
    "cable-pushdown-rope",
    "cable-overhead-extension",
    "ez-bar-skull-crusher",
    "db-overhead-extension",
    "machine-triceps-extension",
    "band-pushdown",
  ],
  legCurl: ["seated-leg-curl", "lying-leg-curl", "db-leg-curl", "nordic-curl", "sliding-leg-curl"],
  legExtension: ["leg-extension", "sissy-squat", "reverse-nordic"],
  calfRaise: [
    "standing-calf-raise",
    "leg-press-calf-raise",
    "seated-calf-raise",
    "smith-calf-raise",
    "db-calf-raise-single",
  ],
  crunch: ["cable-crunch", "machine-crunch", "crunch"],
  legRaise: ["hanging-leg-raise", "captains-chair-knee-raise", "lying-leg-raise"],
  hipAdduction: ["hip-adduction-machine", "cable-hip-adduction"],
  hipThrust: [
    "barbell-hip-thrust",
    "machine-hip-thrust",
    "smith-hip-thrust",
    "db-hip-thrust",
    "glute-bridge",
  ],
  shrug: ["db-shrug", "barbell-shrug", "machine-shrug", "cable-shrug"],
};

const slotsFor: Record<SessionMinutes, number> = { 30: 4, 45: 5, 60: 6, 75: 7, 90: 8 };

/**
 * Picks an exercise for a movement: the preferred list first, then anything in the library with
 * that pattern and muscle. The n-th use of a movement in the week takes the n-th choice, so
 * repeated days vary a little. Equipment the gym lacks and exercises marked Avoid are skipped.
 * `loose` accepts any movement for the muscle, for gyms that lack the usual ones.
 */
function pick(
  spec: Spec,
  exercises: Exercise[],
  usable: (e: Exercise) => boolean,
  used: Map<string, number>,
  taken: Set<string>,
  favorite: Set<string>,
  loose = false
): Exercise | undefined {
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const fits = (e: Exercise) =>
    (loose || e.pattern === spec.pattern) && e.muscles[spec.muscle] === 1;
  const ranked = [
    ...exercises.filter((e) => favorite.has(e.id) && fits(e)),
    ...(preferred[spec.pattern] ?? []).flatMap((id) => byId.get(id) ?? []),
    ...exercises.filter(fits),
  ].filter(
    (e, i, list) =>
      list.findIndex((x) => x.id === e.id) === i && usable(e) && (e.muscles[spec.muscle] ?? 0) > 0
  );
  const options = ranked.filter((e) => !taken.has(e.id));
  if (!options.length) return undefined;
  const key = `${loose ? "any" : spec.pattern}:${spec.muscle}`;
  const n = used.get(key) ?? 0;
  used.set(key, n + 1);
  return options[n % Math.min(options.length, 2)];
}

export function buildProgram(input: BuilderInput, exercises: Exercise[]): ProgramDraft {
  const split = splits[Math.min(6, Math.max(2, input.days))];
  const avoid = new Set(input.settings.filter((x) => x.avoid).map((x) => x.exerciseId));
  const favorite = new Set(input.settings.filter((x) => x.favorite).map((x) => x.exerciseId));
  const gym = { equipment: input.equipment, excluded: input.excluded, included: input.included };
  const usable = (e: Exercise) => !e.archived && !avoid.has(e.id) && canDoAt(e, gym);
  const used = new Map<string, number>();
  const count = slotsFor[input.minutes] + (input.experience === "advanced" ? 1 : 0);
  const baseSets = input.experience === "beginner" ? 2 : 3;
  const priority = new Set(input.priorities);
  const lowered = new Set(input.deprioritized.filter((m) => !priority.has(m)));

  const days = split.days.map((template, index) => {
    const taken = new Set<string>();
    // A muscle brought down keeps only its first movement of the day; others take the room.
    const specs = dayTemplates[template].filter(
      (spec, i, list) =>
        !lowered.has(spec.muscle) || list.findIndex((x) => x.muscle === spec.muscle) === i
    );
    // Short sessions take movements from the top, but always keep a priority muscle's,
    // dropping the least important other movement instead. Order stays as listed.
    const chosen = specs.filter((spec, i) => i < count || priority.has(spec.muscle));
    while (chosen.length > count) {
      const drop = chosen.findLastIndex((spec) => !priority.has(spec.muscle));
      if (drop < 0) break;
      chosen.splice(drop, 1);
    }
    // The rest stand in when the gym can't do a chosen movement.
    const backups = specs.filter((spec) => !chosen.includes(spec));
    const slots: DraftSlot[] = [];
    // A small gym may lack every listed movement for a muscle; then any movement for it will do.
    const passes = [...chosen, ...backups].map((spec) => ({ spec, loose: false }));
    passes.push(...passes.map(({ spec }) => ({ spec, loose: true })));
    for (const { spec, loose } of passes) {
      if (slots.length >= count) break;
      const exercise = pick(spec, exercises, usable, used, taken, favorite, loose);
      if (!exercise) continue;
      taken.add(exercise.id);
      // Compounds early in the day carry a set more than isolation work at the end.
      const sets = Math.min(
        4,
        (slots.length < 2 ? baseSets : Math.max(2, baseSets - 1)) +
          (priority.has(spec.muscle) ? 1 : 0) -
          (lowered.has(spec.muscle) ? 1 : 0)
      );
      slots.push({ exerciseId: exercise.id, sets, reps: [exercise.reps[0], exercise.reps[1]] });
    }
    const repeats = split.days.filter((d) => d === template).length > 1;
    const letter = repeats
      ? ` ${split.days.slice(0, index + 1).filter((d) => d === template).length === 1 ? "A" : "B"}`
      : "";
    return { name: `${template}${letter}`, slots };
  });

  capStartingVolume(days, input, lowered, exercises);
  return { name: split.name, rir: rirPlan(input.weeks), days, deprioritized: [...lowered] };
}

/** Weekly primary-muscle sets a program starts at: low, so there's room to grow. */
export const startingVolume: Record<Experience, number> = {
  beginner: 8,
  intermediate: 10,
  advanced: 12,
};

/** Weekly primary-muscle sets for a muscle brought down: enough to keep most of it. */
export const loweredVolume = 4;

/**
 * Trims week-one sets where a muscle's primary sets across the week exceed the starting volume,
 * taking from the slot with the most sets, later in the day first, never below one set.
 */
function capStartingVolume(
  days: DraftDay[],
  input: BuilderInput,
  lowered: Set<Muscle>,
  exercises: Exercise[]
) {
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const slots = days.flatMap((d) => d.slots.map((slot, index) => ({ slot, index })));
  const muscles = new Set(
    slots.flatMap(({ slot }) =>
      Object.entries(byId.get(slot.exerciseId)?.muscles ?? {})
        .filter(([, w]) => w === 1)
        .map(([m]) => m as Muscle)
    )
  );
  for (const muscle of muscles) {
    const cap = lowered.has(muscle)
      ? loweredVolume
      : startingVolume[input.experience] + (input.priorities.includes(muscle) ? 2 : 0);
    const training = slots.filter(({ slot }) => byId.get(slot.exerciseId)?.muscles[muscle] === 1);
    let total = training.reduce((sum, { slot }) => sum + slot.sets, 0);
    while (total > cap) {
      const target = training
        .filter(({ slot }) => slot.sets > 1)
        .sort((a, b) => b.slot.sets - a.slot.sets || b.index - a.index)[0];
      if (!target) break;
      target.slot.sets--;
      total--;
    }
  }
}
