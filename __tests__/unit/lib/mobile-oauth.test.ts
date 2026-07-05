// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";

const TEST_SECRET = new TextEncoder().encode(
  "01234567890123456789012345678901",
);

vi.mock("@/lib/local-auth-secret", () => ({
  getLocalStorageAuthSecret: () => TEST_SECRET,
}));

import {
  consumeMobileOAuthState,
  createMobileOAuthState,
  mintMobileExchangeToken,
  redeemMobileExchangeToken,
  resetMobileOAuthNonceStoreForTests,
} from "@/lib/services/mobile-oauth";

describe("lib/services/mobile-oauth", () => {
  beforeEach(() => {
    resetMobileOAuthNonceStoreForTests();
  });

  it("creates and consumes OAuth state once", async () => {
    const state = await createMobileOAuthState();
    expect(await consumeMobileOAuthState(state)).toBe(true);
    expect(await consumeMobileOAuthState(state)).toBe(false);
  });

  it("mints and redeems exchange tokens once", async () => {
    const exchange = await mintMobileExchangeToken("session-value");
    expect(await redeemMobileExchangeToken(exchange)).toBe("session-value");
    expect(await redeemMobileExchangeToken(exchange)).toBeNull();
  });

  it("rejects tampered exchange tokens", async () => {
    const forged = await new SignJWT({
      purpose: "mobile-oauth-exchange",
      sessionToken: "forged",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setJti("forged-jti")
      .setIssuedAt()
      .setExpirationTime("2m")
      .sign(new TextEncoder().encode("wrong-secret-01234567890123456789012"));

    expect(await redeemMobileExchangeToken(forged)).toBeNull();
  });
});
