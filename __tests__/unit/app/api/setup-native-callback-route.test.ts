import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/setup/native-callback/route";

describe("app/api/setup/native-callback route", () => {
  it("redirects a bounded authorization response to the fixed app scheme", () => {
    const request = new NextRequest(
      "https://files.example.com/api/setup/native-callback?code=oauth-code&state=state-123",
    );

    const response = GET(request);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "vaehor:///setup?serverOrigin=https%3A%2F%2Ffiles.example.com&state=state-123&code=oauth-code",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("rejects callbacks without state or an authorization result", () => {
    const request = new NextRequest(
      "https://files.example.com/api/setup/native-callback?code=oauth-code",
    );

    expect(GET(request).status).toBe(400);
  });

  it("rejects an oversized authorization code", () => {
    const code = "c".repeat(4097);
    const request = new NextRequest(
      `https://files.example.com/api/setup/native-callback?code=${code}&state=state-123`,
    );

    expect(GET(request).status).toBe(400);
  });
});
