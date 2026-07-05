import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockAuth,
  mockCheckRateLimit,
  mockJwtVerify,
  mockAuthenticateShareRequest,
  mockShareGrantsAccessToFile,
  mockShouldBlockDueToPreventDownload,
  mockIsAccessRestricted,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockJwtVerify: vi.fn(),
  mockAuthenticateShareRequest: vi.fn(),
  mockShareGrantsAccessToFile: vi.fn(),
  mockShouldBlockDueToPreventDownload: vi.fn(),
  mockIsAccessRestricted: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: mockAuth,
}));

vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mockCheckRateLimit,
}));

vi.mock("jose", () => ({
  jwtVerify: mockJwtVerify,
}));

vi.mock("@/lib/share-scope", () => ({
  authenticateShareRequest: mockAuthenticateShareRequest,
  shareGrantsAccessToFile: mockShareGrantsAccessToFile,
  shouldBlockDueToPreventDownload: mockShouldBlockDueToPreventDownload,
}));

vi.mock("@/lib/securityUtils", () => ({
  isAccessRestricted: mockIsAccessRestricted,
}));

import {
  validateDownloadRequest,
  prepareGoogleDriveUrl,
  prepareResponseHeaders,
} from "@/lib/services/download";
import { ERROR_MESSAGES } from "@/lib/constants";

/** RFC 5737 TEST-NET-3 address for rate-limit client fixtures. */
const TEST_CLIENT_IP = "203.0.113.5";

