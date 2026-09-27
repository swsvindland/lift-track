import SwiftUI

struct ContentView: View {
  private var phone = Phone.shared
  private var session = Session.shared

  var body: some View {
    NavigationStack {
      Group {
        if let workout = phone.workout {
          WorkoutView(workout: workout, unit: phone.state?.unit ?? "kg")
        } else if phone.finishing {
          VStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill")
              .font(.title)
              .foregroundStyle(.green)
            Text("Workout saved")
              .font(.headline)
          }
        } else if phone.starting {
          VStack(spacing: 8) {
            ProgressView()
            Text("Starting on your iPhone…")
              .multilineTextAlignment(.center)
          }
        } else if let start = phone.state?.start {
          StartView(start: start)
        } else {
          SetupView(connected: phone.state != nil)
        }
      }
    }
    // The session follows the phone: on while a workout is open, off once it's finished.
    .onChange(of: phone.finishing ? nil : phone.state?.workout?.id, initial: true) { _, id in
      guard phone.state != nil else { return }
      if id != nil {
        Task { await session.start() }
      } else if !phone.starting {
        session.end()
      }
    }
  }
}

struct SetupView: View {
  let connected: Bool

  var body: some View {
    VStack(spacing: 10) {
      Image(systemName: "iphone")
        .font(.title)
        .foregroundStyle(.tint)
      Text("Set up a workout on your iPhone")
        .font(.headline)
        .multilineTextAlignment(.center)
      if !connected {
        Text("Open Lift on your iPhone to connect.")
          .font(.footnote)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
      }
    }
  }
}

struct StartView: View {
  let start: StartOption

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(start.detail)
        .font(.footnote)
        .foregroundStyle(.secondary)
        .lineLimit(1)
      Text(start.title)
        .font(.title3.weight(.semibold))
        .lineLimit(2)
        .minimumScaleFactor(0.8)
      Spacer(minLength: 4)
      Button {
        Phone.shared.start()
      } label: {
        Label("Start", systemImage: "play.fill")
          .font(.headline)
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(WideButtonStyle(tint: .accentColor))
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}
