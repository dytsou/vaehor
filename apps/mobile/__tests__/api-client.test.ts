import { describe, expect, it, vi } from "vitest";
import { getHealthCheckUrl } from "@vaehor/sdk";
import { checkServerHealth, createServerFetch } from "../src/lib/api-client";

describe("api-client", () => {
  it("checks health via SDK path on normalized origin", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkServerHealth("https://zee.example.com")).resolves.toBe(
      true,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `https://zee.example.com${getHealthCheckUrl()}`,
      expect.objectContaining({ method: "GET" }),
    );

    vi.unstubAllGlobals();
  });

  it("sends the server credential as an authorization value, never a cookie", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const serverFetch = createServerFetch(
      "https://files.example.com/ignored/path",
      "server-session-token",
    );
    await serverFetch("/api/auth/me");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toBe("https://files.example.com/api/auth/me");
    expect(headers.get("Authorization")).toBe("Bearer server-session-token");
    expect(headers.has("Cookie")).toBe(false);
    expect(init.credentials).toBe("omit");

    vi.unstubAllGlobals();
  });
});
