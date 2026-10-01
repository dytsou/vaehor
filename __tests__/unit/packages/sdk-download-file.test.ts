import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadFile } from "@/packages/sdk/src/orval";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("downloadFile SDK response parsing", () => {
  it("returns successful downloads as Blob data", async () => {
    const body = new Blob(["binary file content"], {
      type: "application/octet-stream",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(await body.arrayBuffer(), {
            headers: { "Content-Type": "application/octet-stream" },
          }),
      ),
    );

    const response = await downloadFile({ fileId: "drive-file-id" });

    expect(response.status).toBe(200);
    expect(response.data).toBeInstanceOf(Blob);
    await expect((response.data as Blob).text()).resolves.toBe(
      "binary file content",
    );
  });

  it.each([
    [401, { error: "Authentication is required." }],
    [404, { error: "The requested file was not found." }],
  ])("keeps JSON error bodies for HTTP %s", async (status, body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(body, { status })),
    );

    const response = await downloadFile({ fileId: "drive-file-id" });

    expect(response.status).toBe(status);
    expect(response.data).toEqual(body);
  });
});
