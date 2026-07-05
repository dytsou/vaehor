import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  applyDownloadCorsHeaders,
  isAllowedMobileOrigin,
  resolveDownloadCorsOrigin,
} from "@/lib/mobile-origins";

describe("lib/mobile-origins", () => {
  const originalNextAuthUrl = process.env.NEXTAUTH_URL;

  beforeEach(() => {
    process.env.NEXTAUTH_URL = "https://files.example.com";
  });

  afterEach(() => {
    process.env.NEXTAUTH_URL = originalNextAuthUrl;
  });

  it("allows Capacitor and dev origins", () => {
    expect(isAllowedMobileOrigin("capacitor://localhost")).toBe(true);
    expect(isAllowedMobileOrigin("http://localhost:5173")).toBe(true);
    expect(isAllowedMobileOrigin("https://files.example.com")).toBe(true);
  });

  it("rejects unknown origins", () => {
    expect(isAllowedMobileOrigin("https://evil.example")).toBe(false);
    expect(resolveDownloadCorsOrigin("https://evil.example")).toBeNull();
  });

  it("echoes allowed mobile Origin for download CORS", () => {
    const headers = new Headers();
    applyDownloadCorsHeaders(headers, "capacitor://localhost");

    expect(headers.get("Access-Control-Allow-Origin")).toBe(
      "capacitor://localhost",
    );
    expect(headers.get("Access-Control-Expose-Headers")).toContain(
      "Content-Range",
    );
  });

  it("omits permissive CORS for disallowed origins", () => {
    const headers = new Headers();
    applyDownloadCorsHeaders(headers, "https://evil.example");

    expect(headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(headers.get("Access-Control-Expose-Headers")).toContain(
      "Accept-Ranges",
    );
  });

  it("falls back to NEXTAUTH_URL when Origin is absent", () => {
    const headers = new Headers();
    applyDownloadCorsHeaders(headers, null);

    expect(headers.get("Access-Control-Allow-Origin")).toBe(
      "https://files.example.com",
    );
  });
});
