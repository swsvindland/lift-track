import HealthKit
import SwiftUI
import WatchKit

@main
struct LiftWatchApp: App {
  @WKApplicationDelegateAdaptor(AppDelegate.self) private var delegate

  var body: some Scene {
    WindowGroup {
      ContentView()
    }
  }
}

final class AppDelegate: NSObject, WKApplicationDelegate {
  func applicationDidFinishLaunching() {
    Phone.shared.activate()
  }

  /// A workout started on the phone opens Lift here (HKHealthStore.startWatchApp).
  func handle(_ workoutConfiguration: HKWorkoutConfiguration) {
    Task { await Session.shared.start() }
  }
}
