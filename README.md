# VECTOR LIFT

Part of the VECTOR app series. A local-first hypertrophy and strength trainer for iPhone and Android, forked from Vector Body and built with Expo SDK 57, HeroUI Native and SQLite. The home-screen label is **Lift**. See [the product plan](docs/lift-track-plan.md) and [the RP Hypertrophy / MacroFactor Workouts review](docs/lift-competitor-review.md).

Everything stays on the phone: no account, no server, no analytics and no network code. The on-device model features planned for later use only the phone's own model (Apple Intelligence or Gemini Nano), with no cloud fallback.

## What works now

- **Today:** start a workout, resume the one in progress, or repeat a recent workout with every set prefilled from last time. It also shows this week's sets per muscle and body weight.
- **Workout logger:**
  - Each set shows last time's weight × reps. A set done as prescribed is one tap on ✓.
  - Typed values override the targets.
  - Reps in reserve (RIR) is optional per set.
  - Set types are warm-up, working, drop and myo-reps.
  - You can add or delete sets (with Undo), and swap, reorder, superset or remove exercises (with Undo).
  - The plates per side are shown for the next barbell set.
  - Every set is its own SQLite commit, so a workout survives the app being killed. Only one workout is open at a time.
- **Rest timer:** starts on each checked set, with its length set by the exercise (heavy compounds 3:00, isolation 1:30), adjustable ±15 s or skipped. It's stored as a deadline, so it survives app restarts. A local notification fires at the end while the app is in the background, and a haptic fires in the app. Inside a superset, rest waits until the last exercise.
- **Finish:**
  - Unchecked sets and untouched exercises are dropped, and an empty workout is discarded.
  - The summary shows time, sets, volume and new records (estimated 1RM or heaviest load, compared with earlier sessions).
- **History:** workouts grouped by week. A workout can be opened, edited, repeated or deleted.
- **Exercises:**
  - 253 curated, rep-based exercises with primary and secondary muscles (secondary counts as half a set) across 17 muscles, including front, side and rear delts.
  - Search understands gym shorthand ("rdl", "db", "ohp") and one-letter typos.
  - Muscle and favorite filters.
  - Each exercise has a best e1RM, its history, favorite and avoid flags, and a rest length.
  - You can add custom exercises, which are archived rather than deleted.
- **Gym & plates:** kg or lb plates you own, bar weight, dumbbell step and heaviest dumbbell, machine step, and the equipment the gym has. Swap suggestions only offer equipment the gym has and skip exercises marked Avoid.
- **Programs (Plan tab):**
  - Build a mesocycle from five questions: days a week, minutes, training age, weeks before the deload, and muscles to bring up. The builder uses your gym's equipment, favorites and Avoid list, and starts volume low. Edit anything before starting.
  - Every set of a session is prescribed (load, reps, reps in reserve) from your last performance and the week's RIR target, rounded to loads your gym can make, with a one-line reason.
  - After a session, one optional tap per muscle (Easy / Good / Hard / Too much / Hurt) sets next week's volume; without it, hitting your reps does.
  - Deload week at the end.
  - Skip or start any session from the week grid.
  - Swaps apply for today or the rest of the program and keep a real prescription.
  - See [programs and progression](docs/progression.md).
- **Body weight:** log it, or sync it both ways with Apple Health / Health Connect. It's recorded on each workout for bodyweight exercises.

Progress charts, backups, the lock-screen rest timer and the on-device AI features are the next stages in the plan.

## Run

Use Node 24 (`nvm use`) and pnpm 11.26 (`corepack enable`).

```sh
pnpm install
pnpm ios
pnpm android
```

Rest notifications and Health sync need a native build. If CocoaPods fails with an encoding error, run it with `LANG=en_US.UTF-8`. The app identity is `dev.svindland.vector.lift` with the `lifttrack://` scheme and a private `lift_track.db`, so it installs next to Vector Body and Vector Macros. No EAS project is linked yet. Create a new one before remote builds; do not reuse Body's or Macros'.

## Data

Loads are stored in kg. A gym keeps its plates in its own unit, so 225 lb stays exactly 225 lb. Workouts store what was prescribed next to what was done, so history won't move when the progression method changes. The database is copied before any migration runs (the last two copies are kept). Custom exercises and history refer to exercise ids, which are never reused.

## App icons

The editable mark is `assets/branding/barbell.svg`. Run `pnpm icons:generate` to rebuild the PNG assets and `assets/branding/preview.png`.

## Verification

```sh
pnpm typecheck
pnpm lint
pnpm test
```

Tests run real SQLite through the production Drizzle driver. They cover:

- plate, dumbbell and machine rounding, and plates per side
- e1RM
- library consistency
- search and swaps
- the full log → finish → repeat → PR flow
- progression, the program builder and a program run week by week (see [programs and progression](docs/progression.md))
- supersets, reorder and swap
- weekly volume
- health sync

The documentation under `docs/app-store/` is inherited from Body and is reference material only.
