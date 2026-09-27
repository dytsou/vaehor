import { describe, expect, it, vi } from "vitest";
import {
  CHUNK_SIZE,
  UploadAuthError,
  UploadHttpError,
  UploadLocalStorageAuthError,
  decodeBase64File,
  runNativeChunkedUpload,
  runNativeFileRequestUpload,
  type NativeUploadFile,
  type ServerFetch,
} from "../src/lib/upload-bridge";

function createFile(size: number): NativeUploadFile {
  return {
    name: "photo.jpg",
    mimeType: "image/jpeg",
    size,
    readChunk: vi.fn(async (start, end) => new Uint8Array(end - start)),
    close: vi.fn(),
  };
}

function fetchWithSuccessfulUpload() {
  return vi.fn(async (path: string, init?: RequestInit) => {
    if (path.includes("type=init")) {
      return new Response(
        JSON.stringify({ uploadUrl: "https://drive/upload" }),
        { status: 200 },
      );
    }

    const range = (init?.headers as Record<string, string>)?.["Content-Range"];
    const total = Number(range?.split("/")[1]);
    const end = Number(range?.match(/bytes \d+-(\d+)/)?.[1]);
    return new Response(
      JSON.stringify({ status: end + 1 === total ? "completed" : "partial" }),
      { status: 200 },
    );
  });
}

