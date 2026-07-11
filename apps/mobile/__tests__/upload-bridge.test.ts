import { describe, expect, it, vi } from "vitest";
import {
  CHUNK_SIZE,
  UploadAuthError,
  decodeBase64File,
  runNativeChunkedUpload,
  type ServerFetch,
} from "../src/lib/upload-bridge";

describe("upload-bridge", () => {
  it("decodes base64 file payloads", () => {
    expect(decodeBase64File("YWI=")).toEqual(new Uint8Array([97, 98]));
  });

  it("uploads a file in chunks and reports progress", async () => {
    const fetchImpl = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.includes("type=init")) {
        return new Response(
          JSON.stringify({ uploadUrl: "https://drive/upload" }),
          {
            status: 200,
          },
        );
      }

      const range = (init?.headers as Record<string, string>)?.[
        "Content-Range"
      ];
      if (range === `bytes 0-${CHUNK_SIZE - 1}/${CHUNK_SIZE + 1}`) {
        return new Response(JSON.stringify({ status: "partial" }), {
          status: 200,
        });
      }

      return new Response(JSON.stringify({ status: "completed" }), {
        status: 200,
      });
    }) as ServerFetch;

    const progress: number[] = [];
    await runNativeChunkedUpload({
      fetchImpl,
      parentId: "folder-1",
      file: {
        name: "photo.jpg",
        mimeType: "image/jpeg",
        bytes: new Uint8Array(CHUNK_SIZE + 1),
      },
      onProgress: (percent) => progress.push(percent),
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("type=init"),
      expect.any(Object),
    );
    expect(progress.at(-1)).toBe(100);
  });

  it("throws UploadAuthError when init returns 401", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 401 }));

    await expect(
      runNativeChunkedUpload({
        fetchImpl,
        parentId: "folder-1",
        file: {
          name: "secret.json",
          mimeType: "application/json",
          bytes: new Uint8Array([1]),
        },
        onProgress: () => {},
      }),
    ).rejects.toBeInstanceOf(UploadAuthError);
  });
});
