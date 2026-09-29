import Foundation
import SwiftUI

/* What the phone sends (src/lib/watch.ts, WatchState) and what the Watch sends back. The phone
   is the source of truth; the Watch only adds its own taps on top until the phone acks them. */

enum Effort: String, Codable, CaseIterable, Identifiable {
  case hard, good, easy
  var id: String { rawValue }

  /// Effort is intensity, not status: shown as 1–3 filled bars (EffortMark), never as a hue.
  var level: Int {
    switch self {
    case .easy: return 1
    case .good: return 2
    case .hard: return 3
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
  var effort: Effort?
}

struct WatchExercise: Codable, Identifiable, Equatable {
  let id: Int
  let name: String
  let repMin: Int
  let repMax: Int
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

  /// The next set to do: the first open one, in order.
  var current: (exercise: Int, set: Int)? {
    for (e, exercise) in exercises.enumerated() {
      if let s = exercise.sets.firstIndex(where: { !$0.done }) { return (e, s) }
    }
    return nil
  }

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
}

/// A load in the display unit without trailing zeros: 80, 102.5, 11.25; no added load is "BW".
func loadText(_ kg: Double, unit: String) -> String {
  if kg == 0 { return "BW" }
  let value = ((unit == "kg" ? kg : kg / 0.45359237) * 100).rounded() / 100
  // With the locale's decimal separator: 102,5 in de and fr.
  return value.formatted(.number.precision(.fractionLength(0...2)))
}
