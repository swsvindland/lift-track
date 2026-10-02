import { useEffect, useState, useSyncExternalStore } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { eq } from "drizzle-orm";
import { getCalendars, getLocales } from "expo-localization";
import type { LiveActivityState } from "expo-live-activity";
import { db, preferences } from "@/db";
import { createFormat, localeTag } from "@/vector";
import { currentLanguage, interpolate, translate, type Language } from "./translations";

/* The rest timer is a deadline, not a countdown: it's stored, so it survives the app being
   killed. While it runs, the lock screen shows it (a Live Activity on iPhone, an ongoing
   notification on Android) and a local notification fires at the deadline. */

/** `setId` is the set the rest follows, so it can be rated from the rest bar. */
export type Rest = { endsAt: number; total: number; label: string; setId?: number };

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

// Expo Go has neither local notifications on Android nor Live Activities; the in-app timer works.
const native = Platform.OS !== "web" && Constants.appOwnership !== "expo";
// Fixed ids, so a timer can be cancelled after the app was killed and relaunched.
const END = "rest-end";
const ONGOING = "rest-ongoing";
const ACTIVITY_KEY = "restActivity";

async function notifications() {
  return native ? await import("expo-notifications") : null;
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
  if (Platform.OS === "android") {
    const language = currentLanguage();
    await n.setNotificationChannelAsync("rest", {
      name: translate(language, "restOver"),
      importance: n.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 150, 250],
    });
    await n.setNotificationChannelAsync("rest-running", {
      name: translate(language, "restTimer"),
      importance: n.AndroidImportance.LOW,
      sound: null,
      vibrationPattern: null,
      showBadge: false,
    });
  }
  // A rest that ended while the app was closed leaves nothing on the lock screen.
  if (!current) await clearLockScreen();
}

/** A time of day in the app's language, with the phone's region and 12/24-hour setting. */
const clock = (language: Language, ms: number) =>
  createFormat(localeTag(language, getLocales()), {
    uses24h: getCalendars()[0]?.uses24hourClock ?? undefined,
  }).time(new Date(ms));

// ——— iOS Live Activity: a countdown the system draws, so it ticks with the app asleep ———

async function liveActivity() {
  if (!native || Platform.OS !== "ios") return null;
  try {
    return await import("expo-live-activity");
  } catch {
    return null;
  }
}

const storedActivity = () =>
  db.select().from(preferences).where(eq(preferences.key, ACTIVITY_KEY)).get()?.value || null;
function storeActivity(id: string | null) {
  const value = id ?? "";
  db.insert(preferences)
    .values({ key: ACTIVITY_KEY, value })
    .onConflictDoUpdate({ target: preferences.key, set: { value } })
    .run();
}

type ProgressBar = NonNullable<LiveActivityState["progressBar"]>;

/**
 * The activity's bar with both fields: the end, which the system counts down to, and the rest's length in
 * seconds, so the meter runs from end − length to end and holds its place across re-renders. The module's TS type
 * makes `date` and `progress` exclusive, but its native record decodes each on its own
 * (expo-live-activity ios/ExpoLiveActivityModule.swift: ProgressBar → ContentState timerEndDateInMilliseconds
 * and progress), so the date bar is widened with the length instead of cast.
 */
export function restProgressBar(rest: Pick<Rest, "endsAt" | "total">): ProgressBar {
  const bar: ProgressBar = { date: rest.endsAt };
  return Object.assign(bar, { progress: rest.total });
}

async function showActivity(rest: Rest) {
  const la = await liveActivity();
  if (!la) return;
  const state: LiveActivityState = {
    title: translate(currentLanguage(), "rest"),
    subtitle: rest.label,
    progressBar: restProgressBar(rest),
  };
  const id = storedActivity();
  if (id) {
    try {
      la.updateActivity(id, state);
      return;
    } catch {
      // Swiped away on the Lock Screen or ended by the system: start a new one instead.
      storeActivity(null);
    }
  }
  try {
    // No config: the app's own target (targets/activity) draws it and links to the workout.
    storeActivity(la.startActivity(state) ?? null);
  } catch {
    // Live Activities turned off in Settings: the notification still comes.
    storeActivity(null);
  }
}

async function endActivity() {
  const id = storedActivity();
  if (!id) return;
  storeActivity(null);
  const la = await liveActivity();
  try {
    la?.stopActivity(id, { title: translate(currentLanguage(), "restOver") });
  } catch {
    /* Already gone. */
  }
}

