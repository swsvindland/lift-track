const fs = require("fs");
const path = require("path");
const {
  IOSConfig,
  withAppDelegate,
  withInfoPlist,
  withXcodeProject,
} = require("expo/config-plugins");

// The iOS 27 SDK refuses to launch apps without the UIScene life cycle, and Expo SDK 57's
// template still creates the window in the AppDelegate. Backport of SDK 58's scene template:
// the scene delegate owns the window, starts React Native in it, and re-feeds scene events to
// the ExpoAppDelegate so module subscribers and our URL overrides keep firing.
// Remove once on Expo SDK 58+ (its prebuild generates SceneDelegate.swift itself).
const SCENE_DELEGATE = `internal import Expo
internal import ExpoQuickActions
import React

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  private var appDelegate: AppDelegate? { UIApplication.shared.delegate as? AppDelegate }

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
      let appDelegate,
      let factory = appDelegate.reactNativeFactory else { return }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    // expo-system-ui reads UIApplication.shared.delegate?.window.
    appDelegate.window = window

    // Cold-start shortcut: expo-quick-actions exposes it to JS as a constant, and reads it from
    // launch options that the scene life cycle no longer fills in.
    if let shortcutItem = connectionOptions.shortcutItem {
      ExpoQuickActions.initialAction = shortcutItem
    }

    // Linking.getInitialURL() reads launch options; rebuild them from the connection options.
    var launchOptions: [UIApplication.LaunchOptionsKey: Any] = [:]
    if let url = connectionOptions.urlContexts.first?.url {
      launchOptions[UIApplication.LaunchOptionsKey(rawValue: "UIApplicationLaunchOptionsURLKey")] = url
    }
    if let activity = connectionOptions.userActivities.first(where: {
      $0.activityType == NSUserActivityTypeBrowsingWeb
    }) {
      launchOptions[UIApplication.LaunchOptionsKey(rawValue: "UIApplicationLaunchOptionsUserActivityDictionaryKey")] = [
        "UIApplicationLaunchOptionsUserActivityTypeKey": activity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": activity,
      ]
    }
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions.isEmpty ? nil : launchOptions)

    connectionOptions.urlContexts.forEach { open($0) }
    connectionOptions.userActivities.forEach { self.scene(scene, continue: $0) }
  }

  func sceneDidDisconnect(_ scene: UIScene) {
    window = nil
  }

  func sceneDidBecomeActive(_ scene: UIScene) {
    appDelegate?.applicationDidBecomeActive(UIApplication.shared)
  }

  func sceneWillResignActive(_ scene: UIScene) {
    appDelegate?.applicationWillResignActive(UIApplication.shared)
  }

  func sceneWillEnterForeground(_ scene: UIScene) {
    appDelegate?.applicationWillEnterForeground(UIApplication.shared)
  }

  func sceneDidEnterBackground(_ scene: UIScene) {
    appDelegate?.applicationDidEnterBackground(UIApplication.shared)
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    URLContexts.forEach { open($0) }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = appDelegate?.application(
      UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }

  func scene(_ scene: UIScene, didUpdate userActivity: NSUserActivity) {
    appDelegate?.application(UIApplication.shared, didUpdate: userActivity)
  }

  func windowScene(
    _ windowScene: UIWindowScene,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    guard let appDelegate else { return completionHandler(false) }
    appDelegate.application(
      UIApplication.shared, performActionFor: shortcutItem, completionHandler: completionHandler)
  }

  // AppDelegate's override hands the URL to both Expo subscribers and RCTLinkingManager.
  private func open(_ context: UIOpenURLContext) {
    var options: [UIApplication.OpenURLOptionsKey: Any] = [.openInPlace: context.options.openInPlace]
    if let source = context.options.sourceApplication { options[.sourceApplication] = source }
    if let annotation = context.options.annotation { options[.annotation] = annotation }
    _ = appDelegate?.application(UIApplication.shared, open: context.url, options: options)
  }
}
`;

const WINDOW_START =
  /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/;

module.exports = function withSceneDelegate(config) {
  config = withInfoPlist(config, (config) => {
    config.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate",
          },
        ],
      },
    };
    return config;
  });

  config = withAppDelegate(config, (config) => {
    const delegate = config.modResults;
    if (delegate.language !== "swift")
      throw new Error("Scene delegate requires the Expo Swift AppDelegate.");
    if (delegate.contents.includes("started by SceneDelegate")) return config;
    if (!WINDOW_START.test(delegate.contents))
      throw new Error("Scene delegate couldn't find the AppDelegate window setup to remove.");
    delegate.contents = delegate.contents.replace(
      WINDOW_START,
      "\n    // The window is created and React Native started by SceneDelegate (iOS 27 SDK).\n"
    );
    return config;
  });

  return withXcodeProject(config, (config) => {
    const { projectName, platformProjectRoot } = config.modRequest;
    fs.writeFileSync(
      path.join(platformProjectRoot, projectName, "SceneDelegate.swift"),
      SCENE_DELEGATE
    );
    const filepath = `${projectName}/SceneDelegate.swift`;
    if (!config.modResults.hasFile(filepath)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath,
        groupName: projectName,
        project: config.modResults,
      });
    }
    return config;
  });
};
