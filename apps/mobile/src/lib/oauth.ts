import { Browser } from "@capacitor/browser";
import { normalizeServerOrigin } from "./api-client";

export type OAuthDeps = {
  fetchState: (origin: string) => Promise<string>;
  openBrowser: (url: string) => Promise<void>;
  redeemExchange: (
    origin: string,
    token: string,
  ) => Promise<{
    cookieName: string;
    bootstrapToken: string;
  }>;
  redeemBootstrap: (
    origin: string,
    bootstrapToken: string,
  ) => Promise<{ sessionToken: string }>;
};

export const defaultOAuthDeps: OAuthDeps = {
  async fetchState(origin) {
    const res = await fetch(`${origin}/api/mobile/oauth-state`);
    if (!res.ok) throw new Error("oauth_state_failed");
    const body = (await res.json()) as { state: string };
    return body.state;
  },
  async openBrowser(url) {
    await Browser.open({ url });
  },
  async redeemExchange(origin, token) {
    const res = await fetch(`${origin}/api/mobile/oauth-complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) throw new Error("oauth_redeem_failed");
    return (await res.json()) as {
      cookieName: string;
      bootstrapToken: string;
    };
  },
  async redeemBootstrap(origin, bootstrapToken) {
    const res = await fetch(`${origin}/api/mobile/session-bootstrap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bootstrapToken }),
    });
    if (!res.ok) throw new Error("oauth_bootstrap_redeem_failed");
    return (await res.json()) as { sessionToken: string };
  },
};

export function buildGoogleSignInUrl(origin: string, state: string): string {
  const callback = new URL("/api/mobile/oauth-complete", origin);
  callback.searchParams.set("state", state);
  const signIn = new URL("/api/auth/signin/google", origin);
  signIn.searchParams.set("callbackUrl", callback.toString());
  return signIn.toString();
}

export async function startGoogleOAuth(
  serverOrigin: string,
  deps: OAuthDeps = defaultOAuthDeps,
): Promise<void> {
  const origin = normalizeServerOrigin(serverOrigin);
  const state = await deps.fetchState(origin);
  await deps.openBrowser(buildGoogleSignInUrl(origin, state));
}

export function parseOAuthCallbackUrl(url: string): { token: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "zeeindex:") return null;
    if (parsed.hostname !== "auth" || parsed.pathname !== "/callback") {
      return null;
    }
    const token = parsed.searchParams.get("token");
    return token ? { token } : null;
  } catch {
    return null;
  }
}

export async function completeOAuthFromCallback(
  expectedOrigin: string,
  callbackUrl: string,
  deps: OAuthDeps = defaultOAuthDeps,
): Promise<{
  origin: string;
  cookieName: string;
  sessionToken: string;
}> {
  const origin = normalizeServerOrigin(expectedOrigin);
  const parsed = parseOAuthCallbackUrl(callbackUrl);
  if (!parsed) throw new Error("oauth_callback_invalid");

  const exchanged = await deps.redeemExchange(origin, parsed.token);
  const { sessionToken } = await deps.redeemBootstrap(
    origin,
    exchanged.bootstrapToken,
  );
  return {
    origin,
    cookieName: exchanged.cookieName,
    sessionToken,
  };
}

export function bootstrapPathFromToken(bootstrapToken: string): string {
  return `/api/mobile/session-bootstrap?token=${encodeURIComponent(bootstrapToken)}`;
}
