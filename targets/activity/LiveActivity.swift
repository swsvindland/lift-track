import ActivityKit
import SwiftUI
import WidgetKit

/* The rest timer on the Lock Screen and in the Dynamic Island. src/lib/rest-timer.ts starts it
   through expo-live-activity's JS API; ActivityKit hands it here because the attributes below
   have the module's name and Codable shape, field for field
   (node_modules/expo-live-activity/ios/LiveActivityAttributes.swift). Its config fields still
   decode, but nothing reads them: the colours come from VectorTheme and the system material. */

struct LiveActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var title: String
    var subtitle: String?
    var timerEndDateInMilliseconds: Double?
    var progress: Double?
    var imageName: String?
    var dynamicIslandImageName: String?
  }

  var name: String
  var backgroundColor: String?
  var titleColor: String?
  var subtitleColor: String?
  var progressViewTint: String?
  var progressViewLabelColor: String?
  var deepLinkUrl: String?
  var timerType: DynamicIslandTimerType?
  var padding: Int?
  var paddingDetails: PaddingDetails?
  var imagePosition: String?
  var imageWidth: Int?
  var imageHeight: Int?
  var imageWidthPercent: Double?
  var imageHeightPercent: Double?
  var imageAlign: String?
  var contentFit: String?

  enum DynamicIslandTimerType: String, Codable {
    case circular
    case digital
  }

  struct PaddingDetails: Codable, Hashable {
    var top: Int?
    var bottom: Int?
    var left: Int?
    var right: Int?
    var vertical: Int?
    var horizontal: Int?
  }
}

/// A tap opens the workout the rest belongs to.
private let workoutURL = URL(string: "lifttrack://workout")!

extension LiveActivityAttributes.ContentState {
  fileprivate var endDate: Date? {
    timerEndDateInMilliseconds.map { Date(timeIntervalSince1970: $0 / 1000) }
  }

  /// Now until the end, never inverted once the rest has run out: the countdown text only needs the end.
  fileprivate var interval: ClosedRange<Date>? {
    guard let end = endDate else { return nil }
    let now = Date()
    return now...max(now, end)
  }

  /// The whole rest, from its start (end − length; rest-timer.ts sends the length in seconds as `progress`) to
  /// its end. A meter drawn from this keeps its place across re-renders; one drawn from `interval` restarts full
  /// every time the system renders the view again. Nil without a length: no meter then.
  fileprivate var span: ClosedRange<Date>? {
    guard let end = endDate, let length = progress, length > 0 else { return nil }
    return end.addingTimeInterval(-length)...end
  }
}

extension ActivityViewContext<LiveActivityAttributes> {
  /// The rest is over: stale (a staleDate, once expo-live-activity passes one; today it always sends nil), no end
  /// (the final "Rest over" state), or an end already past when the system renders the view (the app was asleep
  /// at the deadline, so nothing ended the activity). The check glyph replaces the timer and the meter goes.
  fileprivate var restOver: Bool {
    guard let end = state.endDate else { return true }
    return isStale || end <= Date()
  }
}

/// The check that replaces the timer once the rest is over (VoiceOver reads the symbol's system name).
private struct RestOverGlyph: View {
  var font: Font = .title3.weight(.semibold)

  var body: some View {
    Image(systemName: VectorSymbol.check).font(font)
  }
}

/// The app icon in miniature: a signal plate with a black glyph (accentable when tinted,
/// stroked in Always-On).
struct RestGlyph: View {
  var size: CGFloat = 22

  var body: some View {
    Image(systemName: VectorSymbol.timer)
      .font(.system(size: size * 0.55, weight: .semibold))
      .vectorPlate(.signal)
      .frame(width: size, height: size)
      .accessibilityHidden(true)
  }
}

/// The time left, counted down by the system while the app sleeps.
private struct RestTimerText: View {
  let state: LiveActivityAttributes.ContentState
  var style: Font.TextStyle = .title

