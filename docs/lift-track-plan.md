# Lift Track product and implementation plan

Working proposal, September 26, 2026. Internal name: Lift Track. Proposed public name **Vector Lift**, home-screen label **Lift**, following Vector Body and Vector Macros. This document proposes the work; it does not change the application.

**Product direction.** Build a private hypertrophy and strength trainer with adaptive programming. The everyday loop is: open the app, see today's session, log each set in one tap when it goes as prescribed, rest on a timer, and finish. The app then adjusts next session's loads and reps and next week's sets per muscle. Programs, progression, history and analytics run on the phone. There is no account, no server, no analytics SDK and no cloud AI. The optional on-device model runs only where the OS supplies one, with no cloud fallback.

RP Hypertrophy and MacroFactor Workouts are the functional references: mesocycles with planned deloads, per-week effort (RIR) targets, recommended load and reps, per-muscle volume that adapts to feedback, substitutions and analytics. We implement our own method around the same user needs. Their public descriptions are feature references, not specifications of their proprietary algorithms. See [the competitor review](lift-competitor-review.md).

**What "fully local" means here.** The app has no network code at all. The exercise library ships in the app bundle. Library updates arrive with app updates. Health integration is opt-in and goes through the OS (HealthKit / Health Connect), which stays on the device unless the user has turned on the OS's own sync. Backups are encrypted files the user saves wherever they choose. That's the same rule as Body and Macros.

**Speed is the product.** The same rule as Macros applies: judge every change by taps and seconds in the daily loop. Mid-set the user is sweaty, holding a phone in one hand, and may be wearing gloves. Targets:

| Moment                        | Budget                                                            |
| ----------------------------- | ----------------------------------------------------------------- |
| Open app → first set in view  | 1 tap (Today opens on the next session; **Start**)                |
| Log a set done as prescribed  | 1 tap (the checkmark; the rest timer starts automatically)        |
| Log a set that differed       | ≤ 3 taps (± steppers on weight/reps, prefilled from prescription) |
| Swap an exercise              | ≤ 3 taps (same-muscle, same-equipment suggestions first)          |
| Post-session feedback         | ≤ 1 tap per muscle, skippable; sensible defaults if skipped       |
| Rest timer while phone locked | Live Activity / ongoing notification with time left and next set  |

## Launch features

| Area                  | Initial scope                                                                                                                                                                                                            | Important behavior                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Today                 | Next session of the active mesocycle, week/day position, **Start**; also a blank "freestyle" workout                                                                                                                     | Opening the app makes the next set obvious. A missed day slides forward. Nothing is skipped silently. |
| Workout logger        | Sets with prescribed weight × reps @ RIR, previous performance ghosted, one-tap complete, steppers, warm-up sets, notes, reorder, add/remove sets and exercises, supersets                                               | Survives app kill and phone restart mid-workout. Every write can be undone.                           |
| Set types             | Straight, warm-up (not counted), drop set, myo-reps / rest-pause, to-failure flag                                                                                                                                        | Only straight and top sets feed progression, unless we explicitly design otherwise.                   |
| Rest timer            | Auto-start per exercise type, skippable, lock-screen Live Activity (iOS) / ongoing notification (Android), haptic + sound at 0                                                                                           | Local notifications only.                                                                             |
| Load math             | Plate calculator per gym (bar weight, plates owned), dumbbell/machine increments per gym, kg/lb, bodyweight + added load                                                                                                 | Recommendations round to loads you can actually make.                                                 |
| Mesocycles            | 4–6 accumulation weeks + deload. Templates (full body, upper/lower, PPL, bro split) or generated from days/week, session length, equipment, experience, muscle priorities                                                | Editing mid-meso keeps history. You can end a meso early or extend it.                                |
| Progression           | Per-exercise rep range and weekly RIR target. The next load/reps come from the last performance (e1RM with reps-in-reserve). Increments you can't make fall back to adding reps.                                         | Deterministic and versioned, with an explanation for each recommendation. No LLM in the loop.         |
| Volume autoregulation | Weekly sets per muscle start near a low productive volume and rise with good recovery and pump feedback. They hold or drop with soreness, joint pain or falling performance. Secondary muscles count as fractional sets. | Feedback is optional. Without it, performance trends drive the decision.                              |
| Deloads               | Planned final week (half the sets, lighter loads, higher RIR). An early deload is offered after repeated performance drops.                                                                                              | Offered, never forced.                                                                                |
| Exercise library      | Bundled public-domain library (~800 movements) with primary/secondary muscles, equipment, mechanics and force; curated down to a clean set. Custom exercises. Favorites.                                                 | Media is text cues plus a muscle map at launch. See below.                                            |
| Substitutions         | Same movement pattern and target muscles first, filtered by the gym's equipment and by exercises you've marked "avoid (joint pain)"                                                                                      | A swap can be for today only or for the rest of the meso.                                             |
| Gyms                  | One or more gym profiles (equipment available, plates, dumbbell range, machine increments)                                                                                                                               | Switching gym re-filters substitutions and re-rounds loads.                                           |
| Progress              | Weekly sets per muscle against the plan, e1RM and best-set trends per exercise, PRs (1RM/e1RM/rep PRs), session volume and duration, muscle heatmap                                                                      | Tapping a chart opens it with 1M–All ranges, as in Macros.                                            |
| History               | Calendar of sessions, session detail, edit past sets, per-exercise history                                                                                                                                               | Editing history recomputes future recommendations, not past ones.                                     |
| Health                | Opt-in: write strength-training workouts (start, end, duration, estimated energy) to HealthKit/Health Connect; read body weight for bodyweight exercises                                                                 | Inherited from the fork's health layer with stable IDs, so there are no duplicates or export loops.   |
| Data ownership        | Encrypted backup/restore, CSV export of sets, erase all data                                                                                                                                                             | Ported from Vector Macros.                                                                            |

