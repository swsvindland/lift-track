# Apple Watch

The Watch logs the open workout from the wrist. The phone stays the only source of truth, and
the Watch never holds a workout of its own.

## Screens

- **No workout, nothing to start:** "Set up a workout on your iPhone". A plan is built on the phone.
- **No workout, something to start:** the program's next session (or, without a program, a repeat of
  the last workout) with **Start**. The phone starts it exactly as its own Start does.
- **Set:** exercise, "Set 2 of 4 · 8–12", and heart rate. Load and reps are prefilled from the
  prescription. Tap a tile, then turn the crown. Reps take the crown first. Load steps through
  what the workout's gym can make near the target. **Log** checks the set off in one tap. The list
  button picks another exercise, for when the one up next has its rack taken.
- **Rest:** after a working set that rests, you get a countdown, what's next, and Hard / Good / Easy
  to rate the set (the phone's red, amber and green effort bars, not typed RIR). **Skip rest** ends
  it. The Watch taps your wrist when rest is over and shows the next set. Warm-ups and sets inside
  a superset go straight to the next set.
- **All sets logged:** **Finish** ends the workout on the phone, so the clock stops at the gym, not
  whenever you next open the phone. The phone saves the Health workout, and if it's still on the
  workout screen it moves to "Workout done". The post-session questions wait on the phone.

A workout started on the phone opens Lift on the Watch (`HKHealthStore.startWatchApp`).
Effort colors match the phone's: the kit's danger, warning and success tokens (`effortFill` in
`src/components/workout/effort.tsx`, `Effort.color` on the Watch).

## Which set is next

The Watch follows where you are, not the order of the list:

- After a set, it stays on that exercise while it has sets left. In a superset it moves to the next
  exercise in the superset, and wraps back to the first one.
- Once an exercise is done, it goes to the first exercise with sets left. An exercise you skipped
  because its rack was taken comes back next, after the one you did instead.
- Open sets before an exercise's last done set count as skipped (warm-ups nobody checked off), so
  they don't hold it open.
- The list button on the set screen picks another exercise. The pick leads until the next set is
  logged, on the Watch or on the phone.

The phone names the same exercise in its rest ("Next: Squat"): `upNext` in `src/lib/workouts.ts`
and `Workout.current` in `targets/watch/Model.swift` follow the same rule. The Watch knows the
latest set from each set's `doneAt` and the superset from each exercise's `superset`.

## Questions later

After a program session, the muscle questions stay open on Today ("How did it go?"), with
**Answer** and **Skip**. They stay there however late you get to them, until you answer one or skip,
or until the next workout starts. This covers finishing on the Watch and being too busy after a
phone finish alike.

## Watch workout session

While a workout is open, the Watch runs a strength-training `HKWorkoutSession`. This keeps Lift
on the wrist between sets and shows heart rate. When the workout ends, the session is
**discarded**, not saved. The phone writes the one Health workout (see the Health section of the
README), so nothing is counted twice.

## Sync

`src/lib/watch.ts` builds the state and applies commands. It is tested in
`tests/watch.test.cjs`. `src/components/watch-link.tsx` connects it to the native module in
`modules/watch-link`.

- **Phone → Watch:** the whole open workout, including every set, crown loads and rest lengths,
  plus the running rest and the Start option. It goes as the application context, and as a message
  too when the Watch app is open. It's resent whenever workout data or the rest timer changes.
- **Watch → phone:** `start`, `log {setId, weightKg, reps}`, `rate {setId, effort}`, `skipRest` and
  `finish {workoutId}`.
  A command goes as a message when the phone is reachable, and is queued with `transferUserInfo`
  otherwise. The phone's native side activates at launch and stores commands in UserDefaults until
  JavaScript listens, so nothing is lost while the app is suspended or not running. Every command
  can safely be applied twice.
- **Optimistic taps:** the Watch applies its own commands on top of the phone's state (including
  "the next set starts from what was just done") until the phone lists their ids in `acked`. This
  lets you keep logging while the phone is out of reach. If the phone app was killed, the commands
  apply the next time it opens.

## Build

The Watch app is `targets/watch` (SwiftUI, watchOS 11). `@bacons/apple-targets` adds it to the
Xcode project at prebuild as `LiftWatch`, with bundle id `dev.svindland.vector.lift.watchkitapp`
and HealthKit enabled. It's embedded in the iPhone app, so `pnpm ios` builds both. For device builds,
set `ios.appleTeamId` in `app.json` (or pick the team in Xcode) so the Watch target signs too.
