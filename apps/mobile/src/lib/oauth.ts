import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { requireSecureServerOrigin } from "./api-client";
import { saveSessionForServer } from "./session-store";

const PENDING_OAUTH_ORIGIN_KEY = "vaehor.oauth.pending-origin.v1";
const REQUEST_TIMEOUT_MS = 15_000;

export type OAuthBrowserResult =
  { type: "success"; url: string } | { type: "cancel" | "dismiss" };

export type OAuthPendingStore = {
  get(): Promise<string | null>;
  set(origin: string): Promise<void>;
  clear(): Promise<void>;
};

export type OAuthDeps = {
  fetchState: (origin: string) => Promise<string>;
  openBrowser: (
    url: string,
    redirectUrl: string,
  ) => Promise<OAuthBrowserResult>;
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
  pendingStore?: OAuthPendingStore;
  saveSession?: (origin: string, sessionToken: string) => Promise<void>;
  createRedirectUrl?: () => string;
};

const defaultPendingStore: OAuthPendingStore = {
  get: () => AsyncStorage.getItem(PENDING_OAUTH_ORIGIN_KEY),
  set: (origin) => AsyncStorage.setItem(PENDING_OAUTH_ORIGIN_KEY, origin),
  clear: () => AsyncStorage.removeItem(PENDING_OAUTH_ORIGIN_KEY),
};

async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export const defaultOAuthDeps: OAuthDeps = {
  async fetchState(origin) {
    const serverOrigin = requireSecureServerOrigin(origin);
    const res = await fetchWithTimeout(
      `${serverOrigin}/api/mobile/oauth-state`,
      {
        credentials: "omit",
      },
    );
    if (!res.ok) throw new Error("oauth_state_failed");
    const body = (await res.json()) as { state?: unknown };
    if (typeof body.state !== "string" || !body.state) {
      throw new Error("oauth_state_invalid");
    }
    return body.state;
  },
  async openBrowser(url, redirectUrl) {
    const result = await WebBrowser.openAuthSessionAsync(url, redirectUrl);
    if (result.type === "success" && result.url) {
      return { type: "success", url: result.url };
    }
    return { type: result.type === "dismiss" ? "dismiss" : "cancel" };
  },
  async redeemExchange(origin, token) {
    const serverOrigin = requireSecureServerOrigin(origin);
    const res = await fetchWithTimeout(
      `${serverOrigin}/api/mobile/oauth-complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        credentials: "omit",
      },
    );
    if (!res.ok) throw new Error("oauth_redeem_failed");
    const body = (await res.json()) as {
      cookieName?: unknown;
      bootstrapToken?: unknown;
    };
    if (
      typeof body.cookieName !== "string" ||
      typeof body.bootstrapToken !== "string"
    ) {
      throw new TypeError("oauth_redeem_invalid");
    }
    return {
      cookieName: body.cookieName,
      bootstrapToken: body.bootstrapToken,
    };
  },
  async redeemBootstrap(origin, bootstrapToken) {
    const serverOrigin = requireSecureServerOrigin(origin);
    const res = await fetchWithTimeout(
      `${serverOrigin}/api/mobile/session-bootstrap`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bootstrapToken }),
        credentials: "omit",
      },
    );
    if (!res.ok) throw new Error("oauth_bootstrap_redeem_failed");
    const body = (await res.json()) as { sessionToken?: unknown };
    if (typeof body.sessionToken !== "string" || !body.sessionToken) {
      throw new Error("oauth_bootstrap_invalid");
    }
    return { sessionToken: body.sessionToken };
  },
  pendingStore: defaultPendingStore,
  saveSession: saveSessionForServer,
  createRedirectUrl: () => Linking.createURL("auth/callback"),
};

export function buildGoogleSignInUrl(origin: string, state: string): string {
  const serverOrigin = requireSecureServerOrigin(origin);
  if (!state.trim()) throw new Error("oauth_state_invalid");
  const callback = new URL("/api/mobile/oauth-complete", serverOrigin);
  callback.searchParams.set("state", state);
  const signIn = new URL("/api/auth/signin/google", serverOrigin);
  signIn.searchParams.set("callbackUrl", callback.toString());
  return signIn.toString();
}

export function parseOAuthCallbackUrl(url: string): { token: string } | null {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "vaehor:" ||
      parsed.hostname !== "auth" ||
      parsed.pathname !== "/callback"
    ) {
      return null;
    }
    const token = parsed.searchParams.get("token");
    return token && token.length <= 8192 ? { token } : null;
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
  const origin = requireSecureServerOrigin(expectedOrigin);
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

const handledCallbacks = new Map<
  string,
  Promise<{ origin: string; cookieName: string } | null>
>();

/** Completes an app callback against the server saved before opening OAuth. */
export async function completePendingOAuthCallback(
  callbackUrl: string,
  deps: OAuthDeps = defaultOAuthDeps,
): Promise<{ origin: string; cookieName: string } | null> {
  const parsed = parseOAuthCallbackUrl(callbackUrl);
  if (!parsed) return null;
  const existing = handledCallbacks.get(parsed.token);
  if (existing) return existing;

  const task = (async () => {
    const pendingStore = deps.pendingStore ?? defaultPendingStore;
    const pendingOrigin = await pendingStore.get();
    if (!pendingOrigin) return null;

    const origin = requireSecureServerOrigin(pendingOrigin);
    await pendingStore.clear();
    const completed = await completeOAuthFromCallback(
      origin,
      callbackUrl,
      deps,
    );
    await (deps.saveSession ?? saveSessionForServer)(
      completed.origin,
      completed.sessionToken,
    );
    return { origin: completed.origin, cookieName: completed.cookieName };
  })();

  handledCallbacks.set(parsed.token, task);
  if (handledCallbacks.size > 10) {
    const oldest = handledCallbacks.keys().next().value;
    if (oldest) handledCallbacks.delete(oldest);
  }
  return task;
}

export async function startGoogleOAuth(
  serverOrigin: string,
  deps: OAuthDeps = defaultOAuthDeps,
): Promise<{ origin: string; cookieName: string } | null> {
  const origin = requireSecureServerOrigin(serverOrigin);
  const pendingStore = deps.pendingStore ?? defaultPendingStore;
  await pendingStore.set(origin);

  try {
    const state = await deps.fetchState(origin);
    const redirectUrl =
      deps.createRedirectUrl?.() ?? Linking.createURL("auth/callback");
    const result = await deps.openBrowser(
      buildGoogleSignInUrl(origin, state),
      redirectUrl,
    );
    if (result.type !== "success") {
      await pendingStore.clear();
      return null;
    }
    return await completePendingOAuthCallback(result.url, deps);
  } catch (error) {
    await pendingStore.clear();
    throw error;
  }
}

export function bootstrapPathFromToken(bootstrapToken: string): string {
  return `/api/mobile/session-bootstrap?token=${encodeURIComponent(bootstrapToken)}`;
}