## Where on-device AI fits

Progression must stay deterministic and explainable. Same principle as Macros coaching: the model never decides a load. The phone's own model (Apple Foundation Models on iPhone, Gemini Nano via ML Kit GenAI on Android, both through the `local-ai` module ported from Macros) turns messy input into structured drafts the user confirms:

1. **Say or type a workout** — "bench 100 for 8, 8, 7 then incline db 30s for 12" becomes logged sets matched to library exercises. This also covers backfilling a session logged in a notes app. Voice input uses the OS's on-device dictation where available.
2. **Import a program** — paste text or photograph a coach's sheet or a program from a book. Text recognition runs on the device. The model maps rows to exercises, sets, rep ranges and RIR, and you get an editable mesocycle template.
3. **Describe constraints in words** — "45 minutes, 4 days, only dumbbells on Fridays, cranky left shoulder" fills in the generator's structured inputs (days, duration, equipment, avoid list). The deterministic generator then builds the program.
4. **Find an exercise by description** — "that machine where you push your knees out" or a name in gym slang resolves to a library entry, which helps offline search.

Phones without an on-device model keep every feature through manual entry. All four are drafts shown for confirmation. The AI button appears only where the model is available, as in Macros.

Out of scope for v1: video form analysis, and a downloadable fallback model. Revisit both after launch, keeping the same no-cloud rule.

## Progression method (first version, to be documented like Macros' coaching.md)

- **Effort.** Each exercise carries a rep range (for example 8–12) and each meso week carries an RIR target: 3 → 2 → 2 → 1 → 0 for a five-week accumulation, then deload. Reps + RIR ≈ reps to failure, and estimated 1RM uses a standard RIR-adjusted Epley/Brzycki table. The method is versioned so we can change it later without rewriting history.
- **Next load/reps.** From the last comparable performance, pick the load that hits the target reps at this week's RIR. Round to the gym's achievable loads. When the next available load overshoots, as with big dumbbell jumps or machine stacks, prescribe the same load with more reps instead (double progression). Anchor on the top set; back-off sets follow observed drop-off.
- **Performance signal.** Compare e1RM across sessions of the same exercise. If it falls two sessions in a row at the same prescription, that counts as local fatigue: hold volume for that muscle, and flag an early deload if it happens across several muscles.
- **Weekly sets per muscle.** Start from an experience-based range: roughly 8–10 sets per muscle per week for beginners, more for trained lifters, fewer for muscles marked low priority. After each session, optional questions per trained muscle ask about soreness recovered or not, pump, and joint discomfort. Good recovery and a low-to-moderate pump add 1–2 sets to that muscle next week. Unrecovered soreness or joint pain holds or removes a set, and joint pain also suggests a swap. Totals are capped per session and per week. Fractional counting: 1 set for primary muscles, 0.5 for secondary.
- **Deload.** The last week uses about half the sets at about 90% of the loads, RIR 4+. The next meso restarts volume a little above the last meso's start when recovery allowed it.
- **Evidence.** Cite RIR-based autoregulation and volume dose-response literature in an offline _Sources & methods_ screen. State plainly that the numbers are product heuristics, not individual prescriptions.

Tests: synthetic lifters with known strength curves, noise, missed sessions, skipped feedback, big dumbbell jumps, lb/kg switches, bodyweight exercises, mid-meso swaps and edits to past sets.

## App structure

Four tabs plus Settings:

