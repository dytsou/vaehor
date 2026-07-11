import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGet = vi.fn();
const mockSet = vi.fn();
const mockSadd = vi.fn();
const mockSrem = vi.fn();

vi.mock("@/lib/kv", () => ({
  kv: {
    get: (...args: unknown[]) => mockGet(...args),
    set: (...args: unknown[]) => mockSet(...args),
    sadd: (...args: unknown[]) => mockSadd(...args),
    srem: (...args: unknown[]) => mockSrem(...args),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/ratelimit", () => ({
  authLimiter: { check: vi.fn() },
}));

import { syncAdminsFromEnv } from "@/lib/services/credential-auth";
import { REDIS_KEYS } from "@/lib/constants";

describe("syncAdminsFromEnv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_EMAILS = "a@example.com, b@example.com";
  });

  it("first sync adds env admins and stores snapshot", async () => {
    mockGet.mockResolvedValue(null);
    mockSadd.mockResolvedValue(2);
    mockSet.mockResolvedValue("OK");

    const result = await syncAdminsFromEnv();

    expect(result.added).toEqual(["a@example.com", "b@example.com"]);
    expect(result.removed).toEqual([]);
    expect(mockSadd).toHaveBeenCalledWith(
      REDIS_KEYS.ADMIN_USERS,
      "a@example.com",
      "b@example.com",
    );
    expect(mockSrem).not.toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledWith(
      REDIS_KEYS.ADMIN_USERS_ENV_SYNC,
      JSON.stringify(["a@example.com", "b@example.com"]),
    );
  });

  it("env change adds new and removes dropped emails", async () => {
    mockGet.mockResolvedValue(
      JSON.stringify(["a@example.com", "b@example.com"]),
    );
    process.env.ADMIN_EMAILS = "b@example.com, c@example.com";
    mockSadd.mockResolvedValue(1);
    mockSrem.mockResolvedValue(1);
    mockSet.mockResolvedValue("OK");

    const result = await syncAdminsFromEnv();

    expect(result.added).toEqual(["c@example.com"]);
    expect(result.removed).toEqual(["a@example.com"]);
    expect(mockSadd).toHaveBeenCalledWith(
      REDIS_KEYS.ADMIN_USERS,
      "c@example.com",
    );
    expect(mockSrem).toHaveBeenCalledWith(
      REDIS_KEYS.ADMIN_USERS,
      "a@example.com",
    );
  });

  it("no-ops when snapshot already matches env", async () => {
    mockGet.mockResolvedValue(
      JSON.stringify(["a@example.com", "b@example.com"]),
    );

    const result = await syncAdminsFromEnv();

    expect(result).toEqual({ added: [], removed: [] });
    expect(mockSadd).not.toHaveBeenCalled();
    expect(mockSrem).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });
});
