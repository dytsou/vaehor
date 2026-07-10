import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindUnique, mockUpsert, mockKvGet, mockKvSet } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpsert: vi.fn(),
  mockKvGet: vi.fn(),
  mockKvSet: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    adminConfig: {
      findUnique: mockFindUnique,
      upsert: mockUpsert,
    },
  },
}));

vi.mock("@/lib/kv", () => ({
  kv: {
    get: mockKvGet,
    set: mockKvSet,
  },
}));

import {
  DEFAULT_APP_CONFIG,
  getAppConfig,
  getPublicAppConfig,
  isHashedLocalStoragePassword,
  sanitizeAdminAppConfig,
  updateAppConfig,
} from "@/lib/app-config";

describe("lib/app-config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue(null);
    mockUpsert.mockResolvedValue(null);
    mockKvGet.mockResolvedValue(null);
    mockKvSet.mockResolvedValue("OK");
  });

  it("returns normalized defaults when no config is stored", async () => {
    const result = await getAppConfig();

    expect(result).toEqual(DEFAULT_APP_CONFIG);
    expect(mockKvSet).toHaveBeenCalledWith("vaehor:config", DEFAULT_APP_CONFIG);
  });

  it("normalizes legacy partial config from the database", async () => {
    mockFindUnique.mockResolvedValueOnce({
      value: JSON.stringify({
        appName: "Custom Name",
        hideAuthor: true,
      }),
    });

    const result = await getAppConfig();

    expect(result).toEqual({
      ...DEFAULT_APP_CONFIG,
      appName: "Custom Name",
      hideAuthor: true,
    });
  });

  it("merges partial updates instead of overwriting existing config", async () => {
    mockFindUnique.mockResolvedValueOnce({
      value: JSON.stringify({
        ...DEFAULT_APP_CONFIG,
        appName: "Existing Name",
        logoUrl: "https://example.com/logo.png",
      }),
    });

    const result = await updateAppConfig({
      localStorageAuthEnabled: true,
    });

    expect(result).toEqual({
      ...DEFAULT_APP_CONFIG,
      appName: "Existing Name",
      logoUrl: "https://example.com/logo.png",
      localStorageAuthEnabled: true,
    });
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { key: "vaehor:config" },
      update: { value: JSON.stringify(result) },
      create: { key: "vaehor:config", value: JSON.stringify(result) },
    });
    expect(mockKvSet).toHaveBeenLastCalledWith("vaehor:config", result);
  });

  it("returns only public fields from the shared config source", async () => {
    mockKvGet.mockResolvedValueOnce({
      ...DEFAULT_APP_CONFIG,
      hideAuthor: true,
      disableGuestLogin: true,
      localStorageAuthEnabled: true,
      appName: "Hidden",
    });

    const result = await getPublicAppConfig();

    expect(result).toEqual({
      hideAuthor: true,
      disableGuestLogin: true,
      localStorageAuthEnabled: true,
    });
  });

  it("falls back to defaults when the database is unavailable", async () => {
    mockFindUnique.mockRejectedValueOnce(
      new Error("Authentication failed against the database server"),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await getAppConfig();

    expect(result).toEqual(DEFAULT_APP_CONFIG);
    expect(mockKvSet).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("normalizes empty app names back to the default label", async () => {
    mockFindUnique.mockResolvedValueOnce({
      value: JSON.stringify({
        appName: "",
      }),
    });

    const result = await getAppConfig();

    expect(result.appName).toBe(DEFAULT_APP_CONFIG.appName);
  });

  it("hashes local storage passwords before persisting config", async () => {
    const result = await updateAppConfig({
      localStoragePassword: "super-secret-password",
    });

    expect(result.localStoragePassword).not.toBe("super-secret-password");
    expect(isHashedLocalStoragePassword(result.localStoragePassword)).toBe(
      true,
    );
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { key: "vaehor:config" },
      update: { value: JSON.stringify(result) },
      create: { key: "vaehor:config", value: JSON.stringify(result) },
    });
  });

  it("redacts local storage password for admin api responses", () => {
    expect(
      sanitizeAdminAppConfig({
        ...DEFAULT_APP_CONFIG,
        localStoragePassword: "$2b$10$hashed-secret-value",
      }).localStoragePassword,
    ).toBe("");
  });
});
