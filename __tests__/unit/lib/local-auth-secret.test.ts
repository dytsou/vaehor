import { describe, it, expect, afterEach } from "vitest";
import { getLocalStorageAuthSecret } from "@/lib/local-auth-secret";

const ORIGINAL_SECRET = process.env.BETTER_AUTH_SECRET;

describe("lib/local-auth-secret", () => {
  afterEach(() => {
    process.env.BETTER_AUTH_SECRET = ORIGINAL_SECRET;
  });

  it("returns null when BETTER_AUTH_SECRET is missing", () => {
    delete process.env.BETTER_AUTH_SECRET;
    expect(getLocalStorageAuthSecret()).toBeNull();
  });

  it("returns null when BETTER_AUTH_SECRET is too short", () => {
    process.env.BETTER_AUTH_SECRET = "short-secret";
    expect(getLocalStorageAuthSecret()).toBeNull();
  });

  it("returns encoded secret when BETTER_AUTH_SECRET is valid", () => {
    process.env.BETTER_AUTH_SECRET = "a".repeat(32);
    const secret = getLocalStorageAuthSecret();
    expect(secret).not.toBeNull();
    expect(ArrayBuffer.isView(secret)).toBe(true);
    expect(secret?.length).toBe(32);
  });
});