describe("lib/services/download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SHARE_SECRET_KEY =
      "test-share-secret-key-with-at-least-32-chars";
    process.env.NEXTAUTH_URL = "http://localhost:3000";
    mockAuth.mockResolvedValue(null);
    mockCheckRateLimit.mockResolvedValue({ success: true });
    mockAuthenticateShareRequest.mockResolvedValue(null);
    mockShareGrantsAccessToFile.mockResolvedValue(true);
    mockShouldBlockDueToPreventDownload.mockReturnValue(false);
    mockIsAccessRestricted.mockResolvedValue(false);
  });

  describe("validateDownloadRequest", () => {
    it("returns 429 when the download rate limit is exceeded", async () => {
      mockCheckRateLimit.mockResolvedValueOnce({ success: false });
      const request = new NextRequest(
        "http://localhost:3000/api/download?fileId=file-1",
      );

      const result = await validateDownloadRequest(request);

      expect(result.error).toEqual({
        error: ERROR_MESSAGES.DOWNLOAD_LIMIT_EXCEEDED,
        status: 429,
      });
    });

    it("applies rate limiting to ranged requests too", async () => {
      const request = new NextRequest(
        "http://localhost:3000/api/download?fileId=file-1",
        {
          headers: {
            range: "bytes=0-1023",
            "x-forwarded-for": TEST_CLIENT_IP,
          },
        },
      );

      await validateDownloadRequest(request);

      expect(mockCheckRateLimit).toHaveBeenCalledWith(
        request,
        "API",
        `${TEST_CLIENT_IP}:file-1`,
      );
    });

    it("returns 400 when the fileId is missing", async () => {
      const request = new NextRequest("http://localhost:3000/api/download");

      const result = await validateDownloadRequest(request);

      expect(result.error).toEqual({
        error: ERROR_MESSAGES.MISSING_FILE_ID,
        status: 400,
      });
    });

    it("returns 400 when the fileId format is invalid", async () => {
      const request = new NextRequest(
        "http://localhost:3000/api/download?fileId=invalid^file!",
      );

      const result = await validateDownloadRequest(request);

      expect(result.error).toEqual({
        error: ERROR_MESSAGES.INVALID_FILE_ID,
        status: 400,
      });
    });

    it("rejects revoked share tokens", async () => {
      mockAuthenticateShareRequest.mockResolvedValueOnce({
        error: ERROR_MESSAGES.SHARE_LINK_REVOKED,
        status: 401,
      });

      const request = new NextRequest(
        "http://localhost:3000/api/download?fileId=file-1&share_token=token",
      );

      const result = await validateDownloadRequest(request);

      expect(result.error).toEqual({
        error: ERROR_MESSAGES.SHARE_LINK_REVOKED,
        status: 401,
      });
    });

    it("rejects restricted downloads without a folder token", async () => {
      mockIsAccessRestricted.mockResolvedValueOnce(true);

      const request = new NextRequest(
        "http://localhost:3000/api/download?fileId=file-1",
      );

      const result = await validateDownloadRequest(request);

      expect(result.error).toEqual({
        error: ERROR_MESSAGES.ACCESS_DENIED,
        status: 403,
      });
    });

    it("allows restricted downloads when a valid folder token is supplied", async () => {
      mockIsAccessRestricted
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      mockJwtVerify.mockResolvedValueOnce({
        payload: { folderId: "folder-1" },
      });

      const request = new NextRequest(
        "http://localhost:3000/api/download?fileId=file-1&access_token=token",
      );

      const result = await validateDownloadRequest(request);

      expect(result.error).toBeUndefined();
      expect(result.context.fileId).toBe("file-1");
      expect(result.context.accessTokenParam).toBe("token");
    });
  });

  describe("prepareGoogleDriveUrl", () => {
    it("uses media download for regular files", () => {
      const result = prepareGoogleDriveUrl("file-1", {
        mimeType: "video/mp4",
        name: "movie.mp4",
      });

      expect(result.url).toContain("/files/file-1?alt=media");
      expect(result.filename).toBe("movie.mp4");
      expect(result.mimeType).toBe("video/mp4");
    });

    it("exports Google docs to a download-friendly type", () => {
      const result = prepareGoogleDriveUrl("file-1", {
        mimeType: "application/vnd.google-apps.document",
        name: "Doc",
      });

      expect(result.url).toContain("/files/file-1/export");
      expect(result.filename).toMatch(/\.docx$/);
      expect(result.mimeType).toBe(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
    });
  });

  describe("prepareResponseHeaders", () => {
    const originalNextAuthUrl = process.env.NEXTAUTH_URL;

    beforeEach(() => {
      process.env.NEXTAUTH_URL = "https://files.example.com";
    });

    afterEach(() => {
      process.env.NEXTAUTH_URL = originalNextAuthUrl;
    });

    it("sets inline streaming headers for ranged media", () => {
      const upstreamResponse = new Response(null, {
        headers: {
          "Content-Range": "bytes 0-1023/4096",
          "Content-Length": "1024",
        },
      });

      const headers = prepareResponseHeaders(
        "video/mp4",
        "movie.mp4",
        "bytes=0-1023",
        "video",
        upstreamResponse,
      );

      expect(headers.get("Content-Type")).toBe("video/mp4");
      expect(headers.get("Content-Disposition")).toContain("inline");
      expect(headers.get("Content-Range")).toBe("bytes 0-1023/4096");
      expect(headers.get("Accept-Ranges")).toBe("bytes");
    });

    it("echoes allowed mobile Origin in CORS headers", () => {
      const headers = prepareResponseHeaders(
        "video/mp4",
        "movie.mp4",
        "bytes=0-1023",
        "video",
        new Response(null, {
          headers: { "Content-Range": "bytes 0-1023/4096" },
        }),
        false,
        "capacitor://localhost",
      );

      expect(headers.get("Access-Control-Allow-Origin")).toBe(
        "capacitor://localhost",
      );
    });

    it("omits permissive CORS for disallowed origins", () => {
      const headers = prepareResponseHeaders(
        "video/mp4",
        "movie.mp4",
        null,
        null,
        null,
        false,
        "https://evil.example",
      );

      expect(headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("keeps NEXTAUTH_URL fallback when Origin is absent", () => {
      const headers = prepareResponseHeaders(
        "video/mp4",
        "movie.mp4",
        null,
        null,
        null,
      );

      expect(headers.get("Access-Control-Allow-Origin")).toBe(
        "https://files.example.com",
      );
    });
  });
});
