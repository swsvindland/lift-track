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
