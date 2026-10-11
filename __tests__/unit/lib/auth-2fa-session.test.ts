import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockKvGet, mockSessionUpdate } = vi.hoisted(() => ({
  mockKvGet: vi.fn(),
  mockSessionUpdate: vi.fn(),
}));

vi.mock("@/lib/kv", () => ({
  kv: { get: mockKvGet },
}));

vi.mock("@/lib/db", () => ({
  db: {
    session: { update: mockSessionUpdate },
  },
}));

import {
  clearSessionTwoFactorRequired,
  isTwoFactorEnabled,
  twoFactorEnabledKey,
} from "@/lib/auth-2fa-session";

describe("auth-2fa-session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads 2fa:enabled from kv", async () => {
    mockKvGet.mockResolvedValueOnce(true);
    await expect(isTwoFactorEnabled("a@b.c")).resolves.toBe(true);
    expect(mockKvGet).toHaveBeenCalledWith(twoFactorEnabledKey("a@b.c"));
  });

  it("clears twoFactorRequired on the session row", async () => {
    mockSessionUpdate.mockResolvedValueOnce({});
    await clearSessionTwoFactorRequired("tok");
    expect(mockSessionUpdate).toHaveBeenCalledWith({
      where: { token: "tok" },
      data: { twoFactorRequired: false },
    });
  });
});
