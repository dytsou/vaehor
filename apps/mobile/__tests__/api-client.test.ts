import { describe, expect, it, vi } from "vitest";
import { getHealthCheckUrl } from "@vaehor/sdk";
import {
  checkServerHealth,
  createPublicServerFetch,
  createServerFetch,
} from "../src/lib/api-client";

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

  it("omits browser and bearer credentials for public request links", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const publicFetch = createPublicServerFetch("https://files.example.com");
    await publicFetch("/api/file-request/token", {
      headers: {
        Authorization: "Bearer should-not-be-forwarded",
        Cookie: "session=should-not-be-forwarded",
      },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toBe("https://files.example.com/api/file-request/token");
    expect(headers.has("Authorization")).toBe(false);
    expect(headers.has("Cookie")).toBe(false);
    expect(init.credentials).toBe("omit");

    vi.unstubAllGlobals();
  });

  it("applies the configured request deadline and keeps caller cancellation", async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(signal.reason);
            return;
          }
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const serverFetch = createServerFetch(
      "https://files.example.com",
      "server-session-token",
      { requestTimeoutMs: 5, uploadTimeoutMs: 50 },
    );
    await expect(serverFetch("/api/auth/me")).rejects.toThrow(
      "server_request_timeout",
    );
    const [, timedInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(timedInit.signal?.aborted).toBe(true);

    vi.unstubAllGlobals();
  });

  it("uses the longer upload deadline and still honors a caller abort", async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(signal.reason);
            return;
          }
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const serverFetch = createServerFetch(
      "https://files.example.com",
      "server-session-token",
      { requestTimeoutMs: 5, uploadTimeoutMs: 100 },
    );
    const caller = new AbortController();
    const upload = serverFetch("/api/file/upload", {
      method: "POST",
      signal: caller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 15));
    const [, uploadInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(uploadInit.signal?.aborted).toBe(false);

    caller.abort(new Error("caller_cancelled"));
    await expect(upload).rejects.toThrow("caller_cancelled");
    vi.unstubAllGlobals();
  });
});
