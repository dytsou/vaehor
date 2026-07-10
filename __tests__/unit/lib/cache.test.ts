import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/kv", () => ({
  kv: {
    scanKeys: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock("@/lib/memory-cache", () => ({
  memoryCache: {
    deleteByPrefix: vi.fn(),
    delete: vi.fn(),
  },
}));

import { kv } from "@/lib/kv";
import { memoryCache } from "@/lib/memory-cache";
import { invalidateFolderCache } from "@/lib/cache";

describe("lib/cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("invalidates matching redis and memory keys", async () => {
    vi.mocked(kv.scanKeys)
      .mockResolvedValueOnce(["k1", "k2"])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["k3"]);

    await invalidateFolderCache("folder-123");

    expect(kv.scanKeys).toHaveBeenNthCalledWith(
      1,
      "vaehor:folder-content-v3:folder-123:*",
    );
    expect(kv.scanKeys).toHaveBeenNthCalledWith(2, "vaehor:folder-path-v7:*");
    expect(kv.scanKeys).toHaveBeenNthCalledWith(3, "vaehor:folder-tree*");

    expect(kv.del).toHaveBeenCalledTimes(2);
    expect(kv.del).toHaveBeenNthCalledWith(1, "k1", "k2");
    expect(kv.del).toHaveBeenNthCalledWith(2, "k3");

    expect(memoryCache.deleteByPrefix).toHaveBeenCalledWith(
      "drive:folder:folder-123:",
    );
    expect(memoryCache.deleteByPrefix).toHaveBeenCalledWith(
      "folder-path:folder-123:",
    );
    expect(memoryCache.deleteByPrefix).toHaveBeenCalledWith(
      "auth:protected:folder-123",
    );
    expect(memoryCache.deleteByPrefix).toHaveBeenCalledWith(
      "auth:access:folder-123:",
    );
    expect(memoryCache.delete).toHaveBeenCalledWith(
      "auth:protected:folder-123",
    );
  });

  it("swallows errors and logs them", async () => {
    vi.mocked(kv.scanKeys).mockRejectedValueOnce(new Error("scan failed"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(invalidateFolderCache("folder-err")).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
