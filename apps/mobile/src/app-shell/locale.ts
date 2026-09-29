import { getLocales } from "expo-localization";
import type { Locale } from "../lib/i18n";

export function getDeviceLocale(): Locale {
  const languageCode = getLocales()[0]?.languageCode ?? "en";
  return languageCode.toLowerCase().startsWith("zh") ? "zh" : "en";
}
