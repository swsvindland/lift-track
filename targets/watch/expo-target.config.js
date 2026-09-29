const tokens = require("../../src/vector/tokens.json");

/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = () => ({
  type: "watch",
  name: "LiftWatch",
  displayName: "Lift",
  bundleIdentifier: ".watchkitapp",
  icon: "../../assets/images/icon.png",
  colors: { $accent: tokens.native.accent },
  deploymentTarget: "11.0",
  frameworks: ["SwiftUI", "WatchConnectivity", "HealthKit"],
  entitlements: { "com.apple.developer.healthkit": true },
});