  var body: some View {
    if let interval = state.interval {
      Text(timerInterval: interval, countsDown: true)
        .vectorReadout(style, weight: .medium)
        .multilineTextAlignment(.trailing)
    }
  }
}

private struct RestMeter: View {
  let state: LiveActivityAttributes.ContentState
  @Environment(\.isLuminanceReduced) private var dimmed

  var body: some View {
    if let span = state.span {
      // The system's progress view advances on its own, without timeline reloads.
      ProgressView(timerInterval: span, countsDown: true) {
        EmptyView()
      } currentValueLabel: {
        EmptyView()
      }
      .progressViewStyle(.linear)
      // Tint, not signal: at least 3:1 on both the light and the dark material.
      .tint(dimmed ? Color.secondary : VectorColor.tint)
      .labelsHidden()
    }
  }
}

struct RestLockScreenView: View {
  let context: ActivityViewContext<LiveActivityAttributes>

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .center, spacing: 10) {
        RestGlyph()
        VStack(alignment: .leading, spacing: 1) {
          Text(verbatim: context.state.title)
            .font(.headline)
            .lineLimit(1)
          if let subtitle = context.state.subtitle {
            Text(verbatim: subtitle)
              .font(.subheadline)
              .foregroundStyle(.secondary)
              .lineLimit(1)
          }
        }
        Spacer(minLength: 8)
        if context.restOver {
          RestOverGlyph()
        } else {
          RestTimerText(state: context.state)
        }
      }
      if !context.restOver {
        RestMeter(state: context.state)
      }
    }
    .padding(VectorMetrics.lockScreenMargin)
  }
}

struct RestLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: LiveActivityAttributes.self) { context in
      RestLockScreenView(context: context)
        .vectorWidgetTypeCap()
        // The system material: follows light and dark and the Liquid Glass Lock Screen.
        .activityBackgroundTint(nil)
        .activitySystemActionForegroundColor(nil)
        .widgetURL(workoutURL)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          HStack(spacing: 8) {
            RestGlyph()
            VStack(alignment: .leading, spacing: 0) {
              Text(verbatim: context.state.title)
                .font(.headline)
                .lineLimit(1)
              if let subtitle = context.state.subtitle {
                Text(verbatim: subtitle)
                  .font(.caption)
                  .foregroundStyle(.secondary)
                  .lineLimit(1)
              }
            }
          }
        }
        DynamicIslandExpandedRegion(.trailing) {
          if context.restOver {
            RestOverGlyph(font: .title2.weight(.semibold))
          } else {
            RestTimerText(state: context.state, style: .title2)
          }
        }
        DynamicIslandExpandedRegion(.bottom) {
          if !context.restOver {
            RestMeter(state: context.state)
          }
        }
      } compactLeading: {
        // The island is always dark, so signal reads as it does on the icon.
        Image(systemName: VectorSymbol.timer).foregroundStyle(VectorColor.signal)
      } compactTrailing: {
        if context.restOver {
          RestOverGlyph(font: .subheadline.weight(.semibold))
        } else if let interval = context.state.interval {
          Text(timerInterval: interval, countsDown: true)
            .font(VectorFont.readout(.subheadline, weight: .medium))
            .monospacedDigit()
            .frame(maxWidth: 52)
            .multilineTextAlignment(.trailing)
        }
      } minimal: {
        if context.restOver {
          RestOverGlyph(font: .caption.weight(.semibold))
        } else if let span = context.state.span {
          ProgressView(timerInterval: span, countsDown: true) {
            EmptyView()
          } currentValueLabel: {
            EmptyView()
          }
          .progressViewStyle(.circular)
          .tint(VectorColor.signal)
        } else {
          Image(systemName: VectorSymbol.timer).foregroundStyle(VectorColor.signal)
        }
      }
      .keylineTint(VectorColor.signal)
      .widgetURL(workoutURL)
    }
  }
}

@main
struct LiftActivityBundle: WidgetBundle {
  var body: some Widget {
    RestLiveActivity()
  }
}
