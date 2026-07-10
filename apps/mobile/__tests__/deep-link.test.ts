import { describe, expect, it } from "vitest";
import {
  appendBootstrapRedirect,
  buildShareCustomSchemeUrl,
  findBookmarkForOrigin,
  parseDeepLink,
  stripLocaleFromPathname,
} from "../src/lib/deep-link";

describe("deep-link", () => {
  it("strips locale prefixes from web paths", () => {
    expect(stripLocaleFromPathname("/en/share/abc")).toBe("/share/abc");
    expect(stripLocaleFromPathname("/zh-TW/folder/1")).toBe("/folder/1");
  });

  it("parses custom-scheme share links", () => {
    const result = parseDeepLink(
      "vaehor://share?origin=https://files.example.com&path=/en/share/abc123&share_token=token",
    );
    expect(result).toEqual({
      kind: "share",
      target: {
        origin: "https://files.example.com",
        path: "/en/share/abc123?share_token=token",
      },
    });
  });

  it("parses https operator share links", () => {
    const result = parseDeepLink(
      "https://files.example.com/en/share/abc123?share_token=token",
    );
    expect(result).toEqual({
      kind: "share",
      target: {
        origin: "https://files.example.com",
        path: "/en/share/abc123?share_token=token",
      },
    });
  });

  it("rejects malformed custom-scheme links", () => {
    expect(parseDeepLink("vaehor://share?origin=bogus")).toEqual({
      kind: "invalid",
      error: "malformed",
    });
  });

  it("ignores oauth callback URLs", () => {
    expect(parseDeepLink("vaehor://auth/callback?token=abc")).toEqual({
      kind: "ignored",
    });
  });

  it("finds a saved bookmark by origin", () => {
    const match = findBookmarkForOrigin("https://files.example.com", [
      {
        id: "1",
        url: "https://files.example.com",
        label: "Files",
        biometricsEnabled: false,
      },
    ]);
    expect(match?.id).toBe("1");
  });

  it("builds bootstrap redirect URLs", () => {
    expect(
      appendBootstrapRedirect(
        "/api/mobile/session-bootstrap?token=abc",
        "/en/share/id",
      ),
    ).toBe(
      "/api/mobile/session-bootstrap?token=abc&redirect=%2Fen%2Fshare%2Fid",
    );
  });

  it("round-trips custom scheme builder", () => {
    const target = {
      origin: "https://files.example.com",
      path: "/en/share/abc?share_token=token",
    };
    expect(parseDeepLink(buildShareCustomSchemeUrl(target))).toEqual({
      kind: "share",
      target,
    });
  });
});
