import { describe, expect, it, vi } from "vitest";
import {
  buildBulkDownloadRequest,
  downloadMobileArchive,
  MobileApiError,
  buildSameOriginUrl,
  deleteMobileFiles,
  getMobileFavoriteIds,
  listMobileDrives,
  listMobileFavorites,
  listMobilePinnedFolders,
  listMobileTags,
  addMobileTag,
  removeMobileTag,
  setMobileFolderPinned,
  moveMobileFiles,
  sanitizeFileName,
} from "../src/lib/file-api";

describe("native file API", () => {
  it("creates a bounded ZIP download request for selected file IDs", () => {
    const request = buildBulkDownloadRequest(["file-1", "file-2"]);
    expect(request).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileIds: ["file-1", "file-2"] }),
    });
    expect(() => buildBulkDownloadRequest([])).toThrow("1 and 20 files");
    expect(() =>
      buildBulkDownloadRequest(
        Array.from({ length: 21 }, (_, i) => `file-${i}`),
      ),
    ).toThrow("1 and 20 files");
  });

  it("preserves server restrictions when requesting a bulk archive", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "Download is restricted." }), {
          status: 403,
        }),
    );

    await expect(
      downloadMobileArchive(fetchImpl, ["file-1"]),
    ).rejects.toMatchObject<Partial<MobileApiError>>({
      status: 403,
      message: "Download is restricted.",
    });
    expect(fetchImpl).toHaveBeenCalledWith("/api/bulk-download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileIds: ["file-1"] }),
    });
  });

  it("builds generated API paths on the configured server only", () => {
    expect(
      buildSameOriginUrl(
        "https://files.example.com",
        "/api/files?folderId=a%2Fb",
      ),
    ).toBe("https://files.example.com/api/files?folderId=a%2Fb");
    expect(() =>
      buildSameOriginUrl(
        "https://files.example.com",
        "https://evil.example/file",
      ),
    ).toThrow("cross_origin_request_blocked");
  });

  it("rejects insecure non-loopback server origins", () => {
    expect(() =>
      buildSameOriginUrl("http://files.example.com", "/api/files"),
    ).toThrow();
  });

  it("uses the generated mobile drives route and returns its response", async () => {
    const payload = {
      rootFolderId: "root-1",
      drives: [{ id: "root-1", name: "Home", isProtected: false }],
    };
    const fetchImpl = vi.fn(async (path: string) =>
      path === "/api/mobile/drives"
        ? new Response(JSON.stringify(payload), { status: 200 })
        : new Response("missing", { status: 404 }),
    );

    await expect(listMobileDrives(fetchImpl)).resolves.toEqual(payload);
    expect(fetchImpl).toHaveBeenCalledWith("/api/mobile/drives", {
      signal: undefined,
    });
  });

  it("loads favorite IDs separately and pages favorite file details", async () => {
    const favoriteIds = { favoriteIds: ["file-1", "file-2"] };
    const firstPage = { files: [{ id: "file-1" }], nextPageToken: "file-1" };
    const fetchImpl = vi.fn(async (path: string) =>
      path.includes("idsOnly=true")
        ? new Response(JSON.stringify(favoriteIds), { status: 200 })
        : new Response(JSON.stringify(firstPage), { status: 200 }),
    );

    await expect(getMobileFavoriteIds(fetchImpl)).resolves.toEqual(favoriteIds);
    await expect(listMobileFavorites(fetchImpl, "file-0")).resolves.toEqual(
      firstPage,
    );
    expect(fetchImpl.mock.calls.map(([path]) => path)).toEqual([
      "/api/mobile/favorites?idsOnly=true",
      "/api/mobile/favorites?pageToken=file-0",
    ]);
  });

  it("loads pinned folders and applies administrator pin mutations", async () => {
    const response = { folders: [{ id: "folder-1", name: "Invoices" }] };
    const fetchImpl = vi.fn<
      (path: string, init?: RequestInit) => Promise<Response>
    >(async () => new Response(JSON.stringify(response), { status: 200 }));

    await expect(listMobilePinnedFolders(fetchImpl)).resolves.toEqual(response);
    await setMobileFolderPinned(fetchImpl, "folder-1", true);
    await setMobileFolderPinned(fetchImpl, "folder-1", false);

    expect(
      fetchImpl.mock.calls.map(([path, init]) => [path, init?.method]),
    ).toEqual([
      ["/api/mobile/pins", undefined],
      ["/api/mobile/pins", "POST"],
      ["/api/mobile/pins", "DELETE"],
    ]);
    expect(JSON.parse(fetchImpl.mock.calls[1]?.[1]?.body as string)).toEqual({
      folderId: "folder-1",
    });
  });

  it("loads tags and applies administrator tag mutations", async () => {
    const response = { tags: ["finance"] };
    const fetchImpl = vi.fn<
      (path: string, init?: RequestInit) => Promise<Response>
    >(async () => new Response(JSON.stringify(response), { status: 200 }));

    await expect(listMobileTags(fetchImpl, "file/1")).resolves.toEqual(
      response,
    );
    await addMobileTag(fetchImpl, "file/1", "finance");
    await removeMobileTag(fetchImpl, "file/1", "finance");

    expect(
      fetchImpl.mock.calls.map(([path, init]) => [path, init?.method]),
    ).toEqual([
      ["/api/mobile/tags?fileId=file%2F1", undefined],
      ["/api/mobile/tags", "POST"],
      ["/api/mobile/tags", "DELETE"],
    ]);
    expect(JSON.parse(fetchImpl.mock.calls[1]?.[1]?.body as string)).toEqual({
      fileId: "file/1",
      tag: "finance",
    });
  });

  it("uses the permission-checked bulk move and delete routes", async () => {
    const fetchImpl = vi.fn<
      (path: string, init?: RequestInit) => Promise<Response>
    >(
      async () =>
        new Response(JSON.stringify({ success: true }), { status: 200 }),
    );

    await moveMobileFiles(fetchImpl, {
      fileIds: ["file-1", "file-2"],
      currentParentId: "folder-1",
      newParentId: "folder-2",
    });
    await deleteMobileFiles(fetchImpl, {
      fileIds: ["file-1", "file-2"],
      parentId: "folder-1",
    });

    expect(fetchImpl.mock.calls.map(([path]) => path)).toEqual([
      "/api/files/bulk-move",
      "/api/files/bulk-delete",
    ]);
    expect(JSON.parse(fetchImpl.mock.calls[0]?.[1]?.body as string)).toEqual({
      fileIds: ["file-1", "file-2"],
      currentParentId: "folder-1",
      newParentId: "folder-2",
    });
  });

  it("maps a forbidden response to a safe actionable error", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("internal detail", { status: 403 }),
    );

    await expect(listMobileDrives(fetchImpl)).rejects.toMatchObject<
      Partial<MobileApiError>
    >({
      status: 403,
      message: "This server did not allow the requested file operation.",
    });
  });

  it("sanitizes path separators and control characters in downloaded names", () => {
    expect(sanitizeFileName("../a\\b\n.txt")).toBe(".._a_b_.txt");
    expect(sanitizeFileName("..")).toBe("download");
  });
});
