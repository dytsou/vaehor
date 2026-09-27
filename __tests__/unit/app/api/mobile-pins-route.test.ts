import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  mockSAdd,
  mockSRem,
  mockSMembers,
  mockGetFileDetails,
  mockRevalidateTag,
} = vi.hoisted(() => ({
  mockSAdd: vi.fn(),
  mockSRem: vi.fn(),
  mockSMembers: vi.fn(),
  mockGetFileDetails: vi.fn(),
  mockRevalidateTag: vi.fn(),
}));

vi.mock("@/lib/api-middleware", () => {
  const wrap =
    (
      handler: (context: {
        request: NextRequest;
        body?: unknown;
        session?: unknown;
      }) => Promise<Response>,
      options?: {
        bodySchema?: {
          safeParse(value: unknown): {
            success: boolean;
            data?: unknown;
            error?: { issues: unknown[] };
          };
        };
      },
    ) =>
    async (request: NextRequest) => {
      let body: unknown;
      if (options?.bodySchema) {
        const parsed = options.bodySchema.safeParse(await request.json());
        if (!parsed.success)
          return Response.json(
            {
              error: "Input tidak valid.",
              details: parsed.error?.issues ?? [],
            },
            { status: 400 },
          );
        body = parsed.data;
      }
      return handler({
        request,
        body,
        session: { user: { email: "user@example.com", role: "USER" } },
      });
    };
  return { createAdminRoute: wrap, createUserRoute: wrap };
});

vi.mock("@/lib/drive", () => ({ getFileDetailsFromDrive: mockGetFileDetails }));
vi.mock("@/lib/kv", () => ({
  kv: { sadd: mockSAdd, srem: mockSRem, smembers: mockSMembers },
}));
vi.mock("next/cache", () => ({ revalidateTag: mockRevalidateTag }));

import { DELETE, GET, POST } from "@/app/api/mobile/pins/route";

const createRequest = (
  method: "POST" | "DELETE",
  body: Record<string, unknown>,
) =>
  new NextRequest("http://localhost:3000/api/mobile/pins", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("app/api/mobile/pins route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists only existing, non-trashed folders and removes stale pins", async () => {
    mockSMembers.mockResolvedValue(["folder-1", "stale", "file-1", "trash"]);
    mockGetFileDetails.mockImplementation(async (id: string) => {
      if (id === "stale") return null;
      if (id === "file-1") return { id, name: "A file", isFolder: false };
      if (id === "trash")
        return { id, name: "Old folder", isFolder: true, trashed: true };
      return {
        id,
        name: "Folder",
        isFolder: true,
        mimeType: "application/vnd.google-apps.folder",
        parents: ["root"],
      };
    });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/mobile/pins"),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      folders: [
        {
          id: "folder-1",
          name: "Folder",
          mimeType: "application/vnd.google-apps.folder",
          parents: ["root"],
        },
      ],
    });
    expect(mockSRem).toHaveBeenCalledTimes(3);
    expect(mockSRem).toHaveBeenCalledWith("vaehor:pinned-folders", "stale");
    expect(mockSRem).toHaveBeenCalledWith("vaehor:pinned-folders", "file-1");
    expect(mockSRem).toHaveBeenCalledWith("vaehor:pinned-folders", "trash");
  });

  it("limits concurrent drive lookups", async () => {
    const ids = Array.from({ length: 24 }, (_, index) => `folder-${index}`);
    let activeLookups = 0;
    let peakLookups = 0;
    mockSMembers.mockResolvedValue(ids);
    mockGetFileDetails.mockImplementation(async (id: string) => {
      activeLookups += 1;
      peakLookups = Math.max(peakLookups, activeLookups);
      await new Promise((resolve) => setTimeout(resolve, 0));
      activeLookups -= 1;
      return { id, name: id, isFolder: true };
    });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/mobile/pins"),
    );

    expect(response.status).toBe(200);
    expect(peakLookups).toBe(8);
    expect(mockGetFileDetails).toHaveBeenCalledTimes(ids.length);
  });

  it("adds and removes pins with administrator API mutations", async () => {
    mockSAdd.mockResolvedValue(1);
    mockSRem.mockResolvedValue(1);
    const add = await POST(createRequest("POST", { folderId: "folder-1" }));
    const remove = await DELETE(
      createRequest("DELETE", { folderId: "folder-1" }),
    );

    expect(mockSAdd).toHaveBeenCalledWith("vaehor:pinned-folders", "folder-1");
    expect(mockSRem).toHaveBeenCalledWith("vaehor:pinned-folders", "folder-1");
    expect(mockRevalidateTag).toHaveBeenCalledWith("pinned", "max");
    await expect(add.json()).resolves.toEqual({
      success: true,
      isPinned: true,
    });
    await expect(remove.json()).resolves.toEqual({
      success: true,
      isPinned: false,
    });
  });
});
