/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = () => ({
  type: "watch",
  name: "LiftWatch",
  displayName: "Lift",
  bundleIdentifier: ".watchkitapp",
  icon: "../../assets/images/icon.png",
  colors: { $accent: "#22d3ee" },
  deploymentTarget: "11.0",
  frameworks: ["SwiftUI", "WatchConnectivity", "HealthKit"],
  entitlements: { "com.apple.developer.healthkit": true },
});
