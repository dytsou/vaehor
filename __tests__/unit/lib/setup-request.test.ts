import { afterEach, describe, expect, it, vi } from "vitest";
import { isAllowedSetupRequestOrigin } from "@/lib/setup-request";

describe("isAllowedSetupRequestOrigin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows native setup only after verified setup secret authentication", () => {
    vi.stubEnv("SETUP_SECRET", "test-setup-secret");
    const request = new Request("https://vaehor.example/api/setup/finish", {
      method: "POST",
      headers: { "x-setup-secret": "test-setup-secret" },
    });

    expect(isAllowedSetupRequestOrigin(request)).toBe(false);
    expect(
      isAllowedSetupRequestOrigin(request, { setupSecretVerified: true }),
    ).toBe(true);
  });

  it("does not allow originless setup without a configured secret and header", () => {
    vi.stubEnv("SETUP_SECRET", "");
    const request = new Request("https://vaehor.example/api/setup/finish", {
      method: "POST",
      headers: { "x-setup-secret": "some-value" },
    });

    expect(
      isAllowedSetupRequestOrigin(request, { setupSecretVerified: true }),
    ).toBe(false);
  });
});
