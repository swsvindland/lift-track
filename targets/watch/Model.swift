import Foundation
import SwiftUI

/* What the phone sends (src/lib/watch.ts, WatchState) and what the Watch sends back. The phone
   is the source of truth; the Watch only adds its own taps on top until the phone acks them. */

enum Effort: String, Codable, CaseIterable, Identifiable {
  case hard, good, easy
  var id: String { rawValue }

  /// Shown as 1–3 filled bars (EffortMark) in its colour: the count reads without the colour.
  var level: Int {
    switch self {
    case .easy: return 1
    case .good: return 2
    case .hard: return 3
    }
  }

  /// The phone's effort colours: red, amber and green, from the kit's status tokens.
  var color: Color {
    switch self {
    case .hard: return VectorColor.danger
    case .good: return VectorColor.warning
    case .easy: return VectorColor.success
    }
  }
}

enum SetKind: String, Codable {
  case warmup, working, drop, myo
}

struct WatchSet: Codable, Identifiable, Equatable {
  let id: Int
  let kind: SetKind
  var weightKg: Double?
  var reps: Int?
  var done: Bool
  /// When it was checked off, in milliseconds since 1970: the Watch follows the latest one.
  var doneAt: Double?
  var effort: Effort?
}

struct WatchExercise: Codable, Identifiable, Equatable {
  let id: Int
  let name: String
  let repMin: Int
  let repMax: Int
  /// Its superset, shared with the exercises it alternates with; nil when it stands alone.
  let superset: Int?
  /// Seconds of rest after a working set; 0 inside a superset until its last exercise.
  let rest: Int
  /// Loads the crown steps through, in kg, ascending.
  let loads: [Double]
  var sets: [WatchSet]
}

struct Rest: Codable, Equatable {
  /// Milliseconds since 1970, as in JavaScript.
  let endsAt: Double
  let total: Double
  let label: String
  let setId: Int?

  var end: Date { Date(timeIntervalSince1970: endsAt / 1000) }
}

struct Workout: Codable, Equatable {
  let id: Int
  let name: String
  let startedAt: Double
  var exercises: [WatchExercise]
  var rest: Rest?

  /// The next set to do. It follows where you are rather than the list order: more of the exercise
  /// with the latest set done (in a superset, the next one in it), else the first exercise with sets
  /// left, so one skipped because its rack was taken comes back next. `chosen`, an exercise picked on
  /// the Watch, leads while it has sets left. The phone's rest names the same exercise (`upNext` in
  /// src/lib/workouts.ts).
  func current(chosen: Int? = nil) -> (exercise: Int, set: Int)? {
    if let chosen, let e = exercises.firstIndex(where: { $0.id == chosen }), let s = remaining(e) {
      return (e, s)
    }
    var latest: (exercise: Int, at: Double)?
    for (e, exercise) in exercises.enumerated() {
      for set in exercise.sets where set.done {
        if let at = set.doneAt, at >= latest?.at ?? -.infinity { latest = (e, at) }
      }
    }
    if let latest {
      let group = exercises[latest.exercise].superset
      let members = exercises.indices.filter {
        $0 == latest.exercise || (group != nil && exercises[$0].superset == group)
      }
      let at = members.firstIndex(of: latest.exercise) ?? 0
      for k in 1...members.count {
        let e = members[(at + k) % members.count]
        if let s = remaining(e) { return (e, s) }
      }
    }
    for e in exercises.indices {
      if let s = remaining(e) { return (e, s) }
    }
    return nil
  }

  /// The first set still to do in an exercise: open, and after its last done set. Open sets before
  /// that were skipped (warm-ups nobody checked off) and don't hold it open.
  func remaining(_ e: Int) -> Int? {
    let sets = exercises[e].sets
    let last = sets.lastIndex { $0.done } ?? -1
    return sets.indices.first { $0 > last && !sets[$0].done }
  }

  var doneCount: Int { exercises.reduce(0) { $0 + $1.sets.filter(\.done).count } }

  func find(_ setId: Int) -> (exercise: Int, set: Int)? {
    for (e, exercise) in exercises.enumerated() {
      if let s = exercise.sets.firstIndex(where: { $0.id == setId }) { return (e, s) }
    }
    return nil
  }
}

struct StartOption: Codable, Equatable {
  let title: String
  let detail: String
}

struct WatchState: Codable {
  let v: Int
  let sentAt: Double
  let unit: String
  let workout: Workout?
  let start: StartOption?
  let acked: [String]
}

struct Command: Codable, Equatable {
  enum Kind: String, Codable { case start, log, rate, skipRest, finish }

  var id = UUID().uuidString
  let type: Kind
  var setId: Int? = nil
  var weightKg: Double? = nil
  var reps: Int? = nil
  var effort: Effort? = nil
  var workoutId: Int? = nil
  /// When a log was tapped, in milliseconds since 1970, so the Watch follows it before the phone acks.
  var at: Double? = nil
}

/// A load in the display unit without trailing zeros: 80, 102.5, 11.25; no added load is "BW".
func loadText(_ kg: Double, unit: String) -> String {
  if kg == 0 { return "BW" }
  let value = ((unit == "kg" ? kg : kg / 0.45359237) * 100).rounded() / 100
  // With the locale's decimal separator: 102,5 in de and fr.
  return value.formatted(.number.precision(.fractionLength(0...2)))
}
