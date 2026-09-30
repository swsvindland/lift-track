import Foundation
import Observation
import WatchConnectivity
import WatchKit

/// The Watch's view of the phone: the latest state it sent, with taps made here applied on top
/// until the phone lists them in `acked`. Commands go as a message when the phone is reachable
/// and are queued with `transferUserInfo` otherwise, so none are lost.
@Observable
final class Phone: NSObject, WCSessionDelegate {
  static let shared = Phone()

  private(set) var state: WatchState?
  private(set) var pending: [Command] = []
  /// A rest started here, before the phone confirms it, and when.
  private var localRest: (rest: Rest, at: Double)?
  /// A rest skipped here, hidden until the phone's state catches up.
  private var skipped: Double?
  /// An exercise picked here, and how many sets were done then: it leads until another is logged.
  private var chosen: (exercise: Int, done: Int)?
  /// Moves on when a rest runs out, so views drop it.
  private(set) var clock = Date()
  @ObservationIgnored private var restTimer: Timer?

  private let pendingKey = "pending"

  func activate() {
    if let data = UserDefaults.standard.data(forKey: pendingKey),
      let saved = try? JSONDecoder().decode([Command].self, from: data)
    {
      pending = saved
    }
    guard WCSession.isSupported() else { return }
    WCSession.default.delegate = self
    WCSession.default.activate()
  }

  // MARK: What the views read

  /// The open workout with this Watch's unconfirmed taps applied.
  var workout: Workout? {
    guard var workout = state?.workout, !finishing else { return nil }
    for command in pending {
      guard command.type == .log || command.type == .rate, let setId = command.setId,
        let at = workout.find(setId)
      else { continue }
      let (e, s) = at
      switch command.type {
      case .log where !workout.exercises[e].sets[s].done:
        var set = workout.exercises[e].sets[s]
        set.weightKg = command.weightKg
        set.reps = command.reps
        set.done = true
        set.doneAt = command.at
        workout.exercises[e].sets[s] = set
        // As on the phone: the next open set starts from what was just done.
        if let n = workout.exercises[e].sets.firstIndex(where: { !$0.done && $0.kind == set.kind }),
          workout.exercises[e].sets[n].weightKg == nil
        {
          workout.exercises[e].sets[n].weightKg = set.weightKg
          workout.exercises[e].sets[n].reps = set.reps
        }
      case .rate:
        workout.exercises[e].sets[s].effort = command.effort
      default:
        break
      }
    }
    return workout
  }

  /// The exercise picked here, while no set has been logged or unchecked since.
  var picked: Int? {
    guard let chosen, let workout, chosen.done == workout.doneCount else { return nil }
    return chosen.exercise
  }

  var starting: Bool {
    state?.workout == nil && pending.contains { $0.type == .start }
  }

  /// The rest running now: this Watch's own when it's newer than the phone's last word.
  var rest: Rest? {
    let latest: Rest?
    if let local = localRest, local.at > (state?.sentAt ?? 0) {
      latest = local.rest
    } else {
      latest = state?.workout?.rest
    }
    guard let rest = latest, rest.end > clock, rest.endsAt != skipped else { return nil }
    return rest
  }

  // MARK: Taps

  func start() {
    send(Command(type: .start))
  }

  /// Does this exercise next, e.g. when the one up next has its rack taken.
  func choose(_ exercise: Int) {
    chosen = (exercise, workout?.doneCount ?? 0)
  }

  func log(exercise: WatchExercise, set: WatchSet, weightKg: Double, reps: Int) {
    let now = Date().timeIntervalSince1970 * 1000
    send(Command(type: .log, setId: set.id, weightKg: weightKg, reps: reps, at: now))
    WKInterfaceDevice.current().play(.success)
    guard set.kind != .warmup, exercise.rest > 0 else { return }
    // What comes next now that this set is in, as the phone's own rest will name it.
    let next = workout.flatMap { workout in
      workout.current().map { workout.exercises[$0.exercise].name }
    }
    localRest = (
      Rest(
        endsAt: now + Double(exercise.rest) * 1000, total: Double(exercise.rest),
        label: "Next: \(next ?? exercise.name)", setId: set.id),
      now
    )
    scheduleRestEnd()
  }

  func rate(_ setId: Int, _ effort: Effort) {
    send(Command(type: .rate, setId: setId, effort: effort))
  }

  /// Ends the workout on the phone; the Watch shows it gone at once.
  func finish() {
    guard let id = state?.workout?.id else { return }
    localRest = nil
    send(Command(type: .finish, workoutId: id))
  }

  var finishing: Bool {
    pending.contains { $0.type == .finish && $0.workoutId == state?.workout?.id }
  }

  func skipRest() {
    guard let rest else { return }
    skipped = rest.endsAt
    localRest = nil
    send(Command(type: .skipRest))
  }

  // MARK: Sending

  private func send(_ command: Command) {
    if command.type != .skipRest {
      pending.append(command)
      savePending()
    }
    guard let data = try? JSONEncoder().encode(command), let json = String(data: data, encoding: .utf8)
    else { return }
    let payload: [String: Any] = ["command": json]
    let session = WCSession.default
    guard session.activationState == .activated else { return }
    if session.isReachable {
      session.sendMessage(
        payload,
        replyHandler: { [weak self] reply in self?.receive(reply) },
        errorHandler: { _ in session.transferUserInfo(payload) })
    } else {
      session.transferUserInfo(payload)
    }
  }

  private func savePending() {
    UserDefaults.standard.set(try? JSONEncoder().encode(pending), forKey: pendingKey)
  }

  // MARK: Receiving

  private func receive(_ message: [String: Any]) {
    guard let json = message["state"] as? String, let data = json.data(using: .utf8),
      let next = try? JSONDecoder().decode(WatchState.self, from: data)
    else { return }
    DispatchQueue.main.async { self.apply(next) }
  }

  private func apply(_ next: WatchState) {
    guard next.sentAt >= (state?.sentAt ?? 0) else { return }
    state = next
    let before = pending.count
    pending.removeAll { command in
      next.acked.contains(command.id)
        || (command.type == .start ? next.workout != nil : next.workout == nil)
        || (command.type == .finish && next.workout?.id != command.workoutId)
    }
    if pending.count != before { savePending() }
    if skipped != nil, next.workout?.rest?.endsAt != skipped { skipped = nil }
    scheduleRestEnd()
  }

  /// Buzzes when the rest runs out and moves the clock so the next set shows.
  private func scheduleRestEnd() {
    restTimer?.invalidate()
    clock = Date()
    guard let rest else { return }
    restTimer = Timer.scheduledTimer(withTimeInterval: rest.end.timeIntervalSinceNow, repeats: false) {
      [weak self] _ in
      WKInterfaceDevice.current().play(.notification)
      self?.clock = Date()
    }
  }

  private func askForState() {
    let session = WCSession.default
    guard session.activationState == .activated, session.isReachable else { return }
    session.sendMessage(
      ["hello": true], replyHandler: { [weak self] reply in self?.receive(reply) },
      errorHandler: nil)
  }

  // MARK: WCSessionDelegate

  func session(
    _ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?
  ) {
    guard state == .activated else { return }
    receive(session.receivedApplicationContext)
    askForState()
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    askForState()
  }

  func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) {
    receive(context)
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    receive(message)
  }
}
