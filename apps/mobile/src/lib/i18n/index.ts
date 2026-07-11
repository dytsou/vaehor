import en from "./en.json";
import zh from "./zh.json";

const catalogs = { en, zh } as const;

export type Locale = keyof typeof catalogs;
export type MessageKey = keyof typeof en;

function resolveLocale(raw: string | undefined): Locale {
  const code = (raw ?? "en").toLowerCase();
  if (code.startsWith("zh")) return "zh";
  return "en";
}

export function getDeviceLocale(): Locale {
  if (typeof navigator !== "undefined") {
    return resolveLocale(navigator.language);
  }
  return "en";
}

export function t(
  locale: Locale,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const template = catalogs[locale][key] ?? catalogs.en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    String(vars[name] ?? ""),
  );
}
