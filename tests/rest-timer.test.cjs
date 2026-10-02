const { test } = require("node:test");
const assert = require("node:assert/strict");
const { eq } = require("drizzle-orm");
const { load, database, schema, translations } = require("./harness.cjs");

/** The Live Activity module's JS API, recording each call; `dismissed` ids throw like ActivityKit. */
function liveActivity() {
  const calls = [];
  const dismissed = new Set();
  let started = 0;
  return {
    calls,
    dismissed,
    startActivity: (...args) => {
      calls.push({ name: "start", args });
      return `activity-${++started}`;
    },
    updateActivity: (...args) => {
      calls.push({ name: "update", args });
      if (dismissed.has(args[0])) throw new Error(`Activity ${args[0]} not found`);
    },
    stopActivity: (...args) => void calls.push({ name: "stop", args }),
  };
}

/** rest-timer.ts on a fresh database, with the phone's notifications and Live Activities stubbed. */
function setup({ os = "ios", language } = {}) {
  const { db } = database();
  if (language) db.insert(schema.preferences).values({ key: "language", value: language }).run();
  const channels = [];
  const scheduled = [];
  const notifications = {
    AndroidImportance: { HIGH: 4, LOW: 2 },
    SchedulableTriggerInputTypes: { TIME_INTERVAL: "timeInterval" },
    setNotificationHandler: () => {},
    setNotificationChannelAsync: async (id, channel) => void channels.push({ id, ...channel }),
    cancelScheduledNotificationAsync: async () => {},
    dismissNotificationAsync: async () => {},
    getPermissionsAsync: async () => ({ status: "granted" }),
    requestPermissionsAsync: async () => ({ status: "granted" }),
    scheduleNotificationAsync: async (request) => void scheduled.push(request),
  };
  const la = liveActivity();
  const timer = load("src/lib/rest-timer.ts", {
    react: {},
    "react-native": { Platform: { OS: os } },
    "expo-constants": { default: { appOwnership: null } },
    "expo-localization": {
      getLocales: () => [{ languageCode: "en", regionCode: "US" }],
      getCalendars: () => [{ uses24hourClock: true }],
    },
    "expo-notifications": notifications,
    "expo-live-activity": la,
    "@/db": { db, ...schema },
    "@/vector": load("src/vector/format.ts"),
    "./translations": translations(db),
  });
  const storedActivity = () =>
    db.select().from(schema.preferences).where(eq(schema.preferences.key, "restActivity")).get()
      ?.value;
  return { timer, la, channels, scheduled, storedActivity };
}

// The lock screen calls are fire-and-forget; let them run.
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("the rest Live Activity takes no colours from JS and restarts once it was swiped away", async () => {
  const { timer, la, storedActivity } = setup();
  timer.startRest(90, "Next: Bench press", 7);
  await settle();
  const [start] = la.calls;
  assert.equal(start.name, "start");
  assert.equal(start.args.length, 1, "state only: the owned target draws the activity");
  assert.equal(start.args[0].title, "Rest");
  assert.equal(start.args[0].subtitle, "Next: Bench press");
  assert.equal(storedActivity(), "activity-1");

  // The next set's rest updates the same activity.
  timer.startRest(90, "Next: Bench press", 8);
  await settle();
  assert.deepEqual(
    la.calls.map((c) => c.name),
    ["start", "update"]
  );
  assert.equal(la.calls[1].args[0], "activity-1");

  // Swiped away on the Lock Screen: the update throws, so a new activity starts for this rest.
  la.dismissed.add("activity-1");
  timer.startRest(90, "Next: Bench press", 9);
  await settle();
  assert.deepEqual(
    la.calls.map((c) => c.name),
    ["start", "update", "update", "start"]
  );
  assert.equal(la.calls[3].args.length, 1);
  assert.equal(storedActivity(), "activity-2");

  timer.stopRest();
  await settle();
  assert.deepEqual(la.calls.at(-1), { name: "stop", args: ["activity-2", { title: "Rest over" }] });
  assert.equal(storedActivity(), "");
});

test("the Live Activity gets the rest's end and its length, so its meter starts where the rest did", async () => {
  const { timer, la } = setup();
  const before = Date.now();
  timer.startRest(90, "Next: Bench press");
  await settle();
  const first = la.calls[0].args[0].progressBar;
  // Both fields (the module's TS type says one or the other; its native record reads both).
  assert.deepEqual(Object.keys(first).sort(), ["date", "progress"]);
  assert.equal(first.progress, 90, "the length in seconds");
  assert.ok(first.date >= before + 90_000 && first.date <= Date.now() + 90_000);
  assert.deepEqual(timer.restProgressBar({ endsAt: 5000, total: 3 }), { date: 5000, progress: 3 });
  timer.stopRest();
});

test("a rest that runs out while the app is open ends its Live Activity at the deadline", async () => {
  const { timer, la, storedActivity } = setup();
  timer.startRest(0.05, "Next: Squat");
  await settle();
  assert.equal(storedActivity(), "activity-1");
  // Whichever screen is open (the rest bar lives only on the workout), the lock screen does not sit at 0:00.
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.deepEqual(la.calls.at(-1), { name: "stop", args: ["activity-1", { title: "Rest over" }] });
  assert.equal(storedActivity(), "");

  // The next rest moves the deadline; stopping clears it, so nothing ends later.
  timer.startRest(0.05, "Next: Squat");
  timer.startRest(15, "Next: Squat");
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(la.calls.at(-1).name, "update");
  assert.equal(storedActivity(), "activity-2");
  timer.stopRest();
  await settle();
  const calls = la.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(la.calls.length, calls);
});

test("the rest timer speaks the app's language, not the phone's", async () => {
  const ios = setup({ language: "de" });
  ios.timer.startRest(60, "Als Nächstes: Kniebeuge");
  await settle();
  assert.equal(ios.la.calls[0].args[0].title, "Pause");
  assert.equal(ios.scheduled.at(-1).content.title, "Pause vorbei");

  const android = setup({ os: "android", language: "de" });
  await android.timer.prepareRestNotifications();
  assert.deepEqual(
    android.channels.map((c) => c.name),
    ["Pause vorbei", "Pausentimer"]
  );
  android.timer.startRest(60, "Als Nächstes: Kniebeuge");
  await settle();
  assert.equal(android.la.calls.length, 0, "no Live Activity on Android");
  const [ongoing, end] = android.scheduled;
  assert.match(ongoing.content.title, /^Pause bis \d{1,2}:\d{2}$/);
  assert.equal(end.content.title, "Pause vorbei");
  ios.timer.stopRest();
  android.timer.stopRest();
});

test("rest defaults: squats and deadlifts 3:00, other compounds 2:00, isolation 1:00", () => {
  const { timer } = setup();
  const { library } = load("src/lib/exercises/library.ts");
  const rest = (id) => timer.defaultRest(library.find((e) => e.id === id));
  for (const id of [
    "barbell-back-squat",
    "hack-squat",
    "conventional-deadlift",
    "trap-bar-deadlift",
  ])
    assert.equal(rest(id), 180, id);
  for (const id of ["barbell-bench-press", "goblet-squat", "db-rdl", "leg-press", "chest-dip"])
    assert.equal(rest(id), 120, id);
  for (const id of ["db-lateral-raise", "barbell-curl", "leg-extension", "cable-fly"])
    assert.equal(rest(id), 60, id);
});
