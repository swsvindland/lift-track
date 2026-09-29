import SwiftUI

struct WorkoutView: View {
  let workout: Workout
  let unit: String
  private var phone = Phone.shared

  init(workout: Workout, unit: String) {
    self.workout = workout
    self.unit = unit
  }

  var body: some View {
    if let rest = phone.rest {
      RestView(rest: rest, rated: rated(rest))
    } else if let current = workout.current {
      let exercise = workout.exercises[current.exercise]
      let next = current.exercise + 1
      SetView(
        exercise: exercise,
        set: exercise.sets[current.set],
        next: workout.exercises.indices.contains(next) ? workout.exercises[next] : nil,
        unit: unit
      )
      .id(exercise.sets[current.set].id)
    } else {
      DoneView()
    }
  }

  /// The set the rest follows, when it can be rated.
  private func rated(_ rest: Rest) -> WatchSet? {
    guard let id = rest.setId, let at = workout.find(id) else { return nil }
    let set = workout.exercises[at.exercise].sets[at.set]
    return set.done && set.kind != .warmup ? set : nil
  }
}

/// The set to do now: its load and reps, prefilled, and one tap to log it.
struct SetView: View {
  let exercise: WatchExercise
  let set: WatchSet
  let next: WatchExercise?
  let unit: String

  private enum Field { case weight, reps }
  @FocusState private var focus: Field?
  @State private var loadIndex: Double
  @State private var reps: Double
  private var session = Session.shared

  init(exercise: WatchExercise, set: WatchSet, next: WatchExercise?, unit: String) {
    self.exercise = exercise
    self.set = set
    self.next = next
    self.unit = unit
    let target = set.weightKg ?? 0
    let nearest = exercise.loads.indices.min {
      abs(exercise.loads[$0] - target) < abs(exercise.loads[$1] - target)
    }
    _loadIndex = State(initialValue: Double(nearest ?? 0))
    _reps = State(initialValue: Double(set.reps ?? exercise.repMin))
  }

  private var weightKg: Double {
    guard !exercise.loads.isEmpty else { return set.weightKg ?? 0 }
    let index = min(max(Int(loadIndex.rounded()), 0), exercise.loads.count - 1)
    return exercise.loads[index]
  }

  private var setLabel: String {
    switch set.kind {
    case .warmup: return "Warm-up"
    case .drop: return "Drop set"
    case .myo: return "Myo-reps"
    case .working:
      let working = exercise.sets.filter { $0.kind == .working }
      let number = (working.firstIndex { $0.id == set.id } ?? 0) + 1
      return "Set \(number) of \(working.count)"
    }
  }

  var body: some View {
    // Scrolls when Dynamic Type or a small Watch makes the set taller than the screen.
    ScrollView {
      VStack(alignment: .leading, spacing: 6) {
        Text(exercise.name)
          .font(.headline)
          .lineLimit(2)
          .minimumScaleFactor(0.75)
        HStack {
          Text("\(setLabel) · \(exercise.repMin)–\(exercise.repMax)")
            .foregroundStyle(.secondary)
            .lineLimit(1)
          Spacer(minLength: 4)
          if let bpm = session.heartRate {
            Label("\(bpm)", systemImage: "heart.fill")
              .labelStyle(.titleAndIcon)
              .foregroundStyle(.red)
              .monospacedDigit()
          }
        }
        .font(.footnote)

        HStack(spacing: 6) {
          ValueTile(value: loadText(weightKg, unit: unit), caption: unit, focused: focus == .weight)
            .focusable()
            .focused($focus, equals: .weight)
            .digitalCrownRotation(
              $loadIndex, from: 0, through: Double(max(exercise.loads.count - 1, 0)), by: 1,
              sensitivity: .low, isContinuous: false, isHapticFeedbackEnabled: true
            )
            .onTapGesture { focus = .weight }
            .accessibilityLabel("Weight \(loadText(weightKg, unit: unit)) \(unit)")
          ValueTile(value: "\(Int(reps.rounded()))", caption: "reps", focused: focus == .reps)
            .focusable()
            .focused($focus, equals: .reps)
            .digitalCrownRotation(
              $reps, from: 0, through: 100, by: 1,
              sensitivity: .low, isContinuous: false, isHapticFeedbackEnabled: true
            )
            .onTapGesture { focus = .reps }
            .accessibilityLabel("\(Int(reps.rounded())) reps")
        }

        Button {
          Phone.shared.log(
            exercise: exercise, set: set, weightKg: weightKg, reps: Int(reps.rounded()), next: next)
        } label: {
          Label("Log", systemImage: "checkmark")
            .font(.headline)
            .frame(maxWidth: .infinity)
        }
        .vectorPrimaryButton()
        .vectorPrimaryAction()
        .vectorHiddenWhenDimmed()
      }
      .frame(maxWidth: .infinity, alignment: .topLeading)
    }
    .vectorWatchTypeCap()
    // Reps change most from set to set, so the crown starts on them.
    // Set after the first layout: an initial focus value is overridden by the first focusable tile.
    .onAppear { DispatchQueue.main.async { focus = .reps } }
  }
}

