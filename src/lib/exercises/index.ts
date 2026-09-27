import type { CustomExercise, ExerciseSetting } from "@/db/schema";
import { library } from "./library";
import type { Equipment, LibraryExercise, Muscle } from "./types";

export type Exercise = LibraryExercise & { custom?: boolean; archived?: boolean };

export const muscleLabels: Record<Muscle, string> = {
  chest: "Chest",
  lats: "Lats",
  upperBack: "Upper back",
  traps: "Traps",
  frontDelts: "Front delts",
  sideDelts: "Side delts",
  rearDelts: "Rear delts",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  abs: "Abs",
  lowerBack: "Lower back",
  glutes: "Glutes",
  quads: "Quads",
  hamstrings: "Hamstrings",
  adductors: "Adductors",
  calves: "Calves",
};

export const equipmentLabels: Record<Equipment, string> = {
  barbell: "Barbell",
  ezBar: "EZ bar",
  trapBar: "Trap bar",
  smith: "Smith machine",
  dumbbell: "Dumbbell",
  kettlebell: "Kettlebell",
  cable: "Cable",
  machine: "Machine",
  plateLoaded: "Plate-loaded machine",
  bodyweight: "Bodyweight",
  band: "Band",
};

export function fromCustom(row: CustomExercise): Exercise {
  return {
    id: row.id,
    name: row.name,
    equipment: row.equipment,
    pattern: row.pattern,
    muscles: row.muscles,
    unilateral: row.unilateral || undefined,
    load: row.load ?? undefined,
    reps: [row.repMin, row.repMax],
    cue: row.cue,
    custom: true,
    archived: row.archived,
  };
}

const bundled = new Map(library.map((exercise) => [exercise.id, exercise as Exercise]));

/** Every exercise, bundled first, then the user's own. Archived ones stay resolvable for history. */
export function allExercises(custom: CustomExercise[]): Exercise[] {
  return [...library, ...custom.map(fromCustom)];
}

export function exerciseById(id: string, custom: CustomExercise[]): Exercise | undefined {
  const found = bundled.get(id);
  if (found) return found;
  const row = custom.find((c) => c.id === id);
  return row ? fromCustom(row) : undefined;
}

/** Muscles with weight 1, in the library's order. */
export const primaryMuscles = (exercise: Pick<Exercise, "muscles">) =>
  (Object.keys(exercise.muscles) as Muscle[]).filter((m) => exercise.muscles[m] === 1);

const fold = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Gym shorthand people type, expanded before matching.
const synonyms: Record<string, string> = {
  db: "dumbbell",
  dbs: "dumbbell",
  bb: "barbell",
  kb: "kettlebell",
  ez: "ez bar",
  bw: "bodyweight",
  ohp: "overhead press",
  rdl: "romanian deadlift",
  sldl: "stiff leg deadlift",
  bss: "bulgarian split squat",
  lat: "lat",
  tri: "triceps",
  tris: "triceps",
  bi: "biceps",
  bis: "biceps",
  delt: "delt",
  delts: "delt",
  quad: "quads",
  ham: "hamstring",
  hams: "hamstring",
  pullup: "pull up",
  pullups: "pull up",
  chinup: "chin up",
  chinups: "chin up",
  pushup: "push up",
  pushups: "push up",
  situp: "sit up",
  pulldown: "pulldown",
  pushdown: "pushdown",
};
const stem = (word: string) =>
  word.length > 4 && word.endsWith("es") && !word.endsWith("ses")
    ? word.slice(0, -2)
    : word.length >= 3 && word.endsWith("s") && !word.endsWith("ss")
      ? word.slice(0, -1)
      : word;
const words = (text: string) =>
  fold(text)
    .split(" ")
    .flatMap((word) => (synonyms[word] ?? word).split(" "))
    .filter(Boolean)
    .map(stem);

/** Edit distance of at most one, for typos in longer words ("tricpes", "lateal"). */
function nearly(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1 || a.length < 5) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else if (a[i + 1] === b[j] && a[i] === b[j + 1]) {
      // A swapped pair counts as one edit.
      i += 2;
      j += 2;
    } else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Ranks exercises for a query. Every query word must match a word of the name, an alias or a
 * muscle, as a prefix or with one typo. Name matches beat alias and muscle matches; a
 * user's recent and favorite exercises rise among equal matches.
 */
export function searchExercises(
  exercises: Exercise[],
  query: string,
  boost: (exercise: Exercise) => number = () => 0
): Exercise[] {
  const terms = words(query);
  const visible = exercises.filter((e) => !e.archived);
  if (!terms.length) return [...visible].sort((a, b) => boost(b) - boost(a));
  const scored: { exercise: Exercise; score: number }[] = [];
  for (const exercise of visible) {
    const name = words(exercise.name);
    const aliases = (exercise.aliases ?? []).flatMap(words);
    const muscles = (Object.keys(exercise.muscles) as Muscle[]).flatMap((m) =>
      words(muscleLabels[m])
    );
    const extra = words(equipmentLabels[exercise.equipment]);
    let score = 0;
    let matched = true;
    for (const term of terms) {
      const hit = (list: string[]) =>
        list.some((w) => w === term)
          ? 3
          : list.some((w) => w.startsWith(term))
            ? 2
            : list.some((w) => nearly(w, term))
              ? 1
              : 0;
      const best = Math.max(hit(name) * 3, hit(aliases) * 2, hit(muscles), hit(extra));
      if (!best) {
        matched = false;
        break;
      }
      score += best;
    }
    if (!matched) continue;
    // Shorter names are the plainer version of a movement ("Squat" before "Squat to Box").
    score -= name.length * 0.1;
    if (fold(exercise.name) === fold(query)) score += 20;
    scored.push({ exercise, score: score + boost(exercise) });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.exercise);
}

