const PREFERENCES_KEY = "vaehor_mobile_preferences_v1";

export type AppearancePreference = "system" | "light" | "dark";
export type LanguagePreference = "system" | "en" | "zh";
export type MobileTheme = Exclude<AppearancePreference, "system">;

export type MobilePreferences = Readonly<{
  appearance: AppearancePreference;
  language: LanguagePreference;
}>;

export type PreferenceStorage = Readonly<{
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
}>;

const DEFAULT_PREFERENCES: MobilePreferences = {
  appearance: "system",
  language: "system",
};

function parsePreferences(raw: string | null): MobilePreferences {
  if (!raw) return DEFAULT_PREFERENCES;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const appearance = value.appearance;
    const language = value.language;
    return {
      appearance:
        appearance === "light" || appearance === "dark" ? appearance : "system",
      language: language === "en" || language === "zh" ? language : "system",
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export async function loadMobilePreferences(
  storage: PreferenceStorage,
): Promise<MobilePreferences> {
  return parsePreferences(await storage.getItem(PREFERENCES_KEY));
}

export async function saveMobilePreferences(
  preferences: MobilePreferences,
  storage: PreferenceStorage,
): Promise<void> {
  await storage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
}
