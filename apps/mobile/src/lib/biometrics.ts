import { NativeBiometric } from "@capgo/capacitor-native-biometric";

export type BiometricDeps = {
  isAvailable: () => Promise<{ isAvailable: boolean }>;
  verifyIdentity: (reason: string) => Promise<void>;
};

export const defaultBiometricDeps: BiometricDeps = {
  async isAvailable() {
    return NativeBiometric.isAvailable();
  },
  async verifyIdentity(reason) {
    await NativeBiometric.verifyIdentity({
      reason,
      title: "Unlock vaehor",
      subtitle: reason,
      description: reason,
    });
  },
};

export async function isBiometricAvailable(
  deps: BiometricDeps = defaultBiometricDeps,
): Promise<boolean> {
  try {
    const result = await deps.isAvailable();
    return result.isAvailable;
  } catch {
    return false;
  }
}

export async function promptBiometricUnlock(
  reason: string,
  deps: BiometricDeps = defaultBiometricDeps,
): Promise<boolean> {
  try {
    await deps.verifyIdentity(reason);
    return true;
  } catch {
    return false;
  }
}
