/** Muscles tracked for weekly volume. Delts are split because they respond to different movements. */
export const muscles = [
  "chest",
  "lats",
  "upperBack",
  "traps",
  "frontDelts",
  "sideDelts",
  "rearDelts",
  "biceps",
  "triceps",
  "forearms",
  "abs",
  "lowerBack",
  "glutes",
  "quads",
  "hamstrings",
  "adductors",
  "calves",
] as const;
export type Muscle = (typeof muscles)[number];

export const equipment = [
  "barbell",
  "ezBar",
  "trapBar",
  "smith",
  "dumbbell",
  "kettlebell",
  "cable",
  "machine",
  "plateLoaded",
  "bodyweight",
  "band",
] as const;
export type Equipment = (typeof equipment)[number];

/** Movement patterns; substitutions look within the same pattern first. */
export const patterns = [
  "horizontalPress",
  "inclinePress",
  "verticalPress",
  "dip",
  "chestFly",
  "horizontalRow",
  "verticalPull",
  "pullover",
  "shrug",
  "lateralRaise",
  "frontRaise",
  "rearDeltFly",
  "facePull",
  "curl",
  "tricepsExtension",
  "squat",
  "lunge",
  "legPress",
  "hinge",
  "hipThrust",
  "legExtension",
  "legCurl",
  "backExtension",
  "hipAdduction",
  "hipAbduction",
  "calfRaise",
  "crunch",
  "legRaise",
  "core",
  "wrist",
] as const;
export type Pattern = (typeof patterns)[number];

export type LibraryExercise = {
  /** Stable kebab-case id. Never renamed or reused: history refers to it. */
  id: string;
  name: string;
  /** Other names people search for ("RDL", "skull crusher"). */
  aliases?: string[];
  equipment: Equipment;
  pattern: Pattern;
  /** 1 for a primary mover, 0.5 for a meaningful secondary mover. Counts as sets per week. */
  muscles: Partial<Record<Muscle, 1 | 0.5>>;
  /** Trained one side at a time; sets are logged per side. */
  unilateral?: boolean;
  /** "bodyweight": body weight plus any added load; "assisted": the load subtracts from body weight. */
  load?: "bodyweight" | "assisted";
  /** Default hypertrophy rep range for a new program slot. */
  reps: readonly [number, number];
  /** One short technique cue, our own words. */
  cue: string;
};
