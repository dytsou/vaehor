import type { ServerBookmark } from "./servers";
import { isBiometricAvailable, promptBiometricUnlock } from "./biometrics";
import {
  loadSessionForServer,
  recordBiometricFailure,
  resetBiometricFailures,
} from "./session-store";
import { normalizeServerOrigin } from "./api-client";

export type BiometricSessionResult =
  | { status: "authenticated"; token: string }
  | { status: "missing" }
  | { status: "biometrics-unavailable" }
  | { status: "biometrics-denied" };

export type BiometricSessionDependencies = {
  isAvailable: () => Promise<boolean>;
  promptUnlock: (reason: string) => Promise<boolean>;
  loadSession: (origin: string) => Promise<string | null>;
  recordFailure: (origin: string) => Promise<unknown>;
  resetFailures: (origin: string) => Promise<void>;
};

const unlockedOrigins = new Set<string>();

const defaultDependencies: BiometricSessionDependencies = {
  isAvailable: isBiometricAvailable,
  promptUnlock: promptBiometricUnlock,
  loadSession: loadSessionForServer,
  recordFailure: recordBiometricFailure,
  resetFailures: resetBiometricFailures,
};

export function clearBiometricSessionCache() {
  unlockedOrigins.clear();
}

export async function loadBiometricServerSession(
  server: ServerBookmark,
  deps: BiometricSessionDependencies = defaultDependencies,
): Promise<BiometricSessionResult> {
  const origin = normalizeServerOrigin(server.url);

  if (server.biometricsEnabled && !unlockedOrigins.has(origin)) {
    if (!(await deps.isAvailable())) {
      return { status: "biometrics-unavailable" };
    }

    if (!(await deps.promptUnlock(`Unlock ${server.label}`))) {
      await deps.recordFailure(server.url);
      return { status: "biometrics-denied" };
    }

    await deps.resetFailures(server.url);
    unlockedOrigins.add(origin);
  }

  const token = await deps.loadSession(server.url);
  if (!token) {
    unlockedOrigins.delete(origin);
    return { status: "missing" };
  }

  return { status: "authenticated", token };
}
