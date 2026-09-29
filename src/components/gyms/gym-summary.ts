import { equipmentLabels } from "@/lib/exercises";
import { equipment as allEquipment } from "@/lib/exercises/types";
import type { NewGym } from "@/lib/loads";
import { useStore } from "@/lib/store";
import { useCount } from "@/lib/use-count";
import { useKitFormat } from "@/vector";

/**
 * What a gym has, as facets for Meta: "Dumbbell and Bodyweight", "Dumbbells to 50 lb", "12 left out".
 * Facets, not one joined line, so the separator is drawn rather than typed.
 */
export function useGymSummary() {
  const { t } = useStore();
  const format = useKitFormat();
  const count = useCount();
  return (gym: NewGym): string[] => [
    gym.equipment.length === allEquipment.length
      ? t("allEquipment")
      : gym.equipment.length
        ? format.list(
            allEquipment.filter((e) => gym.equipment.includes(e)).map((e) => equipmentLabels[e])
          )
        : t("noEquipment"),
    gym.equipment.includes("dumbbell")
      ? t("dumbbellsTo", {
          load: format.unit(gym.dumbbellMax, gym.unit === "kg" ? "kilogram" : "pound", 2),
        })
      : "",
    gym.excluded.length ? count(gym.excluded.length, "leftOutOne", "leftOut") : "",
    gym.included.length ? count(gym.included.length, "addedOne", "added") : "",
  ];
}
