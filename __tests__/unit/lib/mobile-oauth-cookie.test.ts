import { describe, expect, it } from "vitest";
import {
  MOBILE_SESSION_COOKIE_NAME,
  mobileSessionCookieName,
  readMobileSessionCookieValue,
} from "@/lib/services/mobile-oauth";

describe("mobile session cookie helpers", () => {
  it("uses Better Auth cookie name and Secure prefix when needed", () => {
    expect(MOBILE_SESSION_COOKIE_NAME).toBe("better-auth.session_token");
    expect(mobileSessionCookieName(false)).toBe("better-auth.session_token");
    expect(mobileSessionCookieName(true)).toBe(
      "__Secure-better-auth.session_token",
    );
  });

  it("reads plain or __Secure- session cookies", () => {
    const jar = new Map<string, string>([
      ["__Secure-better-auth.session_token", "signed.token"],
    ]);
    expect(
      readMobileSessionCookieValue({
        get: (name) => {
          const value = jar.get(name);
          return value === undefined ? undefined : { value };
        },
      }),
    ).toBe("signed.token");
  });
});
