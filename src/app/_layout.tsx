import { useFonts } from "expo-font";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState, type JSX } from "react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { HeroUINativeProvider } from "heroui-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AppState, View } from "react-native";
import { getLocales } from "expo-localization";
import { useMigrations } from "drizzle-orm/expo-sqlite/migrator";
import migrations from "../../drizzle/migrations";
import { StoreProvider } from "@/lib/store";
import { resolveLanguage, translate } from "@/lib/translations";
import { db } from "@/db";
import { shareDatabaseCopy } from "@/lib/data-files";
import { prepareRestNotifications, settleRest } from "@/lib/rest-timer";
import { WatchLink } from "@/components/watch-link";
import { VectorAdapter } from "@/vector-adapter";
import {
  DockProvider,
  ErrorText,
  NavigationTheme,
  Note,
  SystemState,
  VectorProvider,
  vectorHeroConfig,
} from "@/vector";

import "../global.css";

// The native splash stays up until fonts and migrations are ready, so there is no loading screen in between.
void SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ duration: 200, fade: true });

// A cold start from a link (the rest Live Activity, lifttrack://start) still puts the tabs under the route,
// so back always has somewhere to go.
export const unstable_settings = { anchor: "(tabs)" };

/** Shown when the database cannot be migrated. The store never loads, so it speaks the phone's language. */
function MigrationError({ message }: { message: string }) {
  const language = resolveLanguage("system", getLocales()[0]?.languageCode);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState("");
  const share = () => {
    if (sharing) return;
    setSharing(true);
    setShareError("");
    shareDatabaseCopy()
      .catch((e) =>
        setShareError(e instanceof Error ? e.message : translate(language, "shareFailed"))
      )
      .finally(() => setSharing(false));
  };
  return (
    <VectorProvider language={language}>
      <HeroUINativeProvider config={vectorHeroConfig}>
        <View className="flex-1 justify-center bg-background">
          <View style={{ width: "100%", maxWidth: 672, alignSelf: "center", padding: 16, gap: 16 }}>
            <SystemState
              kind="error"
              code={translate(language, "migrationError")}
              message={translate(language, "migrationSafe")}
              action={{ label: translate(language, "shareDatabaseCopy"), onPress: share }}
            />
            <Note selectable>{message}</Note>
            <ErrorText message={shareError} />
          </View>
        </View>
        <StatusBar style="auto" />
      </HeroUINativeProvider>
    </VectorProvider>
  );
}

export default function RootLayout(): JSX.Element | null {
  const [fontsLoaded, fontError] = useFonts({
    Inter: require("../../assets/fonts/Inter.ttf"),
    IBMPlexMono: require("../../assets/fonts/IBMPlexMono-Regular.ttf"),
    // Icon-only controls must not render blank on a cold start.
    ...Ionicons.font,
  });
  const { success, error } = useMigrations(db, migrations);
  const ready = (fontsLoaded || !!fontError) && (success || !!error);
  useEffect(() => {
    void prepareRestNotifications().catch(() => {});
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") settleRest();
    });
    return () => subscription.remove();
  }, []);
  // Effects run after the first frame of the app (and its store) has mounted.
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  // HeroUI renders menus, selects and toasts in a portal host beside its children, so it sits inside the kit
  // provider: kit components in those overlays need its context. The dock wraps the whole Stack, so the workout
  // (a pushed screen, outside the tabs) stacks its Undo above the rest strip like any tab screen.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {error ? (
        <MigrationError message={error.message} />
      ) : (
        <StoreProvider>
          <VectorAdapter>
            <HeroUINativeProvider config={vectorHeroConfig}>
              <NavigationTheme>
                <DockProvider>
                  <Stack screenOptions={{ headerShown: false }}>
                    <Stack.Screen name="(tabs)" />
                    <Stack.Screen name="workout" />
                    <Stack.Screen name="start" options={{ animation: "none" }} />
                  </Stack>
                </DockProvider>
              </NavigationTheme>
              <WatchLink />
              <StatusBar style="auto" />
            </HeroUINativeProvider>
          </VectorAdapter>
        </StoreProvider>
      )}
    </GestureHandlerRootView>
  );
}
