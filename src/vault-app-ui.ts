import { changed } from "@/lib/data";
import { useStore } from "@/lib/store";

/** Re-reads the store and every data query after a restore replaced the database rows (spec §4.3). */
export function useVaultRefresh(): () => void {
  const { refresh } = useStore();
  return () => {
    refresh();
    changed();
  };
}
