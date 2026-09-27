import { useEffect, useRef } from "react";
import { router, usePathname } from "expo-router";
import { write, useRevision } from "@/lib/data";
import { useExercises } from "@/lib/exercise-store";
import { syncHealthSoon } from "@/lib/health-schedule";
import { defaultRest, startRest, stopRest, useRestState } from "@/lib/rest-timer";
import { useStore } from "@/lib/store";
import { applyWatchCommand, parseWatchCommand, watchState, type WatchContext } from "@/lib/watch";
import { listenToWatch, sendWatchState, startWatchApp, watchAvailable } from "@/lib/watch-link";

/** Keeps the Watch in step with the open workout and applies what's logged on it. */
export function WatchLink() {
  return watchAvailable ? <Link /> : null;
}

function Link() {
  const { units, weights } = useStore();
  const { all, byId, settings, settingFor } = useExercises();
  const revision = useRevision();
  const rest = useRestState();
  const acked = useRef<string[]>([]);
  // Undefined until the first send, so opening the app mid-workout doesn't relaunch the Watch.
  const shown = useRef<number | null | undefined>(undefined);
  const startedByWatch = useRef(false);

  const ctx: WatchContext = {
    units,
    bodyWeightKg: weights[0]?.weightKg ?? null,
    byId,
    exercises: all,
    settings,
    restFor: (exercise) => settingFor(exercise.id)?.restSeconds ?? defaultRest(exercise),
  };
  const pathname = usePathname();
  const latest = useRef({ ctx, pathname });
  useEffect(() => {
    latest.current = { ctx, pathname };
  });

  useEffect(() => {
    const state = watchState(latest.current.ctx, rest, acked.current);
    sendWatchState(state);
    const id = state.workout?.id ?? null;
    if (shown.current === null && id !== null && !startedByWatch.current) startWatchApp();
    shown.current = id;
    startedByWatch.current = false;
  }, [revision, rest, units, byId]);

  useEffect(
    () =>
      listenToWatch((json) => {
        const cmd = parseWatchCommand(json);
        if (!cmd) return;
        // Acked before the write, whose revision bump sends it back even when nothing changed.
        acked.current = [...acked.current, cmd.id].slice(-20);
        const effect = write(() => applyWatchCommand(cmd, latest.current.ctx));
        if (effect.started) startedByWatch.current = true;
        if (effect.rest) startRest(effect.rest.seconds, effect.rest.label, effect.rest.setId);
        else if (effect.stopRest) stopRest();
        if (effect.finished) {
          void syncHealthSoon();
          // A phone left on the workout shows how it went, as its own Finish does.
          if (latest.current.pathname === "/workout")
            router.replace({
              pathname: "/session/[id]",
              params: { id: String(effect.finished), finished: "1" },
            });
        }
      }),
    []
  );
  return null;
}
