import { useEffect, useState, useSyncExternalStore } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { eq } from "drizzle-orm";
import { db, preferences } from "@/db";

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
    await n.setNotificationChannelAsync("rest", {
      name: "Rest over",
      importance: n.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 150, 250],
    });
    await n.setNotificationChannelAsync("rest-running", {
      name: "Rest timer",
      importance: n.AndroidImportance.LOW,
      sound: null,
      vibrationPattern: null,
      showBadge: false,
    });
  }
  // A rest that ended while the app was closed leaves nothing on the lock screen.
  if (!current) await clearLockScreen();
}

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

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

async function showActivity(rest: Rest) {
  const la = await liveActivity();
  if (!la) return;
  const state = { title: "Rest", subtitle: rest.label, progressBar: { date: rest.endsAt } };
  const id = storedActivity();
  try {
    if (id) la.updateActivity(id, state);
    else
      storeActivity(
        la.startActivity(state, {
          backgroundColor: "#071017",
          titleColor: "#f3f6f7",
          subtitleColor: "#87939b",
          progressViewTint: "#22d3ee",
          progressViewLabelColor: "#f3f6f7",
          timerType: "digital",
          deepLinkUrl: "lifttrack://workout",
        }) ?? null
      );
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
    la?.stopActivity(id, { title: "Rest over" });
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
  if (Platform.OS === "android")
    await n.scheduleNotificationAsync({
      identifier: ONGOING,
      content: {
        title: `Rest until ${clock(rest.endsAt)}`,
        body: rest.label,
        sticky: true,
        autoDismiss: false,
      },
      trigger: { channelId: "rest-running" },
    });
  await n.scheduleNotificationAsync({
    identifier: END,
    content: { title: "Rest over", body: rest.label, sound: true },
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

function show(rest: Rest) {
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
  void clearLockScreen().catch(() => {});
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

/** Coming back to the app: a rest that ran out while away is cleared from the lock screen. */
export function settleRest() {
  if (current && current.endsAt <= Date.now()) stopRest();
  else if (!current) void clearLockScreen().catch(() => {});
}
