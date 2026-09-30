import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  databaseUser: null as null | { role: string },
  envAdmins: [] as string[],
  redisAdmin: 0,
  redisEditor: 0,
  events: [] as string[],
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  sismember: vi.fn(),
  srem: vi.fn(),
  syncAdminsFromEnv: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
    },
  },
}));

vi.mock("@/lib/kv", () => ({
  kv: {
    sismember: mocks.sismember,
    srem: mocks.srem,
  },
}));

vi.mock("@/lib/services/credential-auth", () => ({
  normalizeAdminEmails: () => mocks.envAdmins,
  syncAdminsFromEnv: mocks.syncAdminsFromEnv,
}));

import { REDIS_KEYS } from "@/lib/constants";
import { resolveRole, revokeEditorAccess } from "@/lib/services/auth-jwt";

describe("editor role revocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.databaseUser = { role: "USER" };
    mocks.envAdmins = [];
    mocks.redisAdmin = 0;
    mocks.redisEditor = 0;
    mocks.events.length = 0;
    mocks.findUnique.mockImplementation(async () => mocks.databaseUser);
    mocks.updateMany.mockImplementation(async () => {
      mocks.events.push("database");
      return { count: 1 };
    });
    mocks.sismember.mockImplementation(async (key: string) =>
      key === REDIS_KEYS.ADMIN_USERS ? mocks.redisAdmin : mocks.redisEditor,
    );
    mocks.srem.mockImplementation(async (key: string, email: string) => {
      mocks.events.push("redis");
      if (key === REDIS_KEYS.ADMIN_EDITORS && email === "editor@example.com") {
        mocks.redisEditor = 0;
      }
      return 1;
    });
  });

  it("removes the database grant before Redis and immediately resolves USER", async () => {
    mocks.databaseUser = { role: "EDITOR" };
    mocks.redisEditor = 1;
    mocks.updateMany.mockImplementation(async () => {
      mocks.events.push("database");
      mocks.databaseUser = { role: "USER" };
      return { count: 1 };
    });

    await expect(revokeEditorAccess(" EDITOR@Example.com ")).resolves.toBe(
      "editor@example.com",
    );

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { email: "editor@example.com", role: "EDITOR" },
      data: { role: "USER" },
    });
    expect(mocks.srem).toHaveBeenCalledWith(
      REDIS_KEYS.ADMIN_EDITORS,
      "editor@example.com",
    );
    expect(mocks.events).toEqual(["database", "redis"]);
    await expect(resolveRole("EDITOR@example.com")).resolves.toBe("USER");
  });

  it.each([
    ["database editor", { role: "EDITOR" }, 0, 0, [], "EDITOR"],
    ["Redis editor", { role: "USER" }, 0, 1, [], "EDITOR"],
    ["database admin", { role: "ADMIN" }, 0, 1, [], "ADMIN"],
    ["Redis admin", { role: "EDITOR" }, 1, 1, [], "ADMIN"],
    [
      "environment admin",
      { role: "EDITOR" },
      0,
      1,
      ["editor@example.com"],
      "ADMIN",
    ],
    ["ordinary user", { role: "USER" }, 0, 0, [], "USER"],
  ] as const)(
    "preserves role precedence for %s",
    async (_label, user, redisAdmin, redisEditor, envAdmins, expected) => {
      mocks.databaseUser = user;
      mocks.redisAdmin = redisAdmin;
      mocks.redisEditor = redisEditor;
      mocks.envAdmins = [...envAdmins];

      await expect(resolveRole("EDITOR@example.com")).resolves.toBe(expected);
      expect(mocks.findUnique).toHaveBeenCalledWith({
        where: { email: "editor@example.com" },
      });
    },
  );

  it("does not remove the Redis editor grant when the database write fails", async () => {
    mocks.databaseUser = { role: "EDITOR" };
    mocks.redisEditor = 1;
    mocks.updateMany.mockRejectedValue(new Error("database unavailable"));

    await expect(revokeEditorAccess("editor@example.com")).rejects.toThrow(
      "database unavailable",
    );
    expect(mocks.srem).not.toHaveBeenCalled();
  });

  it("reports Redis failure after demoting the database grant so the action can be retried", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.srem.mockRejectedValue(new Error("Redis unavailable"));

    await expect(revokeEditorAccess("editor@example.com")).rejects.toThrow(
      "Redis unavailable",
    );
    expect(mocks.updateMany).toHaveBeenCalledOnce();
    expect(mocks.srem).toHaveBeenCalledOnce();
  });
});