describe("upload-bridge", () => {
  it("decodes base64 file payloads", () => {
    expect(decodeBase64File("YWI=")).toEqual(new Uint8Array([97, 98]));
  });

  it("reads bounded chunks and reports monotonic progress", async () => {
    const fetchImpl = fetchWithSuccessfulUpload();
    const file = createFile(CHUNK_SIZE + 1);
    const progress: number[] = [];

    await runNativeChunkedUpload({
      fetchImpl,
      parentId: "folder-1",
      file,
      onProgress: (percent) => progress.push(percent),
    });

    expect(file.readChunk).toHaveBeenNthCalledWith(1, 0, CHUNK_SIZE, undefined);
    expect(file.readChunk).toHaveBeenNthCalledWith(
      2,
      CHUNK_SIZE,
      CHUNK_SIZE + 1,
      undefined,
    );
    expect(file.close).toHaveBeenCalledOnce();
    expect(progress).toEqual([0, 99, 100, 100]);
  });

  it("uploads public file requests with the request token and bounded chunks", async () => {
    const fetchImpl = fetchWithSuccessfulUpload();
    const file = createFile(CHUNK_SIZE + 1);
    const progress: number[] = [];

    await runNativeFileRequestUpload({
      fetchImpl,
      token: "public-request/1",
      file,
      onProgress: (percent) => progress.push(percent),
    });

    const [initPath] = fetchImpl.mock.calls[0] as [string, RequestInit?];
    expect(
      new URL(initPath, "https://server.example").searchParams.get("token"),
    ).toBe("public-request/1");
    expect(file.readChunk).toHaveBeenNthCalledWith(1, 0, CHUNK_SIZE, undefined);
    expect(file.readChunk).toHaveBeenNthCalledWith(
      2,
      CHUNK_SIZE,
      CHUNK_SIZE + 1,
      undefined,
    );
    expect(file.close).toHaveBeenCalledOnce();
    expect(progress).toEqual([0, 99, 100, 100]);
  });

  it("keeps public request authorization errors as HTTP errors instead of session failures", async () => {
    const file = createFile(1);
    const fetchImpl = vi.fn(async () => new Response("", { status: 403 }));

    await expect(
      runNativeFileRequestUpload({
        fetchImpl,
        token: "expired-request",
        file,
        onProgress: () => {},
      }),
    ).rejects.toMatchObject({ name: "UploadHttpError", status: 403 });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(file.close).toHaveBeenCalledOnce();
  });

  it("completes a zero-byte local-storage upload", async () => {
    const file = createFile(0);
    const fetchMock = vi.fn<ServerFetch>(async (path, init) => {
      void init;
      if (path.includes("type=init")) {
        return new Response(
          JSON.stringify({ uploadUrl: "local-storage-upload://session-1" }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ status: "completed" }), {
        status: 200,
      });
    });
    const fetchImpl = fetchMock as ServerFetch;

    await runNativeChunkedUpload({
      fetchImpl,
      parentId: "folder-1",
      file,
      onProgress: () => {},
    });

    const chunkInit = fetchMock.mock.calls[1]?.[1];
    expect(
      (chunkInit?.headers as Record<string, string>)?.["Content-Range"],
    ).toBe("bytes 0-0/0");
    expect(file.close).toHaveBeenCalledOnce();
  });

  it("does not retry unauthorized responses", async () => {
    const file = createFile(1);
    const fetchImpl = vi.fn(async () => new Response("", { status: 401 }));

    await expect(
      runNativeChunkedUpload({
        fetchImpl,
        parentId: "folder-1",
        file,
        onProgress: () => {},
      }),
    ).rejects.toBeInstanceOf(UploadAuthError);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(file.close).toHaveBeenCalledOnce();
  });

  it("distinguishes a local-storage password timeout from server sign-in", async () => {
    const file = createFile(1);
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ isLocalAuthNeeded: true }), {
          status: 401,
        }),
    );

    await expect(
      runNativeChunkedUpload({
        fetchImpl,
        parentId: "local-storage:",
        file,
        onProgress: () => {},
      }),
    ).rejects.toBeInstanceOf(UploadLocalStorageAuthError);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(file.close).toHaveBeenCalledOnce();
  });

  it("does not retry client errors", async () => {
    const file = createFile(1);
    const fetchImpl = vi.fn(async () => new Response("", { status: 409 }));

    await expect(
      runNativeChunkedUpload({
        fetchImpl,
        parentId: "folder-1",
        file,
        onProgress: () => {},
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(file.close).toHaveBeenCalledOnce();
  });

  it("retries a transient server error", async () => {
    const file = createFile(1);
    let chunkAttempts = 0;
    const fetchImpl = vi.fn(async (path: string) => {
      if (path.includes("type=init")) {
        return new Response(
          JSON.stringify({ uploadUrl: "https://drive/upload" }),
          {
            status: 200,
          },
        );
      }
      chunkAttempts += 1;
      return chunkAttempts === 1
        ? new Response("", { status: 503 })
        : new Response(JSON.stringify({ status: "completed" }), {
            status: 200,
          });
    }) as ServerFetch;

    await runNativeChunkedUpload({
      fetchImpl,
      parentId: "folder-1",
      file,
      onProgress: () => {},
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(file.close).toHaveBeenCalledOnce();
  });

  it("closes the picked file when cancelled before the first request", async () => {
    const file = createFile(2);
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn() as ServerFetch;

    await expect(
      runNativeChunkedUpload({
        fetchImpl,
        parentId: "folder-1",
        file,
        onProgress: () => {},
        signal: controller.signal,
      }),
    ).rejects.toThrow("Upload cancelled");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(file.close).toHaveBeenCalledOnce();
  });

  it("requires the final chunk to be acknowledged", async () => {
    const file = createFile(1);
    const fetchImpl = vi.fn(async (path: string) =>
      path.includes("type=init")
        ? new Response(JSON.stringify({ uploadUrl: "https://drive/upload" }), {
            status: 200,
          })
        : new Response(JSON.stringify({ status: "partial" }), { status: 200 }),
    ) as ServerFetch;

    await expect(
      runNativeChunkedUpload({
        fetchImpl,
        parentId: "folder-1",
        file,
        onProgress: () => {},
      }),
    ).rejects.toThrow("did not confirm");
    expect(file.close).toHaveBeenCalledOnce();
  });

  it("exposes non-auth HTTP status for recoverable UI messaging", () => {
    expect(new UploadHttpError(413).status).toBe(413);
  });
});
