import { useEffect } from "react";
import { Platform } from "react-native";
import * as QuickActions from "expo-quick-actions";
import { useQuickActionRouting } from "expo-quick-actions/router";
import { useQuery } from "@/lib/data";
import { activeMeso, nextSession, programDetail } from "@/lib/programs";
import { useStore } from "@/lib/store";
import { activeWorkout } from "@/lib/workouts";

/**
 * Home-screen shortcuts that follow what's next: resume a workout in progress, or start the
 * program's next session, plus an empty workout. Both open straight into the logger.
 */
export function QuickActionItems() {
  useQuickActionRouting();
  const { t } = useStore();
  const next = useQuery(() => {
    const open = activeWorkout();
    if (open) return { resume: true as const, name: open.name };
    const meso = activeMeso();
    const detail = meso ? programDetail(meso.id) : undefined;
    const session = detail ? nextSession(detail) : undefined;
    const day = session && detail?.days.find((d) => d.id === session.dayId);
    return { resume: false as const, name: day?.name ?? "" };
  });
  // Plain strings, so the shortcuts are rebuilt when the language changes and not on every render.
  const text = {
    resume: t("resumeWorkout"),
    next: next.name ? t("startSession", { name: next.name }) : "",
    nextSubtitle: t("nextInProgram"),
    empty: t("emptyWorkout"),
  };
  useEffect(() => {
    // Android shortcuts would need bundled drawables; they read fine as text.
    const icon = (symbol: string) => (Platform.OS === "ios" ? symbol : null);
    const items: QuickActions.Action[] = next.resume
      ? [
          {
            id: "resume",
            title: text.resume,
            subtitle: next.name || null,
            icon: icon("symbol:play.fill"),
            params: { href: "/workout" },
          },
        ]
      : [
          ...(next.name
            ? [
                {
                  id: "next",
                  title: text.next,
                  subtitle: text.nextSubtitle,
                  icon: icon("symbol:play.fill"),
                  params: { href: "/start" },
                },
              ]
            : []),
          {
            id: "empty",
            title: text.empty,
            icon: icon("symbol:plus"),
            params: { href: "/start?empty=1" },
          },
        ];
    void QuickActions.setItems(items).catch(() => {});
  }, [next.resume, next.name, text.resume, text.next, text.nextSubtitle, text.empty]);
  return null;
}
