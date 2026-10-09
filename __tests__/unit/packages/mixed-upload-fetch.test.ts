import { afterEach, describe, expect, it, vi } from "vitest";
import { mixedUploadFetch } from "@/packages/sdk/src/mixed-upload-fetch";

afterEach(() => vi.restoreAllMocks());

describe("mixed upload fetch mutator", () => {
  it.each([
    "/api/file-request/upload?type=init",
    "/api/files/upload?type=init",
  ])("serializes JSON init objects for %s", async (url) => {
    const requestBody = { name: "report.txt", mimeType: "text/plain", size: 4 };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"uploadUrl":"https://uploads.test/session"}', {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    await mixedUploadFetch(url, { method: "POST", body: requestBody });

    const options = fetchSpy.mock.calls[0]?.[1];
    expect(options?.body).toBe(JSON.stringify(requestBody));
    expect(new Headers(options?.headers).get("content-type")).toBe(
      "application/json",
    );
  });

  it.each([
    ["string", "raw-upload-chunk"],
    [
      "Blob",
      new Blob(["raw-upload-chunk"], { type: "application/octet-stream" }),
    ],
  ])("preserves %s upload bodies", async (_label, body) => {
    const url = "/api/files/upload?type=chunk";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    await mixedUploadFetch(url, { method: "POST", body });

    expect(fetchSpy.mock.calls[0]?.[1]?.body).toBe(body);
  });
});