/** What a gym can do: its equipment, less exercises it can't do, plus ones it can anyway. */
export type GymAccess = {
  equipment: readonly Equipment[];
  excluded?: readonly string[];
  included?: readonly string[];
};

export const canDoAt = (exercise: Pick<Exercise, "id" | "equipment">, gym: GymAccess) =>
  !!gym.included?.includes(exercise.id) ||
  (gym.equipment.includes(exercise.equipment) && !gym.excluded?.includes(exercise.id));

/**
 * Candidates to replace an exercise: same pattern first, then others that train its primary
 * muscles, filtered to what the gym can do and away from exercises marked to avoid.
 */
export function substitutes(
  exercise: Exercise,
  exercises: Exercise[],
  options: { gym?: GymAccess; settings?: ExerciseSetting[]; limit?: number } = {}
): Exercise[] {
  const avoid = new Set(options.settings?.filter((s) => s.avoid).map((s) => s.exerciseId));
  const favorite = new Set(options.settings?.filter((s) => s.favorite).map((s) => s.exerciseId));
  const gym = options.gym;
  const primary = primaryMuscles(exercise);
  const overlap = (other: Exercise) =>
    primary.reduce((sum, m) => sum + (other.muscles[m] ?? 0), 0) / Math.max(primary.length, 1);
  return exercises
    .filter(
      (other) =>
        other.id !== exercise.id &&
        !other.archived &&
        !avoid.has(other.id) &&
        (!gym || canDoAt(other, gym)) &&
        overlap(other) >= 0.5
    )
    .map((other) => ({
      other,
      score:
        (other.pattern === exercise.pattern ? 10 : 0) +
        overlap(other) * 4 +
        (other.equipment === exercise.equipment ? 1 : 0) +
        (favorite.has(other.id) ? 2 : 0) +
        (!!other.unilateral === !!exercise.unilateral ? 0.5 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? 12)
    .map((s) => s.other);
}

/**
 * What a day's exercises become at another gym: each stays when the gym can do it, otherwise
 * the closest substitute it can that the day doesn't already have. One with no substitute stays
 * as planned, to swap or skip by hand.
 */
export function standIns(
  planned: Exercise[],
  exercises: Exercise[],
  gym: GymAccess,
  settings: ExerciseSetting[] = []
): Exercise[] {
  const taken = new Set(planned.filter((e) => canDoAt(e, gym)).map((e) => e.id));
  return planned.map((exercise) => {
    if (canDoAt(exercise, gym)) return exercise;
    const found = substitutes(exercise, exercises, { gym, settings, limit: 40 }).find(
      (other) => !taken.has(other.id)
    );
    if (!found) return exercise;
    taken.add(found.id);
    return found;
  });
}

/** What lifters mean by the bare name of a lift, keyed by its normalized words. */
export const canonical: Record<string, string> = {
  bench: "barbell-bench-press",
  "bench press": "barbell-bench-press",
  "incline bench": "barbell-incline-bench-press",
  squat: "barbell-back-squat",
  "back squat": "barbell-back-squat",
  deadlift: "conventional-deadlift",
  row: "barbell-row",
  "overhead press": "barbell-overhead-press",
  "military press": "barbell-overhead-press",
  "shoulder press": "db-shoulder-press",
  curl: "db-curl",
  dip: "chest-dip",
  "pull up": "pull-up",
  "chin up": "chin-up",
  "push up": "push-up",
  "hip thrust": "barbell-hip-thrust",
  "calf raise": "standing-calf-raise",
  shrug: "barbell-shrug",
  "skull crusher": "ez-bar-skull-crusher",
};

/**
 * The library exercise a free-text name most likely means ("incline db press", "RDL",
 * "lat pulldown wide"). Confident when every word of the name matched the exercise's own name or
 * aliases; otherwise the best guess is offered for the person to confirm.
 */
export function matchExercise(
  exercises: Exercise[],
  name: string,
  boost?: (exercise: Exercise) => number
): { exercise: Exercise | undefined; confident: boolean } {
  const terms = words(name).filter((t) => !["with", "the", "and", "on", "a"].includes(t));
  if (!terms.length) return { exercise: undefined, confident: false };
  // A bare "bench" or "squat" means the classic barbell lift, unless history says otherwise.
  const classic = exercises.find((e) => e.id === canonical[terms.join(" ")]);
  if (
    classic &&
    !exercises.some(
      (e) =>
        e !== classic &&
        (boost?.(e) ?? 0) > (boost?.(classic) ?? 0) &&
        searchExercises([e], name).length
    )
  )
    return { exercise: classic, confident: true };
  const covered = (exercise: Exercise) => {
    const own = [...words(exercise.name), ...(exercise.aliases ?? []).flatMap(words)];
    return terms.every((t) => own.some((w) => w === t || w.startsWith(t) || nearly(w, t)));
  };
  // Drop words from the end until something matches: "bench press heavy day" still finds bench.
  for (let n = terms.length; n > 0; n--) {
    const found = searchExercises(exercises, terms.slice(0, n).join(" "), boost);
    if (found.length) {
      const confident = n === terms.length && covered(found[0]);
      return { exercise: found[0], confident };
    }
  }
  return { exercise: undefined, confident: false };
}