- **Today**: next session or the workout in progress, week strip of sessions done/planned, quick start.
- **Plan**: current mesocycle as a week × day grid, weekly sets per muscle (planned vs done), edit or generate a meso, templates.
- **Progress**: volume per muscle, strength trends, PRs, body weight (from Health), history calendar.
- **Library**: exercises, custom exercises, gyms, templates.
- **Settings**: units, theme, rest defaults, health, backup/export, erase.

Remove from the fork: body measurements, progress photos, height, BMI/body-fat/FFMI dashboard, and the photo-picker permissions. These stay in Vector Body. Keep: weight entries (for bodyweight loading and relative strength), preferences, the health-links mapping, localization infrastructure, charts, the HeroUI Native/Uniwind stack and SQLite/Drizzle.

## Data model sketch

`exercises` (bundled + custom, muscles with weights, equipment, pattern, increments), `gyms`, `gym_equipment`, `mesocycles`, `meso_days`, `meso_slots` (exercise, rep range, planned sets per week), `workouts` (started/ended, gym, meso/week/day or freestyle), `workout_exercises`, `sets` (type, weight, reps, RIR recorded, completed at, prescribed snapshot), `muscle_feedback`, `recommendations` (method version, inputs hash, explanation) and `prs`. Workouts store what was prescribed, so history doesn't change when the method or the plan changes, the same way food entries store nutrition snapshots in Macros.

## Reuse from Vector Macros (port, don't rebuild)

This fork is from Body, which is older than Macros. Port these from `../macro-track`:

- `modules/local-ai` + `src/lib/local-ai.ts` + `model-json.ts` (on-device model bridge, Kotlin pin plugin)
- Encrypted backup/restore, CSV export, erase data (`backup-*.ts`, `data-ownership.ts`)
- Pre-migration DB snapshots, WAL, and per-revision read caching (`db/snapshot.ts`)
- Undo-on-every-write pattern, `+native-intent.tsx` deep links, the dev-client setup and the Health sync fixes (sync whatever types were granted)
- Chart screens with 1W–All ranges

## Build order and acceptance gates

| Stage                        | Deliverable                                                                                                                                                           | Gate                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 0. Separate                  | New identity (name, `dev.svindland.vector.lift`, `lifttrack://`, `lift_track.db`, icon), strip Body features, port Macros infrastructure, bundle the exercise library | Installs next to Body and Macros; the library opens and searches offline         |
| 1. Log a workout             | Freestyle workouts, logger, set types, rest timer + notifications, plate math, gyms, history                                                                          | A full week of real training logged in the gym, including app kills mid-set      |
| 2. Programs                  | Templates, mesocycles, progression recommendations, substitutions, deloads                                                                                            | Recommendations are sane for synthetic lifters; each has an explanation          |
| 3. Autoregulation + Progress | Muscle feedback, weekly volume adjustment, analytics, PRs                                                                                                             | A simulated 5-week meso stays within caps; early-deload logic triggers correctly |
| 4. Native polish             | Live Activity rest timer, Health workouts, quick actions (Start next workout), widget                                                                                 | Device QA on iPhone and Android                                                  |
| 5. On-device AI              | Say/type a workout, program import, constraint parsing                                                                                                                | Faster than manual on a timed test set, with no network use                      |
| Later                        | Wear OS logging, exercise media, cardio, Vector Macros energy sharing via Health                                                                                      | —                                                                                |

## Status (September 26, 2026)

Stages 0–4 are built on `lift/foundation`:

- Identity and exercise library
- Logger and rest timer
- Programs with progression and feedback-driven volume ([docs/progression.md](progression.md))
- Progress analytics
- Native polish:
  - Live Activity rest timer and Android ongoing notification
  - Health workout export
  - Quick actions and `lifttrack://start`

  The home-screen widget is deferred.

The Progress tab replaced a History tab; history opens from Progress.

Apple Watch logging is built on `lift/apple-watch` ([docs/watch.md](watch.md)): start or follow a workout, one-tap sets with crown-adjusted loads and reps, effort colors during rest, and an unsaved Watch workout session that keeps the app on the wrist.

Encrypted backup, restore with recovery, CSV export and erase are also built ([docs/backups.md](backups.md)). Stage 5 on-device AI is built as well ([docs/ai.md](ai.md)); the model path still needs a real iPhone and Android phone.

## Decisions (September 26, 2026)

- Public name **Vector Lift**, home-screen label **Lift**.
- Build the logger first (stages 0–1), then programs.
- Apple Watch comes later.
- Post-session muscle feedback is optional, one tap per muscle. When skipped, performance trends decide.

## Open decisions

1. Exercise media: text + muscle map at launch, or license or commission illustrations? The free-exercise-db data is public domain (Unlicense). Its images come from an older scraped project, so their provenance isn't clean enough to ship without review.
2. Pricing: one-time unlock as with the other Vector apps. Undecided.
