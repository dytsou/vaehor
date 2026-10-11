import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth-server", () => ({
  authServer: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

import { checkAuth } from "@/lib/auth-check";
import { authServer } from "@/lib/auth-server";

describe("checkAuth (Better Auth)", () => {
  beforeEach(() => {
    vi.mocked(authServer.api.getSession).mockReset();
  });

  it("returns unauthenticated when no session", async () => {
    vi.mocked(authServer.api.getSession).mockResolvedValue(null);
    const req = new NextRequest("http://localhost/en");
    const result = await checkAuth(req);
    expect(result.isAuthenticated).toBe(false);
    expect(result.token).toBeNull();
  });

  it("maps guest session flags", async () => {
    vi.mocked(authServer.api.getSession).mockResolvedValue({
      user: { id: "g1", email: "g@guest.local", name: "Guest", role: "GUEST" },
      session: {
        id: "s1",
        token: "t",
        userId: "g1",
        expiresAt: new Date(),
        isGuest: true,
        twoFactorRequired: false,
      },
    } as never);

    const req = new NextRequest("http://localhost/en");
    const result = await checkAuth(req);
    expect(result.isAuthenticated).toBe(true);
    expect(result.isGuest).toBe(true);
    expect(result.is2FARequired).toBe(false);
  });

  it("maps twoFactorRequired", async () => {
    vi.mocked(authServer.api.getSession).mockResolvedValue({
      user: { id: "u1", email: "a@b.c", name: "A", role: "ADMIN" },
      session: {
        id: "s1",
        token: "t",
        userId: "u1",
        expiresAt: new Date(),
        isGuest: false,
        twoFactorRequired: true,
      },
    } as never);

    const req = new NextRequest("http://localhost/en");
    const result = await checkAuth(req);
    expect(result.is2FARequired).toBe(true);
    expect(result.isGuest).toBe(false);
  });
});
