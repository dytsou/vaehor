import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
  revokeEditorAccess: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdminSession: mocks.requireAdminSession,
}));

vi.mock("@/lib/services/auth-jwt", () => ({
  revokeEditorAccess: mocks.revokeEditorAccess,
}));

vi.mock("next/cache", () => ({
  revalidateTag: mocks.revalidateTag,
  unstable_cache: (callback: (...args: unknown[]) => unknown) => callback,
}));

import { removeEditorEmailAction } from "@/app/actions/admin";

describe("removeEditorEmailAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminSession.mockResolvedValue({ user: { role: "ADMIN" } });
    mocks.revokeEditorAccess.mockResolvedValue("editor@example.com");
  });

  it("uses the shared revocation flow and reports the normalized email", async () => {
    await expect(
      removeEditorEmailAction(" EDITOR@Example.com "),
    ).resolves.toEqual({
      message: "Editor removed",
      email: "editor@example.com",
    });

    expect(mocks.requireAdminSession).toHaveBeenCalledOnce();
    expect(mocks.revokeEditorAccess).toHaveBeenCalledWith("editor@example.com");
    expect(mocks.revalidateTag).toHaveBeenCalledWith("admin-editors", "max");
  });

  it("does not report success or revalidate when revocation fails", async () => {
    mocks.revokeEditorAccess.mockRejectedValue(
      new Error("database unavailable"),
    );

    await expect(removeEditorEmailAction("editor@example.com")).rejects.toThrow(
      "database unavailable",
    );
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });
});
