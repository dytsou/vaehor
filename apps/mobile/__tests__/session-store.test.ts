import { describe, it, expect, vi, beforeEach } from "vitest";

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
  MAX_BIOMETRIC_FAILURES,
  clearSessionForServer,
  issueBootstrapPath,
  loadSessionForServer,
  clearLocalStorageAccessTokenForServer,
  loadLocalStorageAccessTokenForServer,
  recordBiometricFailure,
  saveLocalStorageAccessTokenForServer,
  saveSessionForServer,
  serverCredentialKey,
  localStorageAccessTokenKey,
  type LocalStorageAccessStoreDeps,
  type SessionStoreDeps,
} from "../src/lib/session-store";

function memoryDeps(): SessionStoreDeps & {
  creds: Map<string, { username: string; password: string }>;
  failures: Map<string, number>;
} {
  const creds = new Map<string, { username: string; password: string }>();
  const failures = new Map<string, number>();
  return {
    creds,
    failures,
    async setCredentials(server, username, password) {
      creds.set(server, { username, password });
    },
    async getCredentials(server) {
      return creds.get(server) ?? null;
    },
    async deleteCredentials(server) {
      creds.delete(server);
    },
    async getFailures(origin) {
      return failures.get(origin) ?? 0;
    },
    async setFailures(origin, count) {
      failures.set(origin, count);
    },
  };
}

describe("session-store", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("saves and loads a session per server origin", async () => {
    const deps = memoryDeps();
    await saveSessionForServer("https://a.example", "token-a", deps);
    await expect(loadSessionForServer("https://a.example", deps)).resolves.toBe(
      "token-a",
    );
  });

  it("clears stored session on sign-out", async () => {
    const deps = memoryDeps();
    await saveSessionForServer("https://a.example", "token-a", deps);
    await clearSessionForServer("https://a.example", deps);
    await expect(
      loadSessionForServer("https://a.example", deps),
    ).resolves.toBeNull();
  });

  it("uses one normalized-origin namespace and clears only that server", async () => {
    const deps = memoryDeps();
    await saveSessionForServer(
      "https://a.example/path?discard=1",
      "token-a",
      deps,
    );
    await saveSessionForServer("https://b.example", "token-b", deps);

    await expect(loadSessionForServer("https://a.example", deps)).resolves.toBe(
      "token-a",
    );
    await clearSessionForServer("https://a.example/another-path", deps);

    await expect(
      loadSessionForServer("https://a.example", deps),
    ).resolves.toBeNull();
    await expect(loadSessionForServer("https://b.example", deps)).resolves.toBe(
      "token-b",
    );
  });

  it("uses SecureStore-safe characters for server credential keys", () => {
    const key = serverCredentialKey("https://a.example/path?discard=1");
    expect(key).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(key).toBe(serverCredentialKey("https://a.example/other-path"));
  });

  it("keeps local-storage unlock tokens in a server-scoped SecureStore key", async () => {
    const tokens = new Map<string, string>();
    const deps: LocalStorageAccessStoreDeps = {
      async setToken(key, token) {
        tokens.set(key, token);
      },
      async getToken(key) {
        return tokens.get(key) ?? null;
      },
      async deleteToken(key) {
        tokens.delete(key);
      },
    };

    await saveLocalStorageAccessTokenForServer(
      "https://a.example/path",
      "local-token-a",
      deps,
    );
    await saveLocalStorageAccessTokenForServer(
      "https://b.example",
      "local-token-b",
      deps,
    );

    await expect(
      loadLocalStorageAccessTokenForServer("https://a.example", deps),
    ).resolves.toBe("local-token-a");
    await clearLocalStorageAccessTokenForServer("https://a.example", deps);
    await expect(
      loadLocalStorageAccessTokenForServer("https://a.example", deps),
    ).resolves.toBeNull();
    await expect(
      loadLocalStorageAccessTokenForServer("https://b.example", deps),
    ).resolves.toBe("local-token-b");
    expect(localStorageAccessTokenKey("https://a.example")).toMatch(
      /^[A-Za-z0-9._-]+$/,
    );
  });

  it("wipes session after repeated biometric failures", async () => {
    const deps = memoryDeps();
    await saveSessionForServer("https://a.example", "token-a", deps);
    for (let i = 0; i < MAX_BIOMETRIC_FAILURES; i += 1) {
      await recordBiometricFailure("https://a.example", deps);
    }
    await expect(
      loadSessionForServer("https://a.example", deps),
    ).resolves.toBeNull();
  });

  it("issues bootstrap path from server API", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        bootstrapUrl: "/api/mobile/session-bootstrap?token=abc",
      }),
    });
    await expect(
      issueBootstrapPath("https://a.example", "session", fetchImpl),
    ).resolves.toBe("/api/mobile/session-bootstrap?token=abc");
  });
});
