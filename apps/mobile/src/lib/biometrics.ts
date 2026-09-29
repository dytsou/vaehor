import * as LocalAuthentication from "expo-local-authentication";

export type BiometricDeps = {
  isAvailable: () => Promise<{ isAvailable: boolean }>;
  verifyIdentity: (reason: string) => Promise<void>;
};

export const defaultBiometricDeps: BiometricDeps = {
  async isAvailable() {
    const [hasHardware, isEnrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return { isAvailable: hasHardware && isEnrolled };
  },
  async verifyIdentity(reason) {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      cancelLabel: "Cancel",
      disableDeviceFallback: true,
    });
    if (!result.success) throw new Error("biometric_authentication_failed");
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
