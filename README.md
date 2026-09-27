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
- **Rest timer:**
  - Starts on each checked set, with its length set by the exercise (heavy compounds 3:00, isolation 1:30), adjustable ±15 s or skipped. Inside a superset, rest waits until the last exercise.
  - It's stored as a deadline, so it survives app restarts.
  - On iPhone a Live Activity shows the countdown on the Lock Screen and in the Dynamic Island, and tapping it opens the workout. On Android an ongoing notification shows when rest ends.
  - A local notification fires at the end, and a haptic fires in the app.
- **Shortcuts:**
  - Home-screen quick actions follow what's next: Resume workout, or Start (the next program session), plus an empty workout.
  - `lifttrack://start` does the same from Shortcuts or the Action Button. `lifttrack://start?empty=1` always starts an empty workout, and `lifttrack://workout` opens the workout in progress.
- **Finish:**
  - Unchecked sets and untouched exercises are dropped, and an empty workout is discarded.
  - The summary shows time, sets, volume and new records (estimated 1RM or heaviest load, compared with earlier sessions).
- **Progress:**
  - This week's workouts, sets and volume against last week.
  - An 8-week heatmap of hard sets per muscle (secondary muscles count half); tap a square for its number.
  - Estimated-1RM trends for your most-trained lifts. Two sessions on one day count as one point.
  - Recent records.
  - Body weight trend.
  - Each exercise has a strength chart with 1W–All ranges and a press-and-drag readout, and the weight screen has a trend chart.
  - All workouts (history by week) open from here, and any workout can be opened, edited, repeated or deleted.
- **Exercises:**
  - 258 curated, rep-based exercises with primary and secondary muscles (secondary counts as half a set) across 17 muscles, including front, side and rear delts.
  - Search understands gym shorthand ("rdl", "db", "ohp") and one-letter typos.
  - Muscle and favorite filters.
  - Each exercise has a best e1RM, its history, favorite and avoid flags, and a rest length.
  - You can add custom exercises, which are archived rather than deleted.
- **Gyms:**
  - Keep several gyms. Each starts from a preset (No gym, Hotel, Apartment, Home, Full gym), then you set its equipment and leave out or add single exercises (a full gym with no kettlebells or no leg press).
  - Each has kg or lb plates, a bar weight, a dumbbell step and heaviest dumbbell, and a machine step.
  - Swap suggestions only offer what the gym can do and skip exercises marked Avoid.
  - **Traveling:** pick the gym you'll use and your last day there. Program sessions swap in the closest exercises that gym can do, and loads round to its equipment. Back home, loads pick up from before you left. See [gyms and travel](docs/progression.md#gyms-and-travel).
- **Programs (Plan tab):**
  - Build a mesocycle for one of your gyms from five questions: days a week, minutes, training age, weeks before the deload, and muscles to bring up. The builder uses what that gym can do, your favorites and your Avoid list, and starts volume low. Edit anything before starting.
  - Every set of a session is prescribed (load, reps, reps in reserve) from your last performance and the week's RIR target, rounded to loads your gym can make, with a one-line reason.
  - After a session, one optional tap per muscle (Easy / Good / Hard / Too much / Hurt) sets next week's volume; without it, hitting your reps does.
  - Deload week at the end.
  - Skip or start any session from the week grid.
  - Swaps apply for today or the rest of the program and keep a real prescription.
  - See [programs and progression](docs/progression.md).
- **Body weight:** log it, or sync it both ways with Apple Health / Health Connect. It's recorded on each workout for bodyweight exercises.
- **Backups:** an encrypted backup (password-derived AES-256-GCM) of every workout, program, custom exercise, gym and weight, saved wherever you choose from the share sheet. Restore shows what's in the file, saves an encrypted recovery copy of your current records first, then replaces everything in one transaction. You can also export sets or body weight as CSV, or erase everything. See [backups](docs/backups.md).
- **On-device AI** (the phone's own model only, never the cloud; see [on-device AI](docs/ai.md)):
  - **Type or say** sets into a workout ("bench 225x5x3, incline db 30s for 12 12 10"). Shorthand is read on any phone; the model reads looser wording.
  - **Import a program** by pasting it or photographing a page. Text recognition runs on the phone.
  - **Describe what you want** to fill in the program builder, including equipment and what hurts.
  - **Find an exercise from a description** when search comes up empty.
  - Every result is a draft you confirm, and loads and progression never come from the model.
- **Health:**
  - With sync on, finished workouts are written to Apple Health or Health Connect as strength training, with start and end times only, right after you finish.
  - Edits rewrite the Health copy, and deletions remove it.
  - Sets and loads stay in the app. No energy is estimated, so a watch recording the same session isn't double counted.
  - Only permissions you granted are used.

- **Apple Watch:** start the next session or follow one started on the phone. Log the current set in one tap, with load and reps on the crown. Rate it Hard / Good / Easy during rest, get a tap on the wrist when rest is over, and finish from the wrist; the post-session questions wait on Today until you answer or skip them. See [Apple Watch](docs/watch.md).

A home-screen widget is still to come.

## Run

Use Node 24 (`nvm use`) and pnpm 11.26 (`corepack enable`).

```sh
pnpm install
pnpm ios
pnpm android
```

Rest notifications, the Live Activity, quick actions and Health sync need a native build (the Live Activity widget extension is generated by `expo-live-activity` at prebuild). If CocoaPods fails with an encoding error, run it with `LANG=en_US.UTF-8`. The app identity is `dev.svindland.vector.lift` with the `lifttrack://` scheme and a private `lift_track.db`, so it installs next to Vector Body and Vector Macros. No EAS project is linked yet. Create a new one before remote builds; do not reuse Body's or Macros'.

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
- weekly volume buckets, strength series (bodyweight included), records
- progression, the program builder and a program run week by week (see [programs and progression](docs/progression.md))
- supersets, reorder and swap
- Watch sync: the state sent to the Watch, and logging, rating and starting from it
- weekly volume
- gym presets, left-out and added exercises, stand-ins, and a trip that adapts sessions and leaves home loads alone
- health sync, including workout export, rewrite on edit and removal
- backup encryption, exact restore, rejected files, erase and CSV
- workout and program text parsing, exercise matching, model fallbacks and schemas

The documentation under `docs/app-store/` is inherited from Body and is reference material only.
