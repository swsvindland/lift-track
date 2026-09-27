import ExpoModulesCore
import HealthKit

public final class WatchLinkModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WatchLink")

    Events("onCommand")

    OnStartObserving {
      WatchLink.shared.listen { [weak self] command in
        self?.sendEvent("onCommand", ["command": command])
      }
    }

    OnStopObserving {
      WatchLink.shared.listen(nil)
    }

    Function("update") { (json: String) in
      WatchLink.shared.update(json)
    }

    Function("drain") { () -> [String] in
      WatchLink.shared.drain()
    }

    /// A workout started on the phone opens Lift on the Watch, which starts its own session.
    AsyncFunction("startWatchApp") { (promise: Promise) in
      guard WatchLink.shared.canStartWatchApp else { return promise.resolve(false) }
      let configuration = HKWorkoutConfiguration()
      configuration.activityType = .traditionalStrengthTraining
      configuration.locationType = .indoor
      WatchLink.shared.health.startWatchApp(with: configuration) { started, _ in
        promise.resolve(started)
      }
    }
  }
}

public final class WatchLinkAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    WatchLink.shared.activate()
    return true
  }
}
