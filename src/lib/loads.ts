import type { Gym } from "@/db/schema";
import type { Equipment } from "./exercises/types";
import { LB } from "./metrics";

export type GymSetup = Pick<
  Gym,
  "unit" | "barWeight" | "plates" | "dumbbellStep" | "dumbbellMax" | "machineStep" | "equipment"
>;

const allEquipment: Equipment[] = [
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
];

/** Bodyweight moves that need a bar, dip station, bench or roller most rooms don't have. */
const needsApparatus = [
  "pull-up",
  "chin-up",
  "neutral-grip-pull-up",
  "chest-dip",
  "triceps-dip",
  "inverted-row",
  "hanging-leg-raise",
  "hanging-knee-raise",
  "captains-chair-knee-raise",
  "toes-to-bar",
  "back-extension-45",
  "glute-ham-raise",
  "ab-wheel-rollout",
  "decline-sit-up",
];

export const gymKinds = ["none", "hotel", "apartment", "home", "full"] as const;
export type GymKind = (typeof gymKinds)[number];

/** Starting points for a new gym; every one can be changed afterwards. */
export const gymPresets: Record<
  GymKind,
  {
    name: string;
    description: string;
    equipment: Equipment[];
    dumbbellMax: { kg: number; lb: number };
    excluded: string[];
  }
> = {
  none: {
    name: "No gym",
    description: "Bodyweight only: a floor, a chair and a wall.",
    equipment: ["bodyweight"],
    dumbbellMax: { kg: 20, lb: 50 },
    excluded: needsApparatus,
  },
  hotel: {
    name: "Hotel gym",
    description: "A dumbbell rack and a bench.",
    equipment: ["dumbbell", "bodyweight"],
    dumbbellMax: { kg: 24, lb: 50 },
    excluded: needsApparatus,
  },
  apartment: {
    name: "Apartment gym",
    description: "Dumbbells, a cable station, a Smith machine and a few machines.",
    equipment: ["dumbbell", "cable", "machine", "smith", "bodyweight"],
    dumbbellMax: { kg: 34, lb: 75 },
    excluded: ["glute-ham-raise", "captains-chair-knee-raise", "donkey-calf-raise"],
  },
  home: {
    name: "Home gym",
    description: "A rack with a barbell and plates, dumbbells, a pull-up bar and bands.",
    equipment: ["barbell", "dumbbell", "bodyweight", "band"],
    dumbbellMax: { kg: 40, lb: 90 },
    excluded: ["glute-ham-raise", "captains-chair-knee-raise", "back-extension-45"],
  },
  full: {
    name: "Full gym",
    description: "A commercial gym with every kind of equipment.",
    equipment: allEquipment,
    dumbbellMax: { kg: 50, lb: 120 },
    excluded: [],
  },
};

export type NewGym = GymSetup & { name: string; excluded: string[]; included: string[] };

/** A new gym from a preset, with plates and steps typical for the unit. */
export function presetGym(kind: GymKind, unit: "kg" | "lb"): NewGym {
  const preset = gymPresets[kind];
  return {
    ...defaultGym(unit),
    name: preset.name,
    dumbbellMax: preset.dumbbellMax[unit],
    equipment: [...preset.equipment],
    excluded: [...preset.excluded],
    included: [],
  };
}

/** A typical commercial gym, in the user's unit. */
export function defaultGym(unit: "kg" | "lb"): GymSetup & { name: string } {
  return unit === "kg"
    ? {
        name: "My gym",
        unit,
        barWeight: 20,
        plates: [25, 20, 15, 10, 5, 2.5, 1.25],
        dumbbellStep: 2,
        dumbbellMax: 50,
        machineStep: 5,
        equipment: allEquipment,
      }
    : {
        name: "My gym",
        unit,
        barWeight: 45,
        plates: [45, 35, 25, 10, 5, 2.5],
        dumbbellStep: 5,
        dumbbellMax: 120,
        machineStep: 10,
        equipment: allEquipment,
      };
}

/**
 * A gym moved to the other unit. Plates don't convert, so the bar, plates and steps become the
 * typical ones; the heaviest dumbbell converts to the nearest step so a small rack stays small.
 */
export function convertGym(gym: GymSetup, unit: "kg" | "lb"): Omit<GymSetup, "equipment"> {
  if (gym.unit === unit) {
    const { barWeight, plates, dumbbellStep, dumbbellMax, machineStep } = gym;
    return { unit, barWeight, plates, dumbbellStep, dumbbellMax, machineStep };
  }
  const typical = defaultGym(unit);
  const heaviest = toGymUnit(fromGymUnit(gym.dumbbellMax, gym.unit), unit);
  return {
    unit,
    barWeight: typical.barWeight,
    plates: typical.plates,
    dumbbellStep: typical.dumbbellStep,
    dumbbellMax: Math.max(
      typical.dumbbellStep,
      Math.round(heaviest / typical.dumbbellStep) * typical.dumbbellStep
    ),
    machineStep: typical.machineStep,
  };
}

export const toGymUnit = (kg: number, unit: "kg" | "lb") => (unit === "kg" ? kg : kg / LB);
export const fromGymUnit = (value: number, unit: "kg" | "lb") =>
  unit === "kg" ? value : value * LB;

