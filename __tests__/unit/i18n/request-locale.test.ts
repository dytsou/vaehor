import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n-config";

/** Mirrors i18n/request.ts locale resolution (vinext may omit requestLocale). */
function resolveRequestLocale(requested: string | undefined): string {
  return isLocale(requested ?? "") ? requested! : DEFAULT_LOCALE;
}

describe("i18n request locale resolution", () => {
  it("keeps valid locales and falls back when missing", () => {
    expect(resolveRequestLocale("en")).toBe("en");
    expect(resolveRequestLocale("zh-TW")).toBe("zh-TW");
    expect(resolveRequestLocale(undefined)).toBe("en");
    expect(resolveRequestLocale("nope")).toBe("en");
  });
});
