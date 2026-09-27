import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";
import type { WatchState } from "./watch";

/* The Apple Watch connection (modules/watch-link). Android and builds without the module have
   no Watch; every call is then a no-op. */

type NativeWatchLink = {
  addListener(
    event: "onCommand",
    listener: (event: { command: string }) => void
  ): { remove(): void };
  update(json: string): void;
  drain(): string[];
  startWatchApp(): Promise<boolean>;
};

const native =
  Platform.OS === "ios" ? requireOptionalNativeModule<NativeWatchLink>("WatchLink") : null;

export const watchAvailable = !!native;

export function sendWatchState(state: WatchState) {
  native?.update(JSON.stringify(state));
}

/** Opens Lift on the Watch for a workout started on the phone. */
export function startWatchApp() {
  void native?.startWatchApp().catch(() => false);
}

/** Commands from the Watch as JSON, starting with any that waited while the app wasn't running. */
export function listenToWatch(handler: (json: string) => void) {
  if (!native) return () => {};
  const subscription = native.addListener("onCommand", (event) => handler(event.command));
  native.drain().forEach(handler);
  return () => subscription.remove();
}
