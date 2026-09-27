import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { useColorScheme } from "react-native";
import { getDeviceLocale } from "../app-shell/locale";
import type { Locale } from "./i18n";
import {
  loadMobilePreferences,
  saveMobilePreferences,
  type AppearancePreference,
  type LanguagePreference,
  type MobilePreferences,
  type MobileTheme,
} from "./mobile-preference-store";

export type {
  AppearancePreference,
  LanguagePreference,
  MobilePreferences,
  MobileTheme,
} from "./mobile-preference-store";

type MobilePreferencesContextValue = Readonly<{
  preferences: MobilePreferences;
  theme: MobileTheme;
  locale: Locale;
  ready: boolean;
  setAppearance: (appearance: AppearancePreference) => Promise<void>;
  setLanguage: (language: LanguagePreference) => Promise<void>;
}>;

const MobilePreferencesContext =
  createContext<MobilePreferencesContextValue | null>(null);

export function MobilePreferencesProvider({ children }: PropsWithChildren) {
  const deviceScheme = useColorScheme();
  const [preferences, setPreferences] = useState<MobilePreferences>({
    appearance: "system",
    language: "system",
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void loadMobilePreferences(AsyncStorage)
      .then((stored) => {
        if (active) setPreferences(stored);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const updatePreferences = useCallback(
    async (updated: Partial<MobilePreferences>) => {
      const next = { ...preferences, ...updated };
      await saveMobilePreferences(next, AsyncStorage);
      setPreferences(next);
    },
    [preferences],
  );

  const theme: MobileTheme =
    preferences.appearance === "system"
      ? deviceScheme === "dark"
        ? "dark"
        : "light"
      : preferences.appearance;
  const locale: Locale =
    preferences.language === "system"
      ? getDeviceLocale()
      : preferences.language;

  const value = useMemo<MobilePreferencesContextValue>(
    () => ({
      preferences,
      theme,
      locale,
      ready,
      setAppearance: (appearance) => updatePreferences({ appearance }),
      setLanguage: (language) => updatePreferences({ language }),
    }),
    [preferences, theme, locale, ready, updatePreferences],
  );

  return (
    <MobilePreferencesContext.Provider value={value}>
      {children}
    </MobilePreferencesContext.Provider>
  );
}

export function useMobilePreferences(): MobilePreferencesContextValue {
  const value = useContext(MobilePreferencesContext);
  if (!value) {
    throw new Error("useMobilePreferences must be used inside its provider");
  }
  return value;
}
