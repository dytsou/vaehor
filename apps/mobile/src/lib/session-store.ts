import { Preferences } from "@capacitor/preferences";
import { NativeBiometric } from "@capgo/capacitor-native-biometric";

export const MAX_BIOMETRIC_FAILURES = 3;

const failuresKey = (origin: string) =>
  `zee.biometricFailures.${encodeURIComponent(origin)}`;

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

export const defaultSessionStoreDeps: SessionStoreDeps = {
  async setCredentials(server, username, password) {
    await NativeBiometric.setCredentials({ server, username, password });
  },
  async getCredentials(server) {
    try {
      const creds = await NativeBiometric.getCredentials({ server });
      return { username: creds.username, password: creds.password };
    } catch {
      return null;
    }
  },
  async deleteCredentials(server) {
    try {
      await NativeBiometric.deleteCredentials({ server });
    } catch {
      // ponytail: delete is best-effort when credentials were never stored
    }
  },
  async getFailures(origin) {
    const { value } = await Preferences.get({ key: failuresKey(origin) });
    return value ? Number.parseInt(value, 10) : 0;
  },
  async setFailures(origin, count) {
    await Preferences.set({ key: failuresKey(origin), value: String(count) });
  },
};

export function serverCredentialKey(origin: string): string {
  return origin;
}

export async function saveSessionForServer(
  origin: string,
  sessionToken: string,
  deps: SessionStoreDeps = defaultSessionStoreDeps,
): Promise<void> {
  await deps.setCredentials(serverCredentialKey(origin), origin, sessionToken);
  await deps.setFailures(origin, 0);
}

export async function loadSessionForServer(
  origin: string,
  deps: SessionStoreDeps = defaultSessionStoreDeps,
): Promise<string | null> {
  const failures = await deps.getFailures(origin);
  if (failures >= MAX_BIOMETRIC_FAILURES) {
    await clearSessionForServer(origin, deps);
    return null;
  }

  const creds = await deps.getCredentials(serverCredentialKey(origin));
  if (creds?.username !== origin) return null;
  return creds.password;
}

export async function clearSessionForServer(
  origin: string,
  deps: SessionStoreDeps = defaultSessionStoreDeps,
): Promise<void> {
  await deps.deleteCredentials(serverCredentialKey(origin));
  await deps.setFailures(origin, 0);
}

export async function recordBiometricFailure(
  origin: string,
  deps: SessionStoreDeps = defaultSessionStoreDeps,
): Promise<number> {
  const next = (await deps.getFailures(origin)) + 1;
  await deps.setFailures(origin, next);
  if (next >= MAX_BIOMETRIC_FAILURES) {
    await clearSessionForServer(origin, deps);
  }
  return next;
}

export async function resetBiometricFailures(
  origin: string,
  deps: SessionStoreDeps = defaultSessionStoreDeps,
): Promise<void> {
  await deps.setFailures(origin, 0);
}

export async function issueBootstrapPath(
  origin: string,
  sessionToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchImpl(`${origin}/api/mobile/session-bootstrap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionToken }),
  });
  if (!res.ok) {
    throw new Error("bootstrap_issue_failed");
  }
  const body = (await res.json()) as { bootstrapUrl: string };
  return body.bootstrapUrl;
}

export function webViewEntryUrl(origin: string, bootstrapPath: string): string {
  return `${origin}${bootstrapPath}`;
}
