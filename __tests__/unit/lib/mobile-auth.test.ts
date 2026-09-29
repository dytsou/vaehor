import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encode } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import { readMobileBearerSession } from "@/lib/mobile-auth";
import { createAdminRoute } from "@/lib/api-middleware";

const SECRET = "mobile-auth-test-secret-with-at-least-32-bytes";
const COOKIE_NAME = "authjs.session-token";

async function sessionToken(
  role: string,
  claims: Record<string, unknown> = {},
) {
  return encode({
    token: {
      id: `${role.toLowerCase()}-id`,
      sub: `${role.toLowerCase()}-id`,
      name: role,
      email: `${role.toLowerCase()}@example.com`,
      role,
      isGuest: role === "GUEST",
      ...claims,
    },
    secret: SECRET,
    salt: COOKIE_NAME,
    maxAge: 60,
  });
}

describe("mobile bearer authentication", () => {
  beforeEach(() => {
    vi.stubEnv("NEXTAUTH_SECRET", SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the verified bearer claim even when a different cookie is present", async () => {
    const [userToken, cookieToken] = await Promise.all([
      sessionToken("USER"),
      sessionToken("ADMIN"),
    ]);
    const request = new NextRequest("https://files.example.com/api/files", {
      headers: {
        authorization: `Bearer ${userToken}`,
        cookie: `${COOKIE_NAME}=${cookieToken}`,
      },
    });

    await expect(readMobileBearerSession(request)).resolves.toMatchObject({
      user: { id: "user-id", email: "user@example.com", role: "USER" },
    });
  });

  it("rejects a malformed or tampered bearer even when a valid cookie exists", async () => {
    const cookieToken = await sessionToken("ADMIN");
    const request = new NextRequest("https://files.example.com/api/admin", {
      headers: {
        authorization: "Bearer not-a-session-token",
        cookie: `${COOKIE_NAME}=${cookieToken}`,
      },
    });

    await expect(readMobileBearerSession(request)).resolves.toBeNull();
  });

  it("rejects a session that still requires two-factor authentication", async () => {
    const request = new NextRequest("https://files.example.com/api/files", {
      headers: {
        authorization: `Bearer ${await sessionToken("USER", { twoFactorRequired: true })}`,
      },
    });

    await expect(readMobileBearerSession(request)).resolves.toBeNull();
  });

  it("keeps the shared admin role check for bearer sessions", async () => {
    const adminRoute = createAdminRoute(async ({ session }) =>
      NextResponse.json({ role: session.user.role }),
    );
    const userRequest = new NextRequest("https://files.example.com/api/admin", {
      headers: { authorization: `Bearer ${await sessionToken("USER")}` },
    });
    const adminRequest = new NextRequest(
      "https://files.example.com/api/admin",
      {
        headers: { authorization: `Bearer ${await sessionToken("ADMIN")}` },
      },
    );

    expect((await adminRoute(userRequest)).status).toBe(403);
    expect((await adminRoute(adminRequest)).status).toBe(200);
  });
});
