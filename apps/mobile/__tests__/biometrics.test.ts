import { describe, it, expect, vi } from "vitest";

vi.mock("expo-local-authentication", () => ({}));
vi.mock("expo-linking", () => ({ createURL: vi.fn() }));
vi.mock("expo-web-browser", () => ({ openAuthSessionAsync: vi.fn() }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));
vi.mock("expo-secure-store", () => ({
  setItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

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

  it("parses vaehor callback URLs", () => {
    expect(parseOAuthCallbackUrl("vaehor://auth/callback?token=abc")).toEqual({
      token: "abc",
    });
    expect(parseOAuthCallbackUrl("https://evil.example")).toBeNull();
  });
});
