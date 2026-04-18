import { describe, it, expect } from "vitest";
import {
  parseShareLinkPath,
  shouldBlockDueToPreventDownload,
} from "@/lib/share-scope";
import { NextRequest } from "next/server";

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
