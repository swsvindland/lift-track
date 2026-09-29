import type { ReactNode } from "react";
import * as Haptics from "expo-haptics";
import { VectorProvider, type VectorHaptics } from "@/vector";
import { useStore } from "@/lib/store";

// The kit's five haptic events on expo-haptics (installed here). A module constant, so the provider's value
// stays stable across renders.
const haptics: VectorHaptics = {
  selection: () => void Haptics.selectionAsync().catch(() => {}),
  commit: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
  complete: () =>
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),
  warn: () =>
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}),
  error: () =>
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}),
};

/** The kit provider, fed from the app store: the app's language drives kit strings, script and formatting. */
export function VectorAdapter({ children }: { children: ReactNode }) {
  const { language } = useStore();
  return (
    <VectorProvider language={language} haptics={haptics}>
      {children}
    </VectorProvider>
  );
}
