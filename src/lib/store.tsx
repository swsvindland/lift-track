import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Uniwind } from "uniwind";
import { AppState } from "react-native";
import { configureHealthSchedule, syncHealthIfDue } from "./health-schedule";
import { desc } from "drizzle-orm";
import { getLocales, useLocales } from "expo-localization";
import { db, preferences, weightEntries } from "@/db";
import { localeTag } from "@/vector";
import type { Units } from "./metrics";
import {
  interpolate,
  languagePreference,
  resolveLanguage,
  translate,
  type Language,
  type Message,
} from "./translations";

function read() {
  const prefs = Object.fromEntries(
    db
      .select()
      .from(preferences)
      .all()
      .map((p) => [p.key, p.value])
  );
  return {
    weights: db
      .select()
      .from(weightEntries)
      .orderBy(desc(weightEntries.measuredAt), desc(weightEntries.id))
      .all(),
    // Until chosen, follow the phone: US gyms load in pounds; UK gyms use kg plates.
    units: (prefs.units
      ? prefs.units === "imperial"
        ? "imperial"
        : "metric"
      : getLocales()[0]?.measurementSystem === "us"
        ? "imperial"
        : "metric") as Units,
    theme: (prefs.theme === "dark" || prefs.theme === "light" ? prefs.theme : "system") as
      "dark" | "light" | "system",
    healthSyncEnabled: prefs.healthSyncEnabled === "true",
    healthSyncError: prefs.healthSyncError ?? "",
    languagePreference: languagePreference(prefs.language),
    lastSync: prefs.lastSync,
  };
}
type Store = ReturnType<typeof read> & {
  language: Language;
  /** The kit's Intl tag for the language (en-GB stays en-GB): app dates and numbers match the kit's. */
  locale: string;
  refresh: () => void;
  setPreference: (key: string, value: string) => void;
  t: (key: Message, values?: Record<string, string | number>) => string;
  number: (value: number, digits?: number) => string;
  date: (value: string) => string;
};
const Context = createContext<Store | null>(null);
export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState(read);
  const locales = useLocales();
  const language = resolveLanguage(data.languagePreference, locales[0]?.languageCode);
  useEffect(() => {
    Uniwind.setTheme(data.theme);
  }, [data.theme]);
  useEffect(() => {
    let active = true;
    const check = async () => {
      if (AppState.currentState !== "active") return;
      try {
        await syncHealthIfDue();
      } finally {
        if (active) setData(read());
      }
    };
    void configureHealthSchedule()
      .catch(() => {})
      .finally(check);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    const timer = setInterval(() => void check(), 60 * 60 * 1000);
    return () => {
      active = false;
      subscription.remove();
      clearInterval(timer);
    };
  }, [data.healthSyncEnabled]);
  const refresh = () => setData(read());
  const setPreference = (key: string, value: string) => {
    db.insert(preferences)
      .values({ key, value })
      .onConflictDoUpdate({ target: preferences.key, set: { value } })
      .run();
    refresh();
  };
  const locale = localeTag(language, locales);
  return (
    <Context.Provider
      value={{
        ...data,
        language,
        locale,
        refresh,
        setPreference,
        t: (key, values) =>
          values ? interpolate(translate(language, key), values) : translate(language, key),
        number: (value, digits = 1) =>
          new Intl.NumberFormat(locale, {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits,
          }).format(value),
        date: (value) =>
          new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString(locale, {
            year: "numeric",
            month: "short",
            day: "numeric",
          }),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useStore() {
  const value = useContext(Context);
  if (!value) throw new Error("StoreProvider is required");
  return value;
}
