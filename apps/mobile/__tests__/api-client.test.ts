import { describe, expect, it, vi } from "vitest";
import { getHealthCheckUrl } from "@vaehor/sdk";
import { checkServerHealth } from "../src/lib/api-client";

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
});
