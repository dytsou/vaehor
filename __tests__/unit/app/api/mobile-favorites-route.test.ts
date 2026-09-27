import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  mockFindProtectedFolders,
  mockGetFileDetails,
  mockIsPrivateFolder,
  mockSMembers,
  mockSRem,
} = vi.hoisted(() => ({
  mockFindProtectedFolders: vi.fn(),
  mockGetFileDetails: vi.fn(),
  mockIsPrivateFolder: vi.fn(),
  mockSMembers: vi.fn(),
  mockSRem: vi.fn(),
}));

vi.mock("@/lib/api-middleware", () => {
  const wrap =
    (
      handler: (context: {
        request: NextRequest;
        body?: unknown;
        session?: unknown;
      }) => Promise<Response>,
    ) =>
    async (request: NextRequest) =>
      handler({
        request,
        session: { user: { email: "user@example.com", role: "USER" } },
      });

  return { createUserRoute: wrap };
});

vi.mock("@/lib/db", () => ({
  db: { protectedFolder: { findMany: mockFindProtectedFolders } },
}));
vi.mock("@/lib/drive", () => ({ getFileDetailsFromDrive: mockGetFileDetails }));
vi.mock("@/lib/kv", () => ({
  kv: { smembers: mockSMembers, srem: mockSRem },
}));
vi.mock("@/lib/auth", () => ({ isPrivateFolder: mockIsPrivateFolder }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

import { GET } from "@/app/api/mobile/favorites/route";

describe("app/api/mobile/favorites route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindProtectedFolders.mockResolvedValue([]);
    mockIsPrivateFolder.mockReturnValue(false);
  });

  it("uses the same locale-aware order for favorite pages and cursors", async () => {
    const favoriteIds = [
      ...Array.from(
        { length: 35 },
        (_, index) => `A${index.toString().padStart(2, "0")}`,
      ),
      ...Array.from(
        { length: 35 },
        (_, index) => `a${index.toString().padStart(2, "0")}`,
      ),
    ].reverse();
    const expectedIds = [...favoriteIds].sort((left, right) =>
      left.localeCompare(right, "en-US", { sensitivity: "variant" }),
    );
    mockSMembers.mockResolvedValue(favoriteIds);
    mockGetFileDetails.mockImplementation(async (id: string) => ({
      id,
      name: id,
      mimeType: "text/plain",
      trashed: false,
    }));

    const actualIds: string[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < Math.ceil(favoriteIds.length / 30); page += 1) {
      const url = new URL("http://localhost:3000/api/mobile/favorites");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const response = await GET(new NextRequest(url));
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        files: Array<{ id: string }>;
        nextPageToken?: string;
      };
      actualIds.push(...body.files.map(({ id }) => id));
      pageToken = body.nextPageToken;
    }

    expect(pageToken).toBeUndefined();
    expect(actualIds).toEqual(expectedIds);
    expect(new Set(actualIds).size).toBe(favoriteIds.length);
    expect(mockGetFileDetails).toHaveBeenCalledTimes(favoriteIds.length);
  });
});
