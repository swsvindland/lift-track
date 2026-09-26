import { useMemo, useSyncExternalStore, type DependencyList } from "react";

/* One revision number for workout data. Screens read synchronously from SQLite during render,
   keyed on the revision, and every write bumps it once. */

let revision = 0;
const listeners = new Set<() => void>();

export function changed() {
  revision++;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const useRevision = () => useSyncExternalStore(subscribe, () => revision);

/** Runs a write and tells readers; returns the write's result. */
export function write<T>(action: () => T): T {
  try {
    return action();
  } finally {
    changed();
  }
}

/**
 * Reads from SQLite, again whenever data changes or a dependency does. The compiler must not
 * memoize this itself: it would see through the revision and keep the first result.
 */
export function useQuery<T>(query: () => T, deps: DependencyList = []): T {
  "use no memo";
  const revision = useRevision();
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/use-memo
  return useMemo(query, [revision, ...deps]);
}