// ——— Notifications: the alert at the deadline, and on Android an ongoing one until then ———

async function schedule(rest: Rest | null) {
  const n = await notifications();
  if (!n) return;
  await n.cancelScheduledNotificationAsync(END).catch(() => {});
  if (Platform.OS === "android") await n.dismissNotificationAsync(ONGOING).catch(() => {});
  if (!rest) return;
  const seconds = Math.round((rest.endsAt - Date.now()) / 1000);
  if (seconds < 1) return;
  const { status } = await n.getPermissionsAsync();
  if (status !== "granted") {
    const asked = await n.requestPermissionsAsync();
    if (asked.status !== "granted") return;
  }
  const language = currentLanguage();
  if (Platform.OS === "android")
    await n.scheduleNotificationAsync({
      identifier: ONGOING,
      content: {
        title: interpolate(translate(language, "restUntil"), {
          time: clock(language, rest.endsAt),
        }),
        body: rest.label,
        sticky: true,
        autoDismiss: false,
      },
      trigger: { channelId: "rest-running" },
    });
  await n.scheduleNotificationAsync({
    identifier: END,
    content: { title: translate(language, "restOver"), body: rest.label, sound: true },
    trigger: {
      type: n.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
      channelId: "rest",
    },
  });
}

async function clearLockScreen() {
  await schedule(null);
  await endActivity();
}

/*
 * expo-live-activity passes no staleDate (it hard-codes nil when it starts, updates and ends an activity), so
 * nothing tells the system when a rest is over. While the app runs, the rest's own deadline ends the Live Activity,
 * whichever screen is open (the rest bar lives only on the workout). With the app asleep the activity's view shows
 * the check once its end has passed, and settleRest ends it when the app comes back.
 */
let deadline: ReturnType<typeof setTimeout> | undefined;
function watchDeadline(rest: Rest | null) {
  clearTimeout(deadline);
  deadline = rest
    ? setTimeout(() => void endActivity().catch(() => {}), Math.max(0, rest.endsAt - Date.now()))
    : undefined;
}
// A rest that outlived a relaunch keeps its deadline too.
watchDeadline(current);

function show(rest: Rest) {
  watchDeadline(rest);
  void schedule(rest).catch(() => {});
  void showActivity(rest).catch(() => {});
}

export function startRest(seconds: number, label: string, setId?: number) {
  const rest = { endsAt: Date.now() + seconds * 1000, total: seconds, label, setId };
  write(rest);
  show(rest);
}

export function adjustRest(seconds: number) {
  if (!current) return;
  const endsAt = current.endsAt + seconds * 1000;
  if (endsAt <= Date.now()) return stopRest();
  const rest = { ...current, endsAt, total: Math.max(1, current.total + seconds) };
  write(rest);
  show(rest);
}

export function stopRest() {
  write(null);
  watchDeadline(null);
  void clearLockScreen().catch(() => {});
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** The running rest, without ticking. */
export const useRestState = () => useSyncExternalStore(subscribe, () => current);

/** The running rest and seconds left, ticking each second while one runs. */
export function useRest() {
  const rest = useRestState();
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

/** Patterns that move more than one joint; every other pattern is an isolation exercise. */
const compound = [
  "horizontalPress",
  "inclinePress",
  "verticalPress",
  "dip",
  "horizontalRow",
  "verticalPull",
  "squat",
  "lunge",
  "legPress",
  "hinge",
  "hipThrust",
];

/**
 * Default rest by how demanding the exercise is: squats and deadlifts under a bar or plates 3:00, other compounds
 * 2:00, isolation 1:00. A goblet squat or a dumbbell RDL counts as an ordinary compound.
 */
export function defaultRest(exercise: { pattern: string; equipment: string }) {
  if (
    ["squat", "hinge"].includes(exercise.pattern) &&
    ["barbell", "trapBar", "smith", "plateLoaded", "machine"].includes(exercise.equipment)
  )
    return 180;
  return compound.includes(exercise.pattern) ? 120 : 60;
}

export const formatClock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** Coming back to the app: a rest that ran out while away is cleared from the lock screen. */
export function settleRest() {
  if (current && current.endsAt <= Date.now()) stopRest();
  else if (!current) void clearLockScreen().catch(() => {});
}
