import Foundation
import HealthKit
import WatchConnectivity

/// The phone's end of the Watch connection. It's activated at launch, before JavaScript runs,
/// so a command the Watch sends while the app is suspended or not yet running isn't lost: it
/// waits in UserDefaults until JavaScript starts listening and drains it.
final class WatchLink: NSObject, WCSessionDelegate {
  static let shared = WatchLink()

  private let lock = NSLock()
  private let defaults = UserDefaults.standard
  private let queueKey = "watchLink.queue"
  private let stateKey = "watchLink.state"
  private var deliver: ((String) -> Void)?
  let health = HKHealthStore()

  func activate() {
    guard WCSession.isSupported() else { return }
    WCSession.default.delegate = self
    WCSession.default.activate()
  }

  /// Sends the latest state: as the application context, so the Watch has it next time it
  /// opens, and as a message too when the Watch app is open, so it updates at once.
  func update(_ json: String) {
    defaults.set(json, forKey: stateKey)
    push(json)
  }

  private func push(_ json: String) {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    guard session.activationState == .activated, session.isPaired, session.isWatchAppInstalled
    else { return }
    try? session.updateApplicationContext(["state": json])
    if session.isReachable {
      session.sendMessage(["state": json], replyHandler: nil, errorHandler: nil)
    }
  }

  /// JavaScript listens: commands go straight to it from now on.
  func listen(_ handler: ((String) -> Void)?) {
    lock.lock()
    deliver = handler
    lock.unlock()
  }

  /// Commands that arrived while nothing listened, oldest first.
  func drain() -> [String] {
    lock.lock()
    defer { lock.unlock() }
    let queued = defaults.stringArray(forKey: queueKey) ?? []
    defaults.removeObject(forKey: queueKey)
    return queued
  }

  private func receive(_ message: [String: Any]) {
    guard let command = message["command"] as? String else { return }
    lock.lock()
    let handler = deliver
    if handler == nil {
      defaults.set((defaults.stringArray(forKey: queueKey) ?? []) + [command], forKey: queueKey)
    }
    lock.unlock()
    handler?(command)
  }

  var canStartWatchApp: Bool {
    HKHealthStore.isHealthDataAvailable() && WCSession.isSupported()
      && WCSession.default.activationState == .activated && WCSession.default.isPaired
      && WCSession.default.isWatchAppInstalled
  }

  // MARK: WCSessionDelegate

  func session(
    _ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?
  ) {
    if state == .activated, let json = defaults.string(forKey: stateKey) { push(json) }
  }

  func sessionDidBecomeInactive(_ session: WCSession) {}

  /// Switching to another Watch: start again with the new one.
  func sessionDidDeactivate(_ session: WCSession) {
    session.activate()
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    receive(message)
  }

  func session(
    _ session: WCSession, didReceiveMessage message: [String: Any],
    replyHandler: @escaping ([String: Any]) -> Void
  ) {
    // The Watch opening asks for the latest state; a command is acknowledged once stored.
    receive(message)
    replyHandler(["state": defaults.string(forKey: stateKey) ?? ""])
  }

  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    receive(userInfo)
  }
}
