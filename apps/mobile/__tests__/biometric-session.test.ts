import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearBiometricSessionCache,
  loadBiometricServerSession,
  type BiometricSessionDependencies,
} from "../src/lib/biometric-session";

vi.mock("../src/lib/biometrics", () => ({
  isBiometricAvailable: vi.fn(),
  promptBiometricUnlock: vi.fn(),
}));

vi.mock("../src/lib/session-store", () => ({
  loadSessionForServer: vi.fn(),
  recordBiometricFailure: vi.fn(),
  resetBiometricFailures: vi.fn(),
}));

const server = {
  id: "server-1",
  url: "https://files.example.com/path",
  label: "Files",
  biometricsEnabled: true,
};

function dependencies(
  overrides: Partial<BiometricSessionDependencies> = {},
): BiometricSessionDependencies {
  return {
    isAvailable: vi.fn(async () => true),
    promptUnlock: vi.fn(async () => true),
    loadSession: vi.fn(async () => "session-token"),
    recordFailure: vi.fn(async () => 1),
    resetFailures: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("loadBiometricServerSession", () => {
  beforeEach(() => clearBiometricSessionCache());

  it("unlocks before reading the saved token and reuses that unlock in the app session", async () => {
    const calls: string[] = [];
    const deps = dependencies({
      promptUnlock: vi.fn(async () => {
        calls.push("biometric");
        return true;
      }),
      loadSession: vi.fn(async () => {
        calls.push("session");
        return "session-token";
      }),
    });

    await expect(loadBiometricServerSession(server, deps)).resolves.toEqual({
      status: "authenticated",
      token: "session-token",
    });
    await expect(loadBiometricServerSession(server, deps)).resolves.toEqual({
      status: "authenticated",
      token: "session-token",
    });
    expect(calls).toEqual(["biometric", "session", "session"]);
  });

  it("does not read the credential when biometrics are unavailable", async () => {
    const deps = dependencies({ isAvailable: vi.fn(async () => false) });

    await expect(loadBiometricServerSession(server, deps)).resolves.toEqual({
      status: "biometrics-unavailable",
    });
    expect(deps.loadSession).not.toHaveBeenCalled();
  });

  it("records a denied unlock without reading the credential", async () => {
    const deps = dependencies({ promptUnlock: vi.fn(async () => false) });

    await expect(loadBiometricServerSession(server, deps)).resolves.toEqual({
      status: "biometrics-denied",
    });
    expect(deps.recordFailure).toHaveBeenCalledWith(server.url);
    expect(deps.loadSession).not.toHaveBeenCalled();
  });

  it("reads the saved session directly when biometrics are disabled", async () => {
    const deps = dependencies();

    await expect(
      loadBiometricServerSession({ ...server, biometricsEnabled: false }, deps),
    ).resolves.toEqual({ status: "authenticated", token: "session-token" });
    expect(deps.isAvailable).not.toHaveBeenCalled();
    expect(deps.loadSession).toHaveBeenCalledOnce();
  });

  it("clears a cached unlock when the secure session is missing", async () => {
    const deps = dependencies({ loadSession: vi.fn(async () => null) });

    await expect(loadBiometricServerSession(server, deps)).resolves.toEqual({
      status: "missing",
    });
    await loadBiometricServerSession(server, deps);
    expect(deps.promptUnlock).toHaveBeenCalledTimes(2);
  });
});
