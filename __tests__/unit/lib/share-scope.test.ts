import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    shareLink: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/kv", () => ({
  kv: {
    get: vi.fn(),
  },
}));

vi.mock("@/lib/drive", () => ({
  getFileDetailsFromDrive: vi.fn(),
}));

vi.mock("jose", () => ({
  jwtVerify: vi.fn(),
}));

import {
  parseShareLinkPath,
  shouldBlockDueToPreventDownload,
} from "@/lib/share-scope";

describe("lib/share-scope", () => {
  describe("parseShareLinkPath", () => {
    it("parses folder shares", () => {
      expect(parseShareLinkPath("/folder/abc123")).toEqual({
        kind: "folder",
        folderId: "abc123",
      });
    });

    it("parses file shares", () => {
      expect(
        parseShareLinkPath("/folder/parentId/file/fileId/my-slug"),
      ).toEqual({
        kind: "file",
        folderId: "parentId",
        fileId: "fileId",
      });
    });

    it("parses collection paths", () => {
      expect(parseShareLinkPath("/share/jti-here")).toEqual({
        kind: "collection",
        shareId: "jti-here",
      });
    });

    it("returns null for unknown paths", () => {
      expect(parseShareLinkPath("/other")).toBeNull();
    });
  });

  describe("shouldBlockDueToPreventDownload", () => {
    it("allows ranged requests", () => {
      const req = new NextRequest("http://localhost/api/download?fileId=x", {
        headers: { range: "bytes=0-1" },
      });
      expect(shouldBlockDueToPreventDownload(req)).toBe(false);
    });

    it("blocks document navigation without range", () => {
      const req = new NextRequest("http://localhost/api/download?fileId=x", {
        headers: { "sec-fetch-dest": "document" },
      });
      expect(shouldBlockDueToPreventDownload(req)).toBe(true);
    });

    it("allows video element loads", () => {
      const req = new NextRequest("http://localhost/api/download?fileId=x", {
        headers: { "sec-fetch-dest": "video" },
      });
      expect(shouldBlockDueToPreventDownload(req)).toBe(false);
    });
  });
});
