import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetPublicAppConfig } = vi.hoisted(() => ({
  mockGetPublicAppConfig: vi.fn(),
}));

vi.mock("@/lib/app-config", () => ({
  getPublicAppConfig: mockGetPublicAppConfig,
}));

import { GET } from "@/app/api/config/route";

describe("app/api/config route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns public app config", async () => {
    mockGetPublicAppConfig.mockResolvedValue({
      hideAuthor: false,
      disableGuestLogin: false,
      localStorageAuthEnabled: false,
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      hideAuthor: false,
      disableGuestLogin: false,
      localStorageAuthEnabled: false,
    });
  });

  it("returns 500 when config fetch fails", async () => {
    mockGetPublicAppConfig.mockRejectedValue(new Error("db unavailable"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to fetch public config",
    });
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
