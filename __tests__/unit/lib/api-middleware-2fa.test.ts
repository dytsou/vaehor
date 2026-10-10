import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: mockAuth,
}));

import { createUserRoute, createPublicRoute } from "@/lib/api-middleware";

describe("api-middleware pending 2FA", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects protected routes when twoFactorRequired is set", async () => {
    mockAuth.mockResolvedValueOnce({
      user: {
        id: "u1",
        email: "a@b.c",
        role: "USER",
        twoFactorRequired: true,
      },
      expires: new Date().toISOString(),
    });

    const route = createUserRoute(async () => NextResponse.json({ ok: true }));
    const res = await route(
      new NextRequest("http://localhost/api/trash", { method: "GET" }),
    );
    expect(res.status).toBe(403);
  });

  it("allows protected routes when allowPending2FA is set", async () => {
    mockAuth.mockResolvedValueOnce({
      user: {
        id: "u1",
        email: "a@b.c",
        role: "USER",
        twoFactorRequired: true,
      },
      expires: new Date().toISOString(),
    });

    const route = createUserRoute(async () => NextResponse.json({ ok: true }), {
      allowPending2FA: true,
      requireEmail: true,
    });
    const res = await route(
      new NextRequest("http://localhost/api/auth/2fa/verify", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(200);
  });

  it("strips pending-2FA session on public includeSession routes", async () => {
    mockAuth.mockResolvedValueOnce({
      user: {
        id: "u1",
        email: "a@b.c",
        role: "USER",
        twoFactorRequired: true,
      },
      expires: new Date().toISOString(),
    });

    const route = createPublicRoute(
      async ({ session }) => NextResponse.json({ hasUser: !!session?.user }),
      { includeSession: true },
    );
    const res = await route(
      new NextRequest("http://localhost/api/files", { method: "GET" }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ hasUser: false });
  });
});
