import { describe, expect, it, vi } from "vitest";
import {
  loadMobilePreferences,
  saveMobilePreferences,
  type MobilePreferences,
} from "../src/lib/mobile-preference-store";

function createStorage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: vi.fn(async () => value),
    setItem: vi.fn(async (_key: string, nextValue: string) => {
      value = nextValue;
    }),
  };
}

describe("mobile preferences persistence", () => {
  it("uses system preferences when storage is empty or invalid", async () => {
    const emptyStorage = createStorage();
    const invalidStorage = createStorage("not json");

    await expect(loadMobilePreferences(emptyStorage)).resolves.toEqual({
      appearance: "system",
      language: "system",
    });
    await expect(loadMobilePreferences(invalidStorage)).resolves.toEqual({
      appearance: "system",
      language: "system",
    });
  });

  it("persists and restores the appearance and language choices", async () => {
    const storage = createStorage();
    const preferences: MobilePreferences = {
      appearance: "dark",
      language: "zh",
    };

    await saveMobilePreferences(preferences, storage);

    expect(storage.setItem).toHaveBeenCalledWith(
      "vaehor_mobile_preferences_v1",
      JSON.stringify(preferences),
    );
    await expect(loadMobilePreferences(storage)).resolves.toEqual(preferences);
  });
});
