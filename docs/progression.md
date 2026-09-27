# Programs and progression, method 2

Vector Lift writes every set of a program session before you start it, and prefills every exercise in a free workout. The rules below are deterministic: the same history always gives the same prescription, and each exercise shows one line on why. On phones with their own model, a note about a session can nudge the result one step either way ([on-device AI](ai.md#nudges-from-a-note)). The nudge is marked and can be undone, and without a note or a model nothing changes.

The aim is progressive overload: a session done as prescribed is always followed by a bit more, one rep or the next load. Two quick signals steer it:

- **Effort** (per set) moves loads and reps.
- **Soreness and workload** (per muscle, after a session) move sets.

The code is in `src/lib/progression.ts` (loads and reps), `src/lib/programs.ts` (weeks, sets and sessions) and `src/lib/program-builder.ts` (building a program).

## A program

A program (mesocycle) is 3–6 accumulation weeks followed by a deload week. Each accumulation week has a reps-in-reserve (RIR) target for every working set:

| Weeks | RIR by week      |
| ----- | ---------------- |
| 4     | 3, 2, 1, 0       |
| 5     | 3, 2, 2, 1, 0    |
| 6     | 3, 3, 2, 2, 1, 0 |

The app states RIR in plain words ("2 reps in reserve", "to failure").

Sessions run in order: week 1 day 1, week 1 day 2, and so on. A missed day is not skipped for you. It stays next until you do it or skip it from the Plan grid. Any cell in the grid can be started early.

## Building one

You answer four questions: days a week (2–6), minutes a session, training age and weeks before the deload. Two pages then list every muscle: pick up to three to bring up, then any of the rest to bring down. The split follows the days:

- 2–3 days: full body A/B(/C)
- 4 days: upper/lower ×2
- 5 days: upper, lower, push, pull, legs
- 6 days: push/pull/legs ×2

Each day lists movements in order of importance. A 30-minute session takes the first 4, 45 minutes 5, 60 minutes 6, 75 minutes 7 and 90 minutes 8. Advanced lifters get one more.

A muscle brought up always keeps its movement and gets one extra set. The least important other movement makes room for it.

A muscle brought down keeps only its first movement of each day, with one set fewer. The next movements on the list fill the room, so sessions stay the same length.

Exercises are picked in this order:

1. Your favorites for that movement.
2. A preferred list of well-tolerated, easily loaded choices.
3. Anything else in the library for that movement and muscle.

Only equipment your gym has is used, and exercises marked Avoid are skipped. A movement used twice in a week alternates between its first two choices.

Week one starts low:

- Early compound slots get 3 sets and later ones 2, or 2 each for lifters under a year.
- No muscle starts above 8, 10 or 12 primary sets a week (by training age). A muscle brought up gets 2 more, and a muscle brought down starts at 4 at most. Sets are trimmed from the fullest, latest slot until it fits.

Everything can be edited before starting, and the running program can be edited later. Surviving slots keep their history.

## Effort

After a working set, the rest bar shows three buttons; the set row's **Feel** dot does the same any time. One tap, or none:

| Color  | Means         | Read as reps in reserve                    |
| ------ | ------------- | ------------------------------------------ |
| Red    | Hard          | 1, or 0 when the target was already 1 or 0 |
| Orange | Good          | the target, kept within 1–3                |
| Green  | Easy          | 4, or the target + 2 if that's more        |
| none   | As prescribed | the week's target (0 if reps fell short)   |

RIR typed in shorthand ("bench 100x8 @2") still counts, and wins over a color.

## Loads and reps

For each exercise the app looks at the last session that did it, skipping deload sessions.

- **First time.** No load; reps in the middle of the range. The line reads, for example, "pick a load you could do 13 times, stop at 10".
- **Estimated 1RM.** Each completed working set gives reps + reps in reserve = reps to failure, and Epley turns that into a 1RM estimate. The best set counts. Reps in reserve are, in order:
  1. what you typed;
  2. otherwise the effort color, read against the set's target;
  3. otherwise 0 if you fell short of the set's target reps;
  4. otherwise that week's target.
- **Picking the load.** For this week's RIR, reps at a load = reps to failure at that load − RIR.
  - Keep last time's load while that lands inside the rep range.
  - Above the range, take the lightest heavier load the gym can make that lands in range.
  - Below the range, take the heaviest lighter load that reaches the bottom of it.
  - A jump may land one rep under the range; the next session adds the rep back.
  - When even that is out of reach (a big dumbbell step, a machine stack), reps run up to 3 past the top of the range until the next load fits: 30 lb × 12, 13, 14, then 35 × 7. At 3 past with no load in reach, it holds ("top of the range").
- **A step every session.** If last time kept up (no set short of its target reps, and the first set not harder than planned), the next one is at least one rep more at the same load, or the next load. This covers weeks whose RIR target doesn't fall (5- and 6-week blocks) and free workouts. It doesn't apply when this week asks for more reps in reserve than last time, as the first week of a new block does.
- **Falling behind.** Red on the first set, or a set short of its target, means no step: the estimate decides, which holds or backs off. Three sessions in a row behind adds "a swap may help" to the line.
- **Loads the gym can make.** Barbells use your bar and plates in pairs; plate-loaded machines use pairs of plates; dumbbells use your step up to your heaviest pair; machines and cables use the stack step.
- **Bodyweight and assisted exercises.**
  - With a body weight on record, a pull-up's load is body weight + added weight, and an assisted pull-up's is body weight − assistance. Progress comes from adding load or taking away assistance.
  - Without a body weight, reps progress alone.
- **Later sets** keep last time's drop-off in reps from the first set, so 10/9/8 last time becomes 11/10/9 this time.
- **Free workouts** use the same rules at last time's effort instead of a weekly target, so an exercise done as before comes back one step on, with the same line on why.

Because the RIR target falls each week, and flat weeks still earn a step, targets rise every week. Green sets show real strength gains in the estimate and move the targets further.

## Sets per muscle

Week one uses the plan. Each later week, a day's sets start from last week's same day. Each muscle trained as a primary mover then moves by:

| After last week's session         | Change     |
| --------------------------------- | ---------- |
| Workload "Easy"                   | +2 sets    |
| Workload "Good"                   | +1         |
| Workload "Hard" or "Hurt"         | hold       |
| Workload "Too much"               | −1         |
| No workload answer, every rep hit | +1         |
| No workload answer, anything else | hold       |
| Missed by 2+ reps on most sets    | −1 at most |

Soreness then caps the result:

| Coming into the next session | Cap          |
| ---------------------------- | ------------ |
| Not sore, or no answer       | none         |
| Just recovered               | hold at most |
| Still sore                   | −1           |

Both are optional taps per muscle on the session summary. Soreness is asked as "coming in", so it's answered at the next session that trains the muscle and speaks for the one before. For a muscle trained once a week that answer arrives a week late, so the session's own answer stands in until a newer one exists.

A muscle brought down never gains sets. It can still lose them.

Missing reps overrides positive feedback: good feedback holds instead of adding when most sets fell 2 or more reps short.

A set is added to the slot with the fewest sets for that muscle, and taken from the one with the most. Limits: a slot has 1–6 sets, and a muscle gets at most 10 primary sets in one session. "Hurt" also deserves a swap; the exercise menu offers one.

## Deload

The final week halves last week's sets (rounding up) and uses 90% of the last top load at the bottom of the rep range with 4 reps in reserve. Deload sessions are ignored when the next block works out its loads.

**Run again** starts a new block with the same days, and loads carry over from your history. Week-one sets are the last block's, plus one for each muscle that grew by 2 or more weekly sets and ended the block without "Still sore", "Too much" or "Hurt". The set goes where that muscle has the fewest. Muscles brought down don't grow.

## Swaps

A swap in a program session can be for today or for the rest of the program. Either way the new exercise keeps the slot and gets a real prescription for the week, rather than empty targets. Exercises added on the day follow last time's numbers, as in a free workout.

## Limits

- These are product heuristics built on RIR-based autoregulation and volume-landmark ideas, not individual prescriptions. The starting volumes, caps and the +1/+2 steps are choices, not validated thresholds.
- Epley overestimates at high reps; estimates beyond about 12 reps to failure are rough.
- The method is versioned on each program (`method`). A later method won't reinterpret old blocks, and every session stores what it prescribed. Method 2 added effort colors, the step every session, reps past the range for big jumps, stalls, soreness, free-workout progression and growth between blocks.

Tests (`tests/programs.test.cjs`) cover:

- keeping and raising loads
- drop-off
- missed reps
- dumbbell jumps
- pounds
- first time, deload, bodyweight and assisted
- a simulated lifter across a 5-week block
- the builder across splits, equipment, session length, priorities, Avoid and starting volume
- bringing a muscle up and another down, and the one brought down holding its sets
- a program run through feedback, skips, week-2 sets and loads, the deload and editing

`tests/overload.test.cjs` covers method 2:

- effort colors
- a step on flat-RIR weeks, with holds for hard or missed sets and none owed at a new block
- reps past the range until a dumbbell jump fits
- a five-week block rising every week for three kinds of equipment
- stalls
- bodyweight reps without a body weight
- soreness caps and where they're answered
- running a block again
