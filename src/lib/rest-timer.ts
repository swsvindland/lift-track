import { useEffect, useState, useSyncExternalStore } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { eq } from "drizzle-orm";
import { db, preferences } from "@/db";

/* The rest timer is a deadline, not a countdown: it's stored, so it survives the app being
   killed, and a local notification fires at the deadline while the app is in the background. */

export type Rest = { endsAt: number; total: number; label: string };

const KEY = "restTimer";
let current: Rest | null = read();
const listeners = new Set<() => void>();

function read(): Rest | null {
  try {
    const raw = db.select().from(preferences).where(eq(preferences.key, KEY)).get()?.value;
    const value = raw ? (JSON.parse(raw) as Rest) : null;
    return value && value.endsAt > Date.now() ? value : null;
  } catch {
    return null;
  }
}

function write(value: Rest | null) {
  current = value;
  const stored = value ? JSON.stringify(value) : "";
  db.insert(preferences)
    .values({ key: KEY, value: stored })
    .onConflictDoUpdate({ target: preferences.key, set: { value: stored } })
    .run();
  listeners.forEach((listener) => listener());
}

// Expo Go can't show local notifications on Android; the in-app timer still works.
const notificationsAvailable = Platform.OS !== "web" && Constants.appOwnership !== "expo";
let scheduled: string | null = null;

async function notifications() {
  return notificationsAvailable ? await import("expo-notifications") : null;
}

export async function prepareRestNotifications() {
  const n = await notifications();
  if (!n) return;
  n.setNotificationHandler({
    // In the app the timer bar and haptic already say rest is over.
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === "android")
    await n.setNotificationChannelAsync("rest", {
      name: "Rest timer",
      importance: n.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 150, 250],
    });
}

async function schedule(rest: Rest | null) {
  const n = await notifications();
  if (!n) return;
  if (scheduled) {
    await n.cancelScheduledNotificationAsync(scheduled).catch(() => {});
    scheduled = null;
  }
  if (!rest) return;
  const seconds = Math.round((rest.endsAt - Date.now()) / 1000);
  if (seconds < 1) return;
  const { status } = await n.getPermissionsAsync();
  if (status !== "granted") {
    const asked = await n.requestPermissionsAsync();
    if (asked.status !== "granted") return;
  }
  scheduled = await n.scheduleNotificationAsync({
    content: { title: "Rest over", body: rest.label, sound: true },
    trigger: {
      type: n.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
      channelId: "rest",
    },
  });
}

export function startRest(seconds: number, label: string) {
  const rest = { endsAt: Date.now() + seconds * 1000, total: seconds, label };
  write(rest);
  void schedule(rest).catch(() => {});
}

export function adjustRest(seconds: number) {
  if (!current) return;
  const endsAt = current.endsAt + seconds * 1000;
  if (endsAt <= Date.now()) return stopRest();
  const rest = { ...current, endsAt, total: Math.max(1, current.total + seconds) };
  write(rest);
  void schedule(rest).catch(() => {});
}

export function stopRest() {
  write(null);
  void schedule(null).catch(() => {});
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** The running rest and seconds left, ticking each second while one runs. */
export function useRest() {
  const rest = useSyncExternalStore(subscribe, () => current);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!rest) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [rest]);
  // Until the first tick, a new rest reads from an older clock; it can't exceed its length.
  const left = rest ? Math.min(rest.total, Math.max(0, Math.ceil((rest.endsAt - now) / 1000))) : 0;
  return { rest, left };
}

/** Default rest by how demanding the exercise is. */
export function defaultRest(exercise: { pattern: string; equipment: string }) {
  const heavy = ["squat", "hinge", "horizontalPress", "inclinePress", "verticalPress", "legPress"];
  if (heavy.includes(exercise.pattern) && exercise.equipment !== "machine") return 180;
  if (
    ["lateralRaise", "curl", "tricepsExtension", "calfRaise", "crunch", "wrist"].includes(
      exercise.pattern
    )
  )
    return 90;
  return 120;
}

export const formatClock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