// Loads are compared in hundredths of the gym's unit so 2.5 + 1.25 sums exactly.
const cents = (value: number) => Math.round(value * 100);

/** Bars other than the gym's standard one, in the gym's unit. */
function baseWeight(equipment: Equipment, gym: GymSetup) {
  if (equipment === "barbell") return gym.barWeight;
  if (equipment === "ezBar") return gym.unit === "kg" ? 10 : 25;
  if (equipment === "trapBar") return gym.unit === "kg" ? 25 : 55;
  // Smith bars and plate-loaded sleds vary too much to guess; their load is the plates.
  return 0;
}

const platePaired = (equipment: Equipment) =>
  ["barbell", "ezBar", "trapBar", "smith", "plateLoaded"].includes(equipment);

const cache = new Map<string, number[]>();
/** Every total a set of plates can make on one side, up to a limit, in cents. */
function plateSums(plates: number[], limit: number) {
  const key = `${plates.join(",")}:${limit}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const sizes = plates.map(cents).filter((p) => p > 0);
  const reachable = new Uint8Array(limit + 1);
  reachable[0] = 1;
  for (let total = 0; total <= limit; total++) {
    if (!reachable[total]) continue;
    for (const size of sizes) if (total + size <= limit) reachable[total + size] = 1;
  }
  const sums: number[] = [];
  reachable.forEach((ok, total) => ok && sums.push(total));
  cache.set(key, sums);
  return sums;
}

/** The loads this gym can make for a piece of equipment, ascending, in the gym's unit. */
export function achievableLoads(equipment: Equipment, gym: GymSetup, upTo: number): number[] {
  if (platePaired(equipment)) {
    const base = baseWeight(equipment, gym);
    const perSide = plateSums(gym.plates, Math.max(0, cents((upTo - base) / 2)) + 1);
    return perSide.map((side) => base + (side * 2) / 100);
  }
  if (equipment === "dumbbell" || equipment === "kettlebell") {
    const step = gym.dumbbellStep || 1;
    const loads: number[] = [];
    for (let w = step; w <= Math.min(upTo, gym.dumbbellMax) + 1e-9; w += step)
      loads.push(Math.round(w * 100) / 100);
    return loads;
  }
  if (equipment === "machine" || equipment === "cable") {
    const step = gym.machineStep || 1;
    const loads: number[] = [];
    for (let w = step; w <= upTo + step; w += step) loads.push(Math.round(w * 100) / 100);
    return loads;
  }
  // Added load on a belt or vest: any single stack of plates.
  const loads = plateSums(gym.plates, cents(upTo) + 1).map((c) => c / 100);
  return loads;
}

/**
 * The nearest load the gym can make, in kg. "down" never exceeds the target, for
 * prescriptions that must not overshoot; "nearest" breaks ties downward.
 */
export function roundLoad(
  kg: number,
  equipment: Equipment,
  gym: GymSetup,
  mode: "nearest" | "down" = "nearest"
): number {
  if (!(kg > 0)) return 0;
  const target = toGymUnit(kg, gym.unit);
  const loads = achievableLoads(equipment, gym, target * 1.25 + 10);
  if (!loads.length) return kg;
  let best = loads[0];
  for (const load of loads) {
    if (mode === "down") {
      if (load <= target + 1e-9) best = load;
    } else if (Math.abs(load - target) < Math.abs(best - target) - 1e-9) best = load;
  }
  if (mode === "down" && best > target + 1e-9) return fromGymUnit(loads[0], gym.unit);
  return fromGymUnit(best, gym.unit);
}

/** The next load up or down from the current one, for the ± buttons. */
export function stepLoad(kg: number, equipment: Equipment, gym: GymSetup, direction: 1 | -1) {
  const current = toGymUnit(Math.max(kg, 0), gym.unit);
  const loads = [0, ...achievableLoads(equipment, gym, current + 100)];
  const next =
    direction === 1
      ? loads.find((load) => load > current + 1e-9)
      : [...loads].reverse().find((load) => load < current - 1e-9);
  return fromGymUnit(next ?? (direction === 1 ? current : 0), gym.unit);
}

/** Plates for one side of the bar, heaviest first; null when the load can't be made exactly. */
export function platesPerSide(kg: number, equipment: Equipment, gym: GymSetup): number[] | null {
  if (!platePaired(equipment)) return null;
  const perSide = cents((toGymUnit(kg, gym.unit) - baseWeight(equipment, gym)) / 2);
  if (perSide < 0) return null;
  const sizes = gym.plates.map(cents).sort((a, b) => b - a);
  // Fewest plates: a small change-making search, fine for real plate sets.
  const best = new Map<number, number[]>([[0, []]]);
  for (let total = 1; total <= perSide; total++) {
    let choice: number[] | undefined;
    for (const size of sizes) {
      const rest = best.get(total - size);
      if (rest && (!choice || rest.length + 1 < choice.length)) choice = [size, ...rest];
    }
    if (choice) best.set(total, choice);
  }
  const plates = best.get(perSide);
  return plates ? [...plates].sort((a, b) => b - a).map((p) => p / 100) : null;
}
