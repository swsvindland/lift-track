# On-device AI

Vector Lift uses the phone's own model only to turn words into structure: Apple Foundation Models (Apple Intelligence) on iPhone, Gemini Nano on supported Android phones. Loads, reps and sets come from [the progression method](progression.md). The model never produces a number. What it reads from a session note can only nudge the method one step either way, and each nudge shows the model's mark and can be undone.

Every other result is a draft you confirm. Nothing is sent anywhere, there's no cloud fallback, and phones without a model keep every feature through shorthand parsing and manual entry.

## What it does

| Where                                                       | What you give it                                                                               | What you get                                                                                    | Without a model                                                                               |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Workout → **Type or say**                                   | "bench 225x5x3, incline db 30s for 12 12 10", typed or dictated with the keyboard's microphone | Exercises matched to the library with their sets, logged as done after you confirm              | Shorthand is read                                                                             |
| Plan → **Import a program**                                 | Pasted text, or a photo of a printed or handwritten page                                       | Days, exercises, sets and rep ranges, reviewed, then opened in the program editor               | Lists like "Bench Press 3x6-8" are read; photos are read with text recognition on every phone |
| Build a program → **Describe what you want**                | "4 days, an hour, only dumbbells, cranky shoulder, bigger arms, smaller quads"                 | The builder's answers filled in; equipment narrowed; painful movements left out of this program | Days, minutes and weeks are read                                                              |
| Add exercise, no results → **Find it from the description** | "machine where you push your knees out"                                                        | Library exercises with that movement, muscles and equipment                                     | Not offered                                                                                   |
| Session summary → **How did it go?**                        | "Elbow was cranky on skull crushers, bench flew up, chest is wrecked, slept 4 hours"           | Nudges for next time: push or hold an exercise, a set more or less for a muscle                 | The note is saved; progression runs on its own                                                |

## How it works

1. **Shorthand first.**
   - `workout-text.ts` reads the forms lifters write:
     - load × reps × sets
     - "for 12 12 10"
     - "3x10 @ 50"
     - "3 sets of 10 at 100 kilos"
     - bodyweight and RIR
     - dictated number words
   - `program-text.ts` reads day headings and "3x8-12" / "3 sets of 8–12" lines.
   - Either runs instantly, on any phone.
2. **The model only when needed.** It's asked only when shorthand leaves something unread, such as prose, a messy page or OCR columns.
   - Replies are decoded against a JSON schema; on iOS, `appleSchema` adds the titles, ordering and closed objects Apple's decoder needs.
   - Every value is checked and clamped, and items without a name or reps are dropped.
   - A day heading read as an exercise ("push") is dropped.
   - If the model fails or declines, whatever shorthand read stands.
3. **Matching.** `matchExercise` finds the library exercise a name means:
   - It understands gym slang (db, bb, ohp, rdl, bss), plurals and one-letter typos, and drops trailing words until something matches.
   - Bare names mean the classic lift: "bench" is the barbell bench press, "squat" the back squat.
   - Your own history can override that.
   - A match that didn't cover every word is shown as **check this match**.
4. **Photos.** Text recognition runs on every supported phone, with or without Apple Intelligence or Gemini Nano: Apple Vision on iOS, the bundled ML Kit Latin recognizer on Android.
   - A page photographed sideways is read in each orientation, keeping the one with the most real words.
   - Lines are put back in reading order, and the photo is deleted once read.

The native bridge is the `local-ai` module from Vector Macros, with its text-recognition orientation check made general. It runs Foundation Models' `SystemLanguageModel` only, never Private Cloud Compute, and ML Kit GenAI's Prompt API on Android.

## Nudges from a note

The note is read with a numbered list of what was done and the muscles trained. The reply can only:

- **push** an exercise the note says felt easy or strong: last time counts as one rep easier, so the method steps further;
- **hold** an exercise the note says hurt, felt off or was a struggle: last time's targets again, with no step and no back-off;
- move a muscle the note calls beaten up or under-worked by **one set**, within the method's limits;
- say the lifter was **run down** (sleep, illness, stress): exercises that fell behind that day are held instead of backed off from.

Exercises and muscles not in the session are dropped, as is anything outside those choices. Nudges are applied when the next session is built: exercise nudges the next time that exercise comes up, set nudges the next time that program day does. The session summary lists them under **Next time**, each with an ✕. In the workout, each changed exercise shows the mark, the reason and **Undo**. Undo puts back the set count and targets the method alone would give, and dismisses the nudge. The code is `readSessionNote` in `lift-ai.ts`, `saveNudges`/`exerciseNudge` in `workouts.ts` and `planDay`/`undoAi` in `programs.ts`.

## Verification

- **Tests:** `pnpm test` (`tests/ai.test.cjs`) covers:
  - shorthand and dictation
  - prose left for the model
  - written programs with bullets, numbering, columns and notes
  - library matching, including every classic name resolving
  - the model asked only when needed
  - replies validated, model failures falling back
  - builder hints and describing an exercise
  - Apple schema completion and OCR line order
- **Tests:** `tests/nudges.test.cjs` covers:
  - a note's reply bounded and checked
  - push and hold
  - nudges applied to a program session and undone
  - a rough day holding instead of backing off
- **Same prompts on this Mac:** the schemas and prompts were run against the same on-device model on macOS 27:
  - The curls sentence came back as 40×12, 40×12, 35×10 lb.
  - A one-line push/pull/legs page came back as the right 10 exercises on 3 days. An instruction that named day words made the model use them as exercises, so it was reworded, and the reply filter drops them anyway.
  - The builder sentence came back as 4 days, 60 minutes, side delts, biceps and triceps, dumbbells, avoid overhead pressing. The model also added bands, which weren't mentioned.
- **Simulators:** the iOS 26.5 and iOS 27 simulators both report the model as available, but every call fails with an opaque `GenerationError -1`, even though the same prompts and schemas work from macOS. The app now says so ("The on-device model didn't answer. Shorthand still works…") instead of showing a native error. What was checked there:
  - Typing and matching shorthand, and logging the sets.
  - Importing a typed push/pull program: 8 of 8 exercises matched, then opened in the editor.
  - The describe-to-find button.

  A real iPhone with Apple Intelligence is the remaining check for the model path. The session note prompt hasn't been run against the real model yet.

- **Still to do:** Android compiles with the module from Vector Macros but hasn't run Gemini Nano on a device. Before release, test on current and older iPhones and a midrange Android, with real dictation and real printed programs.
