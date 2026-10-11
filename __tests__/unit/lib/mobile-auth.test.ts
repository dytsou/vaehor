import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}));

vi.mock("@/lib/auth-server", () => ({
  authServer: {
    api: {
      getSession: mockGetSession,
    },
  },
}));

import { readMobileBearerSession } from "@/lib/mobile-auth";
import { createAdminRoute } from "@/lib/api-middleware";

function baSession(role: string, extras: { twoFactorRequired?: boolean } = {}) {
  return {
    user: {
      id: `${role.toLowerCase()}-id`,
      name: role,
      email: `${role.toLowerCase()}@example.com`,
      image: null,
      role,
    },
    session: {
      id: "s1",
      token: "tok",
      userId: `${role.toLowerCase()}-id`,
      expiresAt: new Date(Date.now() + 60_000),
      isGuest: role === "GUEST",
      twoFactorRequired: extras.twoFactorRequired ?? false,
    },
  };
}

describe("mobile bearer authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the verified bearer claim even when a different cookie is present", async () => {
    mockGetSession.mockResolvedValueOnce(baSession("USER"));
    const request = new NextRequest("https://files.example.com/api/files", {
      headers: {
        authorization: "Bearer session-token",
        cookie: "better-auth.session_token=other",
      },
    });

    await expect(readMobileBearerSession(request)).resolves.toMatchObject({
      user: { id: "user-id", email: "user@example.com", role: "USER" },
    });
    const headersArg = mockGetSession.mock.calls[0][0].headers as Headers;
    expect(headersArg.get("cookie")).toBeNull();
    expect(headersArg.get("authorization")).toMatch(/^Bearer /i);
  });

  it("rejects a malformed or tampered bearer even when a valid cookie exists", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const request = new NextRequest("https://files.example.com/api/admin", {
      headers: {
        authorization: "Bearer not-a-session-token",
        cookie: "better-auth.session_token=valid",
      },
    });

    await expect(readMobileBearerSession(request)).resolves.toBeNull();
  });

  it("rejects a session that still requires two-factor authentication", async () => {
    mockGetSession.mockResolvedValueOnce(
      baSession("USER", { twoFactorRequired: true }),
    );
    const request = new NextRequest("https://files.example.com/api/files", {
      headers: {
        authorization: "Bearer pending-2fa-token",
      },
    });

    await expect(readMobileBearerSession(request)).resolves.toBeNull();
  });

  it("keeps the shared admin role check for bearer sessions", async () => {
    const adminRoute = createAdminRoute(async ({ session }) =>
      NextResponse.json({ role: session.user.role }),
    );

    mockGetSession.mockResolvedValueOnce(baSession("USER"));
    const userRequest = new NextRequest("https://files.example.com/api/admin", {
      headers: { authorization: "Bearer user-token" },
    });
    expect((await adminRoute(userRequest)).status).toBe(403);

    mockGetSession.mockResolvedValueOnce(baSession("ADMIN"));
    const adminRequest = new NextRequest(
      "https://files.example.com/api/admin",
      {
        headers: { authorization: "Bearer admin-token" },
      },
    );
    expect((await adminRoute(adminRequest)).status).toBe(200);
  });
});
