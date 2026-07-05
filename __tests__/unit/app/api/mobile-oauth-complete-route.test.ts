import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  mockAuth,
  mockCheckRateLimit,
  mockConsumeMobileOAuthState,
  mockMintMobileExchangeToken,
  mockRedeemMobileExchangeToken,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockConsumeMobileOAuthState: vi.fn(),
  mockMintMobileExchangeToken: vi.fn(),
  mockRedeemMobileExchangeToken: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: mockAuth,
}));

vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mockCheckRateLimit,
}));

vi.mock("@/lib/services/mobile-oauth", () => ({
  MOBILE_SESSION_COOKIE_NAME: "authjs.session-token",
  consumeMobileOAuthState: mockConsumeMobileOAuthState,
  mintMobileExchangeToken: mockMintMobileExchangeToken,
  redeemMobileExchangeToken: mockRedeemMobileExchangeToken,
}));

import { GET, OPTIONS, POST } from "@/app/api/mobile/oauth-complete/route";

describe("app/api/mobile/oauth-complete route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ success: true });
    mockAuth.mockResolvedValue({
      user: { email: "user@example.com", role: "USER" },
    });
  });

  it("OPTIONS allows Capacitor origins", async () => {
    const response = await OPTIONS(
      new Request("http://localhost:3000/api/mobile/oauth-complete", {
        method: "OPTIONS",
        headers: { Origin: "capacitor://localhost" },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "capacitor://localhost",
    );
  });

  it("GET redirects with exchange token when state and session are valid", async () => {
    mockConsumeMobileOAuthState.mockResolvedValue(true);
    mockMintMobileExchangeToken.mockResolvedValue("exchange-token");

    const response = await GET(
      new NextRequest(
        "http://localhost:3000/api/mobile/oauth-complete?state=valid-state",
        {
          headers: { cookie: "authjs.session-token=session-jwt" },
        },
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "zeeindex://auth/callback?token=exchange-token",
    );
    expect(mockConsumeMobileOAuthState).toHaveBeenCalledWith("valid-state");
    expect(mockMintMobileExchangeToken).toHaveBeenCalledWith("session-jwt");
  });

  it("GET rejects invalid OAuth state", async () => {
    mockConsumeMobileOAuthState.mockResolvedValue(false);

    const response = await GET(
      new NextRequest(
        "http://localhost:3000/api/mobile/oauth-complete?state=bad-state",
      ),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid OAuth state",
    });
  });

  it("POST returns session material for a valid exchange token", async () => {
    mockRedeemMobileExchangeToken.mockResolvedValue("session-jwt");

    const response = await POST(
      new NextRequest("http://localhost:3000/api/mobile/oauth-complete", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Origin: "capacitor://localhost",
        },
        body: JSON.stringify({ token: "exchange-token" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      cookieName: "authjs.session-token",
      sessionToken: "session-jwt",
    });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "capacitor://localhost",
    );
  });

  it("POST rejects replayed or invalid exchange tokens", async () => {
    mockRedeemMobileExchangeToken.mockResolvedValue(null);

    const response = await POST(
      new NextRequest("http://localhost:3000/api/mobile/oauth-complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "used-token" }),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid or expired token",
    });
  });
});