struct ValueTile: View {
  let value: String
  let caption: String
  let focused: Bool

  var body: some View {
    VectorDataTile(focused: focused) {
      VStack(spacing: 0) {
        Text(value).vectorReadout(.title2, weight: .medium)
        Text(caption)
          .font(.caption2)
          .foregroundStyle(.secondary)
      }
    }
  }
}

/// The rest after a set: time left, what's next, and how hard the set was in one tap.
struct RestView: View {
  let rest: Rest
  let rated: WatchSet?

  var body: some View {
    ScrollView {
      VStack(spacing: 6) {
        Text(timerInterval: Date()...max(rest.end, Date()), countsDown: true)
          .vectorReadout(.largeTitle, weight: .medium)
          .frame(maxWidth: .infinity)
        Text(rest.label)
          .font(.footnote)
          .foregroundStyle(.secondary)
          .lineLimit(1)
        if let set = rated {
          HStack(spacing: 6) {
            ForEach(Effort.allCases) { effort in
              EffortButton(effort: effort, selected: set.effort == effort) {
                Phone.shared.rate(set.id, effort)
              }
            }
          }
          .vectorHiddenWhenDimmed()
        }
        Button {
          Phone.shared.skipRest()
        } label: {
          Text("Skip rest").frame(maxWidth: .infinity)
        }
        .vectorSecondaryButton()
        .vectorPrimaryAction()
        .vectorHiddenWhenDimmed()
      }
    }
    .vectorWatchTypeCap()
  }
}

struct EffortButton: View {
  let effort: Effort
  let selected: Bool
  let action: () -> Void

  private var label: String {
    switch effort {
    case .hard: return "Hard"
    case .good: return "Good"
    case .easy: return "Easy"
    }
  }

  private var hint: String {
    switch effort {
    case .hard: return "0–1 reps left"
    case .good: return "1–3 left"
    case .easy: return "4+ left"
    }
  }

  var body: some View {
    Button(action: action) {
      VStack(spacing: 3) {
        EffortMark(level: effort.level)
        Text(label).font(.caption2).lineLimit(1).minimumScaleFactor(0.8)
      }
      // Selected is the icon look: signal fill, #071017 content. A capsule, the Watch's control shape.
      .foregroundStyle(selected ? VectorColor.signalInk : Color.primary)
      .frame(maxWidth: .infinity, minHeight: VectorMetrics.minTarget)
      .background(Capsule().fill(selected ? VectorColor.signal : Color.clear))
      .overlay(
        Capsule().strokeBorder(selected ? Color.clear : Color.primary.opacity(0.3), lineWidth: 1)
      )
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .accessibilityLabel("\(label), \(hint)")
    .accessibilityAddTraits(selected ? .isSelected : [])
  }
}

/// Every set is logged: finish here to stop the clock. The questions wait on the phone.
struct DoneView: View {
  var body: some View {
    ScrollView {
      VStack(spacing: 6) {
        Image(systemName: VectorSymbol.done)
          .font(.title)
          .foregroundStyle(VectorColor.signal)
        Text("All sets logged")
          .font(.headline)
        Text("How it went waits on your iPhone.")
          .font(.footnote)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
        Button {
          Phone.shared.finish()
        } label: {
          Label("Finish", systemImage: "flag.checkered")
            .font(.headline)
            .frame(maxWidth: .infinity)
        }
        .vectorPrimaryButton()
        .vectorPrimaryAction()
        .vectorHiddenWhenDimmed()
      }
    }
    .vectorWatchTypeCap()
  }
}

/// Effort as 1–3 ascending bars: the count carries the meaning, not a hue. Filled bars take the
/// current foreground; empty ones are outlined.
struct EffortMark: View {
  let level: Int

  var body: some View {
    HStack(alignment: .bottom, spacing: 2) {
      ForEach(1...3, id: \.self) { i in
        let filled = i <= level
        RoundedRectangle(cornerRadius: 1)
          .fill(filled ? AnyShapeStyle(.foreground) : AnyShapeStyle(Color.clear))
          .overlay(
            RoundedRectangle(cornerRadius: 1)
              .strokeBorder(filled ? Color.clear : Color.primary.opacity(0.4), lineWidth: 1)
          )
          .frame(width: 3, height: CGFloat(3 + 3 * i))
      }
    }
    .accessibilityHidden(true)
  }
}
