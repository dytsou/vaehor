import { describe, it, expect, vi } from "vitest";
import {
  isBiometricAvailable,
  promptBiometricUnlock,
  type BiometricDeps,
} from "../src/lib/biometrics";
import { buildGoogleSignInUrl, parseOAuthCallbackUrl } from "../src/lib/oauth";

describe("biometrics", () => {
  it("reports availability from plugin", async () => {
    const deps: BiometricDeps = {
      isAvailable: vi.fn().mockResolvedValue({ isAvailable: true }),
      verifyIdentity: vi.fn(),
    };
    await expect(isBiometricAvailable(deps)).resolves.toBe(true);
  });

  it("returns false when biometric prompt fails", async () => {
    const deps: BiometricDeps = {
      isAvailable: vi.fn(),
      verifyIdentity: vi.fn().mockRejectedValue(new Error("cancelled")),
    };
    await expect(promptBiometricUnlock("Unlock", deps)).resolves.toBe(false);
  });
});

describe("oauth helpers", () => {
  it("builds Google sign-in URL with oauth-complete callback", () => {
    const url = buildGoogleSignInUrl("https://files.example.com", "state-123");
    expect(url).toContain("/api/auth/signin/google");
    expect(url).toContain(
      encodeURIComponent(
        "https://files.example.com/api/mobile/oauth-complete?state=state-123",
      ),
    );
  });

  it("parses zeeindex callback URLs", () => {
    expect(parseOAuthCallbackUrl("zeeindex://auth/callback?token=abc")).toEqual(
      { token: "abc" },
    );
    expect(parseOAuthCallbackUrl("https://evil.example")).toBeNull();
  });
});
