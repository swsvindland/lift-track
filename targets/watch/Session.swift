import Foundation
import HealthKit
import Observation

/// A strength-training session on the Watch while a workout is open. It keeps Lift on the wrist
/// between sets and reads heart rate, then is thrown away: the phone saves the one workout to
/// Health, so nothing is counted twice.
@Observable
final class Session: NSObject, HKWorkoutSessionDelegate, HKLiveWorkoutBuilderDelegate {
  static let shared = Session()

  private(set) var heartRate: Int?
  @ObservationIgnored private let store = HKHealthStore()
  @ObservationIgnored private var session: HKWorkoutSession?
  @ObservationIgnored private var builder: HKLiveWorkoutBuilder?
  @ObservationIgnored private var starting = false

  @MainActor
  func start() async {
    guard session == nil, !starting, HKHealthStore.isHealthDataAvailable() else { return }
    starting = true
    defer { starting = false }
    try? await store.requestAuthorization(
      toShare: [HKObjectType.workoutType()], read: [HKQuantityType(.heartRate)])
    let configuration = HKWorkoutConfiguration()
    configuration.activityType = .traditionalStrengthTraining
    configuration.locationType = .indoor
    guard let session = try? HKWorkoutSession(healthStore: store, configuration: configuration)
    else { return }
    let builder = session.associatedWorkoutBuilder()
    builder.dataSource = HKLiveWorkoutDataSource(
      healthStore: store, workoutConfiguration: configuration)
    session.delegate = self
    builder.delegate = self
    self.session = session
    self.builder = builder
    let now = Date()
    session.startActivity(with: now)
    try? await builder.beginCollection(at: now)
  }

  @MainActor
  func end() {
    guard let session, let builder else { return }
    self.session = nil
    self.builder = nil
    heartRate = nil
    session.end()
    builder.endCollection(withEnd: Date()) { _, _ in
      builder.discardWorkout()
    }
  }

  // MARK: Delegates

  func workoutSession(
    _ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState,
    from fromState: HKWorkoutSessionState, date: Date
  ) {}

  func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
    DispatchQueue.main.async { self.end() }
  }

  func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

  func workoutBuilder(
    _ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>
  ) {
    let type = HKQuantityType(.heartRate)
    guard collectedTypes.contains(type),
      let quantity = workoutBuilder.statistics(for: type)?.mostRecentQuantity()
    else { return }
    let bpm = Int(quantity.doubleValue(for: .count().unitDivided(by: .minute())).rounded())
    DispatchQueue.main.async { self.heartRate = bpm }
  }
}
