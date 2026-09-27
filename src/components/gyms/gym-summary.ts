import { equipmentLabels } from "@/lib/exercises";
import { equipment as allEquipment } from "@/lib/exercises/types";
import type { NewGym } from "@/lib/loads";

/** One line on what a gym has: "Dumbbell, Bodyweight · dumbbells to 50 lb · 12 left out". */
export function gymSummary(gym: NewGym): string {
  const kinds =
    gym.equipment.length === allEquipment.length
      ? "All equipment"
      : gym.equipment.length
        ? allEquipment
            .filter((e) => gym.equipment.includes(e))
            .map((e) => equipmentLabels[e])
            .join(", ")
        : "No equipment";
  return [
    kinds,
    gym.equipment.includes("dumbbell") ? `dumbbells to ${gym.dumbbellMax} ${gym.unit}` : "",
    gym.excluded.length ? `${gym.excluded.length} left out` : "",
    gym.included.length ? `${gym.included.length} added` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
