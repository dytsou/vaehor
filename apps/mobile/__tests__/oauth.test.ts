import { afterEach, describe, expect, it, vi } from "vitest";

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
  buildGoogleSignInUrl,
  parseOAuthCallbackUrl,
  startGoogleOAuth,
  type OAuthDeps,
  type OAuthPendingStore,
} from "../src/lib/oauth";

function pendingStore(): OAuthPendingStore & { value: string | null } {
  return {
    value: null,
    async get() {
      return this.value;
    },
    async set(origin) {
      this.value = origin;
    },
    async clear() {
      this.value = null;
    },
  };
}

describe("native oauth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds the provider URL for the chosen self-hosted server", () => {
    const url = new URL(
      buildGoogleSignInUrl("https://files.example.com", "state"),
    );
    expect(url.origin).toBe("https://files.example.com");
    expect(url.pathname).toBe("/api/auth/signin/google");
    const callback = new URL(url.searchParams.get("callbackUrl") ?? "");
    expect(callback.origin).toBe("https://files.example.com");
    expect(callback.searchParams.get("state")).toBe("state");
  });

  it("rejects callbacks outside the registered app scheme and route", () => {
    expect(
      parseOAuthCallbackUrl("https://files.example.com/auth/callback?token=x"),
    ).toBeNull();
    expect(parseOAuthCallbackUrl("vaehor://share?token=x")).toBeNull();
    expect(parseOAuthCallbackUrl("vaehor://auth/callback")).toBeNull();
  });

  it("redeems a callback only with the saved server origin and stores its session", async () => {
    const pending = pendingStore();
    const fetchState = vi.fn().mockResolvedValue("state-a");
    const openBrowser = vi
      .fn()
      .mockImplementation(async (_url, redirectUrl) => {
        expect(redirectUrl).toBe("vaehor://auth/callback");
        return {
          type: "success",
          url: "vaehor://auth/callback?token=exchange-a&origin=https%3A%2F%2Fattacker.example",
        };
      });
    const redeemExchange = vi.fn().mockResolvedValue({
      cookieName: "authjs.session-token",
      bootstrapToken: "bootstrap-a",
    });
    const redeemBootstrap = vi
      .fn()
      .mockResolvedValue({ sessionToken: "session-a" });
    const saveSession = vi.fn().mockResolvedValue(undefined);
    const deps: OAuthDeps = {
      fetchState,
      openBrowser,
      redeemExchange,
      redeemBootstrap,
      pendingStore: pending,
      saveSession,
      createRedirectUrl: () => "vaehor://auth/callback",
    };

    await expect(
      startGoogleOAuth("https://files.example.com/path", deps),
    ).resolves.toEqual({
      origin: "https://files.example.com",
      cookieName: "authjs.session-token",
    });
    expect(fetchState).toHaveBeenCalledWith("https://files.example.com");
    expect(redeemExchange).toHaveBeenCalledWith(
      "https://files.example.com",
      "exchange-a",
    );
    expect(redeemBootstrap).toHaveBeenCalledWith(
      "https://files.example.com",
      "bootstrap-a",
    );
    expect(saveSession).toHaveBeenCalledWith(
      "https://files.example.com",
      "session-a",
    );
    expect(pending.value).toBeNull();
  });
});
