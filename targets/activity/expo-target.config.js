const tokens = require("../../src/vector/tokens.json");

/* The rest timer's Live Activity. The target keeps the name and bundle id the expo-live-activity
   plugin gave it, so the App ID and the EAS appExtensions entry are unchanged. */
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = () => ({
  type: "widget",
  name: "LiveActivity",
  displayName: "Lift",
  bundleIdentifier: ".LiveActivity",
  // The app's minimum, so every iPhone that runs Lift gets the Live Activity.
  deploymentTarget: "16.4",
  colors: { $accent: tokens.native.accent },
  frameworks: ["SwiftUI", "WidgetKit", "ActivityKit"],
});
