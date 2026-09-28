import { describe, expect, it } from "vitest";
import {
  BulkDownloadLimitError,
  readResponseWithinByteLimit,
} from "./bulk-download-limits";

describe("readResponseWithinByteLimit", () => {
  it("rejects an oversized response from its declared length before reading", async () => {
    const response = new Response(new Uint8Array(4), {
      headers: { "Content-Length": "40" },
    });

    await expect(
      readResponseWithinByteLimit(response, 20),
    ).rejects.toBeInstanceOf(BulkDownloadLimitError);
  });

  it("stops a streamed response when its actual bytes exceed the remaining budget", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]));
        controller.enqueue(new Uint8Array([5, 6, 7, 8]));
      },
      cancel() {
        cancelled = true;
      },
    });

    await expect(
      readResponseWithinByteLimit(new Response(body), 6),
    ).rejects.toBeInstanceOf(BulkDownloadLimitError);
    expect(cancelled).toBe(true);
  });

  it("combines a response within budget into one byte array", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4]));
        controller.close();
      },
    });

    await expect(
      readResponseWithinByteLimit(new Response(body), 4),
    ).resolves.toEqual(new Uint8Array([1, 2, 3, 4]));
  });
});
