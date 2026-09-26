# RP Hypertrophy and MacroFactor Workouts: feature review

September 26, 2026. This review draws on public product pages, help-center articles, App Store listings and third-party reviews. Several of those reviews are from competing apps. Items marked *uncertain* could not be confirmed in official documentation. The purpose is to see what users expect. Neither app's algorithm is published, and we do not copy them.

## RP Hypertrophy

- **Programs:** mesocycles of 4–6 weeks whose volume, load and effort rise, followed by a deload. You start from premade templates (45+, or "100+" per RP's site), including specialization plans, or build your own with muscle priorities in the Meso Builder. There is no questionnaire generator. ([product page](https://rpstrength.com/pages/hypertrophy-app), [App Store](https://apps.apple.com/us/app/rp-hypertrophy/id1555614554))
- **Load:** weight rises by "a few percent" per week. When the next available increment is too big, the app adds a rep to each set instead. (RP help center, *How does the app determine when to add weight, reps and sets*)
- **Sets:** after you train a muscle, it asks about pump, soreness/recovery and workload. A weak pump, low soreness and easy workload add sets. A great pump, recovery that was only just in time, or a workload that pushed your limits hold volume. Joint-pain answers mostly flag exercises to swap. This follows RP's MEV/MAV/MRV model. The weekly RIR drops toward 0, but the exact sequence is *uncertain*.
- **Logging:** myo-reps and myo-rep match, supersets, swaps for equipment, and last week's weight × reps.
- **Reported gaps:** no rest timer (*uncertain* whether one has shipped since), no history calendar, no cardio, and you can't move the meso start day. No Watch app or plate calculator was found.
- **Library:** 250+ technique videos and custom exercises. Each exercise maps to a single muscle, with no fractional volume.
- **Analytics:** thin.
- **Platform:** account required, reportedly no offline mode. Web, iOS and Android. $34.99/month or $299.99/year. No AI.
- **Complaints:** price, clutter, subjective questions that confuse beginners, opaque rules and weak analytics. ([mesostrength](https://mesostrength.com/blog/rp-hypertrophy-alternatives), [dr-muscle](https://dr-muscle.com/rp-hypertrophy-app-for-strength-training-expert-review/))

## MacroFactor Workouts

Released January 2026 as an app separate from MacroFactor. ([product page](https://macrofactor.com/workouts/))

- **Programs:** a Smart Program generator uses goal (strength, hypertrophy or both), experience, equipment through gym profiles, and schedule. Programs repeat in cycles, with sets, rep ranges and RIR per exercise. The deload can go at the start or end of a cycle. Sets, reps and RIR can be edited for one week, one exercise, one day or the whole program. There is also a custom builder, import of Jeff Nippard programs and spreadsheets, and ad-hoc workouts. ([periodization help](https://help.macrofactorapp.com/en/articles/389-how-can-i-customize-periodization-rir-reps-and-sets-for-the-exercises-in-my-program))
- **Progression:** rule-based, not generative AI. It uses logged load and reps, logged RIR (0–6+), the rep range and the available increments.
  - **Expand Rep Range** allows 100 × 9 rather than forcing a jump to 105 × 8.
  - **Weight Match** keeps the previous set's weight.
  - It claims to learn each user's strength/endurance relationship and to account for fatigue within a session. The math isn't published.
  - No automatic week-to-week set changes were documented.

  ([smart progression](https://help.macrofactorapp.com/en/articles/305-understanding-and-using-smart-progressions), [RIR](https://help.macrofactorapp.com/en/articles/385-what-is-rir-and-how-should-i-use-it-during-training))
- **Logging:** warm-ups (planned automatically), drop sets, myo-reps, failure sets, partials, supersets, left/right sides, auto rest timer, plate calculator from your bars and plates, smart swaps, notes and previous performance. ([quick start](https://macrofactor.com/welcome-to-macrofactor-workouts/))
- **Library:** 900+ exercises with three-angle Jeff Nippard videos and cues. Custom exercises and multiple gyms.
- **Analytics:** weekly volume per muscle, a "Levels" body-map heatmap, PRs and a customizable dashboard. Body metrics are shared with MacroFactor, but training does not feed expenditure.
- **Platform:** cloud sync, account likely required. $71.99/year, 4.8★ from about 4.6K ratings.
- **Complaints:** RIR jargon, recommended weights you don't own, missing videos, lost or stuck sessions, too many taps, session-length estimates that run short, unexplained progression, and swapped exercises that get no targets. ([App Store](https://apps.apple.com/us/app/macrofactor-workouts-tracker/id6737156524), [Outlift](https://outlift.com/macrofactor-review/))

## What Vector Lift does about it

| Gap in the references | Our answer |
| --- | --- |
| Account, cloud, subscription | No account, no network code; one-time price (undecided) |
| Lost or stuck sessions | Every set is written to SQLite as it's logged, and the workout resumes after an app kill or reboot |
| Opaque progression | Each recommendation carries a one-line reason ("+1 rep: next dumbbell is 12% heavier") |
| Weights you don't own | Loads round to the active gym's plates, dumbbells and machine steps |
| Swapped exercises lose targets | A swap inherits the slot's rep range and RIR, and seeds its load from history or a conservative e1RM ratio |
| Single-muscle volume | Primary 1 set, secondary 0.5 |
| RIR jargon, confusing feedback | Plain-language RIR ("2 more reps possible") and an optional one-tap feedback row per muscle |
| No or clunky rest timer | Auto-start, lock-screen Live Activity or ongoing notification |
| Too many taps | A set done as prescribed takes one tap |
| No Watch | Later milestone; a phone Live Activity first |
