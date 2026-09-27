import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { normalizeServerOrigin } from "./api-client";

export const MAX_BIOMETRIC_FAILURES = 3;

const failuresKey = (origin: string) =>
  `vaehor.biometricFailures.v1.${encodeURIComponent(normalizeServerOrigin(origin))}`;

export type SessionStoreDeps = {
  setCredentials: (
    server: string,
    username: string,
    password: string,
  ) => Promise<void>;
  getCredentials: (
    server: string,
  ) => Promise<{ username: string; password: string } | null>;
  deleteCredentials: (server: string) => Promise<void>;
  getFailures: (origin: string) => Promise<number>;
  setFailures: (origin: string, count: number) => Promise<void>;
};

export type LocalStorageAccessStoreDeps = {
  setToken: (key: string, token: string) => Promise<void>;
  getToken: (key: string) => Promise<string | null>;
  deleteToken: (key: string) => Promise<void>;
};

export const defaultLocalStorageAccessStoreDeps: LocalStorageAccessStoreDeps = {
  async setToken(key, token) {
    await SecureStore.setItemAsync(key, token);
  },
  async getToken(key) {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async deleteToken(key) {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // A token may have expired or already been removed.
    }
  },
};

export const defaultSessionStoreDeps: SessionStoreDeps = {
  async setCredentials(server, username, password) {
    await SecureStore.setItemAsync(
      server,
      JSON.stringify({ username, password }),
    );
  },
  async getCredentials(server) {
    try {
      const value = await SecureStore.getItemAsync(server);
      if (!value) return null;
      const creds: unknown = JSON.parse(value);
      if (
        typeof creds !== "object" ||
        creds === null ||
        !("username" in creds) ||
        typeof creds.username !== "string" ||
        !("password" in creds) ||
        typeof creds.password !== "string"
      ) {
        return null;
      }
      return { username: creds.username, password: creds.password };
    } catch {
      return null;
    }
  },
  async deleteCredentials(server) {
    try {
      await SecureStore.deleteItemAsync(server);
    } catch {
      // ponytail: delete is best-effort when credentials were never stored
    }
  },
  async getFailures(origin) {
    const value = await AsyncStorage.getItem(failuresKey(origin));
    const parsed = value ? Number.parseInt(value, 10) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  },
  async setFailures(origin, count) {
    await AsyncStorage.setItem(failuresKey(origin), String(count));
  },
};

function normalizedOriginHex(origin: string): string {
  const normalizedOrigin = normalizeServerOrigin(origin);
  return Array.from(normalizedOrigin, (character) =>
    character.charCodeAt(0).toString(16).padStart(2, "0"),
  ).join("");
}

export function serverCredentialKey(origin: string): string {
  const originHex = normalizedOriginHex(origin);
  return `vaehor.session.v1.${originHex}`;
}

export function localStorageAccessTokenKey(origin: string): string {
  const originHex = normalizedOriginHex(origin);
  return `vaehor.localStorageAccess.v1.${originHex}`;
}

export async function saveLocalStorageAccessTokenForServer(
  origin: string,
  token: string,
  deps: LocalStorageAccessStoreDeps = defaultLocalStorageAccessStoreDeps,
): Promise<void> {
  if (!token.trim()) throw new Error("local_storage_token_missing");
  await deps.setToken(localStorageAccessTokenKey(origin), token);
}

export async function loadLocalStorageAccessTokenForServer(
  origin: string,
  deps: LocalStorageAccessStoreDeps = defaultLocalStorageAccessStoreDeps,
): Promise<string | null> {
  const token = await deps.getToken(localStorageAccessTokenKey(origin));
  return token?.trim() || null;
}

export async function clearLocalStorageAccessTokenForServer(
  origin: string,
  deps: LocalStorageAccessStoreDeps = defaultLocalStorageAccessStoreDeps,
): Promise<void> {
  await deps.deleteToken(localStorageAccessTokenKey(origin));
}

export async function saveSessionForServer(
  origin: string,
  sessionToken: string,
  deps: SessionStoreDeps = defaultSessionStoreDeps,
): Promise<void> {
  const normalizedOrigin = normalizeServerOrigin(origin);
  await deps.setCredentials(
    serverCredentialKey(normalizedOrigin),
    normalizedOrigin,
    sessionToken,
  );
  await deps.setFailures(normalizedOrigin, 0);
}

export async function loadSessionForServer(
  origin: string,
  deps: SessionStoreDeps = defaultSessionStoreDeps,
): Promise<string | null> {
  const normalizedOrigin = normalizeServerOrigin(origin);
  const failures = await deps.getFailures(normalizedOrigin);
  if (failures >= MAX_BIOMETRIC_FAILURES) {
    await clearSessionForServer(normalizedOrigin, deps);
    return null;
  }

  const creds = await deps.getCredentials(
    serverCredentialKey(normalizedOrigin),
  );
  if (creds?.username !== normalizedOrigin) return null;
  return creds.password;
}

export async function clearSessionForServer(
  origin: string,
  deps: SessionStoreDeps = defaultSessionStoreDeps,
): Promise<void> {
  const normalizedOrigin = normalizeServerOrigin(origin);
  await deps.deleteCredentials(serverCredentialKey(normalizedOrigin));
  await deps.setFailures(normalizedOrigin, 0);
}

export async function recordBiometricFailure(
  origin: string,
  deps: SessionStoreDeps = defaultSessionStoreDeps,
): Promise<number> {
  const normalizedOrigin = normalizeServerOrigin(origin);
  const next = (await deps.getFailures(normalizedOrigin)) + 1;
  await deps.setFailures(normalizedOrigin, next);
  if (next >= MAX_BIOMETRIC_FAILURES) {
    await clearSessionForServer(normalizedOrigin, deps);
  }
  return next;
}

export async function resetBiometricFailures(
  origin: string,
  deps: SessionStoreDeps = defaultSessionStoreDeps,
): Promise<void> {
  await deps.setFailures(normalizeServerOrigin(origin), 0);
}

export async function issueBootstrapPath(
  origin: string,
  sessionToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const serverOrigin = normalizeServerOrigin(origin);
  const res = await fetchImpl(`${serverOrigin}/api/mobile/session-bootstrap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionToken }),
    credentials: "omit",
  });
  if (!res.ok) {
    throw new Error("bootstrap_issue_failed");
  }
  const body = (await res.json()) as { bootstrapUrl: string };
  return body.bootstrapUrl;
}
