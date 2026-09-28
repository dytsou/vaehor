import { describe, expect, it, vi } from "vitest";
import { findProtectedFolderAncestorId } from "./protected-folder-ancestor";

describe("findProtectedFolderAncestorId", () => {
  it("walks nested parents to find the protected ancestor", async () => {
    const getFolderDetails = vi.fn(async (folderId: string) => {
      if (folderId === "child-folder")
        return { id: folderId, parents: ["protected-root"] };
      return null;
    });

    await expect(
      findProtectedFolderAncestorId(
        { id: "favorite-file", parents: ["child-folder"] },
        new Set(["protected-root"]),
        () => false,
        getFolderDetails,
      ),
    ).resolves.toBe("protected-root");
    expect(getFolderDetails).toHaveBeenCalledExactlyOnceWith("child-folder");
  });

  it("resolves private ancestors and stops before fetching their details", async () => {
    const getFolderDetails = vi.fn();

    await expect(
      findProtectedFolderAncestorId(
        { id: "favorite-file", parents: ["private-root"] },
        new Set(),
        (folderId) => folderId === "private-root",
        getFolderDetails,
      ),
    ).resolves.toBe("private-root");
    expect(getFolderDetails).not.toHaveBeenCalled();
  });

  it("returns no ancestor when the parent chain ends or exceeds its bound", async () => {
    const getFolderDetails = vi.fn(async (folderId: string) => ({
      id: folderId,
      parents: [`parent-${folderId}`],
    }));

    await expect(
      findProtectedFolderAncestorId(
        { id: "orphan", parents: ["missing"] },
        new Set(),
        () => false,
        async () => null,
      ),
    ).resolves.toBeUndefined();
    await expect(
      findProtectedFolderAncestorId(
        { id: "child", parents: ["parent"] },
        new Set(),
        () => false,
        getFolderDetails,
        2,
      ),
    ).resolves.toBeUndefined();
    expect(getFolderDetails).toHaveBeenCalledTimes(2);
  });
});
