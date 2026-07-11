import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  MAX_BIOMETRIC_FAILURES,
  clearSessionForServer,
  issueBootstrapPath,
  loadSessionForServer,
  recordBiometricFailure,
  saveSessionForServer,
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
