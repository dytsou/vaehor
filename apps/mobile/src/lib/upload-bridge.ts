import {
  getUploadFileUrl,
  UploadMode,
  type ResumableUploadInitBody,
} from "@vaehor/sdk";

export const CHUNK_SIZE = 2 * 1024 * 1024;
export const MAX_RETRIES = 3;
const LOCAL_UPLOAD_PREFIX = "local-storage-upload://";
const RETRY_DELAY_MS = 500;

export class UploadAuthError extends Error {
  constructor(message = "Upload unauthorized") {
    super(message);
    this.name = "UploadAuthError";
  }
}

export class UploadLocalStorageAuthError extends Error {
  constructor() {
    super("Local storage access expired");
    this.name = "UploadLocalStorageAuthError";
  }
}

export class UploadHttpError extends Error {
  constructor(readonly status: number) {
    super(`Upload request failed with status ${status}`);
    this.name = "UploadHttpError";
  }
}

export type NativeUploadFile = {
  name: string;
  mimeType: string;
  size: number;
  readChunk: (
    start: number,
    end: number,
    signal?: AbortSignal,
  ) => Promise<Uint8Array>;
  close?: () => void | Promise<void>;
};

export type NativeUploadProgress = {
  fileName: string;
  percent: number;
  status: "uploading" | "success" | "error";
  errorMessage?: string;
};

export type ServerFetch = (
  path: string,
  init?: RequestInit,
) => Promise<Response>;

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function waitBeforeRetry(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new Error("Upload cancelled"));
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, RETRY_DELAY_MS);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("Upload cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function retryFetch(
  fetchImpl: ServerFetch,
  path: string,
  options: RequestInit,
  signal?: AbortSignal,
  classifyAuthentication = true,
): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (signal?.aborted) throw new Error("Upload cancelled");

    try {
      const response = await fetchImpl(path, {
        ...options,
        signal,
      });
      if (classifyAuthentication && response.status === 401) {
        const payload = (await response.json().catch(() => null)) as {
          isLocalAuthNeeded?: unknown;
        } | null;
        if (payload?.isLocalAuthNeeded === true) {
          throw new UploadLocalStorageAuthError();
        }
        throw new UploadAuthError();
      }
      if (classifyAuthentication && response.status === 403) {
        throw new UploadAuthError();
      }
      if (response.ok) return response;
      if (response.status < 500 || attempt === MAX_RETRIES) {
        throw new UploadHttpError(response.status);
      }
    } catch (error) {
      if (
        error instanceof UploadAuthError ||
        error instanceof UploadLocalStorageAuthError ||
        error instanceof UploadHttpError ||
        isAbortError(error, signal) ||
        attempt === MAX_RETRIES
      ) {
        throw error;
      }
    }

    await waitBeforeRetry(signal);
  }

  throw new Error("Upload retry limit reached");
}

function buildChunkUploadPath(uploadUrl: string, parentId: string): string {
  return getUploadFileUrl({
    type: UploadMode.chunk,
    uploadUrl,
    parentId,
  });
}

function buildZeroByteHeaders(uploadUrl: string): Record<string, string> {
  if (uploadUrl.startsWith(LOCAL_UPLOAD_PREFIX)) {
    return {
      "Content-Type": "application/octet-stream",
      "Content-Range": "bytes 0-0/0",
    };
  }
  return {
    "Content-Type": "application/octet-stream",
    "Content-Length": "0",
  };
}

async function initializeUpload(
  fetchImpl: ServerFetch,
  file: NativeUploadFile,
  parentId: string,
  signal?: AbortSignal,
): Promise<string> {
  const initBody: ResumableUploadInitBody = {
    name: file.name,
    mimeType: file.mimeType || "application/octet-stream",
    parentId,
    size: file.size,
  };
  const initResponse = await retryFetch(
    fetchImpl,
    getUploadFileUrl({ type: UploadMode.init }),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(initBody),
    },
    signal,
  );

  const data = (await initResponse.json()) as { uploadUrl?: unknown };
  if (typeof data.uploadUrl !== "string" || data.uploadUrl.length === 0) {
    throw new Error("The server did not start this upload.");
  }
  return data.uploadUrl;
}

function asRequestBody(bytes: Uint8Array): Blob {
  return new Blob([bytes as unknown as BlobPart], {
    type: "application/octet-stream",
  });
}

async function postUploadChunk(
  fetchImpl: ServerFetch,
  path: string,
  start: number,
  end: number,
  total: number,
  bytes: Uint8Array,
  signal?: AbortSignal,
  classifyAuthentication = true,
): Promise<{ status: string }> {
  // The server endpoint expects the raw binary body; the generated SDK JSON-encodes it.
  const chunkResponse = await retryFetch(
    fetchImpl,
    path,
    {
      method: "POST",
      headers: {
        "Content-Range": `bytes ${start}-${end - 1}/${total}`,
        "Content-Type": "application/octet-stream",
      },
      body: asRequestBody(bytes),
    },
    signal,
    classifyAuthentication,
  );

  try {
    return (await chunkResponse.json()) as { status: string };
  } catch {
    throw new Error("The server returned an invalid upload response.");
  }
}

async function uploadSingleChunk(
  fetchImpl: ServerFetch,
  uploadUrl: string,
  parentId: string,
  start: number,
  end: number,
  total: number,
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<{ status: string }> {
  return postUploadChunk(
    fetchImpl,
    buildChunkUploadPath(uploadUrl, parentId),
    start,
    end,
    total,
    bytes,
    signal,
  );
}

export async function runNativeChunkedUpload(options: {
  fetchImpl: ServerFetch;
  file: NativeUploadFile;
  parentId: string;
  onProgress: (percent: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const { fetchImpl, file, parentId, onProgress, signal } = options;
  try {
    if (!Number.isSafeInteger(file.size) || file.size < 0) {
      throw new Error("The selected file has an invalid size.");
    }
    onProgress(0);
    const uploadUrl = await initializeUpload(fetchImpl, file, parentId, signal);

    if (file.size === 0) {
      const response = await retryFetch(
        fetchImpl,
        buildChunkUploadPath(uploadUrl, parentId),
        {
          method: "POST",
          headers: buildZeroByteHeaders(uploadUrl),
          body: asRequestBody(new Uint8Array(0)),
        },
        signal,
      );
      const data = (await response.json()) as { status?: string };
      if (data.status !== "completed") {
        throw new Error("The server did not finish this upload.");
      }
      onProgress(100);
      return;
    }

    let start = 0;
    while (start < file.size) {
      if (signal?.aborted) throw new Error("Upload cancelled");
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const bytes = await file.readChunk(start, end, signal);
      if (bytes.byteLength !== end - start) {
        throw new Error("Could not read the selected file completely.");
      }

      const chunk = await uploadSingleChunk(
        fetchImpl,
        uploadUrl,
        parentId,
        start,
        end,
        file.size,
        bytes,
        signal,
      );
      if (chunk.status !== "completed" && chunk.status !== "partial") {
        throw new Error("The server did not finish this upload.");
      }

      start = end;
      onProgress(Math.floor((start / file.size) * 100));
      if (chunk.status === "completed") {
        onProgress(100);
        return;
      }
    }

    throw new Error("The server did not confirm that this upload completed.");
  } finally {
    await file.close?.();
  }
}

function buildFileRequestUploadPath(
  type: "init" | "chunk",
  token: string,
  uploadUrl?: string,
): string {
  const params = new URLSearchParams({ type, token });
  if (uploadUrl) params.set("uploadUrl", uploadUrl);
  return `/api/file-request/upload?${params.toString()}`;
}

export async function runNativeFileRequestUpload(options: {
  fetchImpl: ServerFetch;
  file: NativeUploadFile;
  token: string;
  onProgress: (percent: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const { fetchImpl, file, token, onProgress, signal } = options;
  try {
    if (!token) throw new Error("This upload link is invalid.");
    if (!Number.isSafeInteger(file.size) || file.size < 0) {
      throw new Error("The selected file has an invalid size.");
    }
    onProgress(0);

    const initResponse = await retryFetch(
      fetchImpl,
      buildFileRequestUploadPath("init", token),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          mimeType: file.mimeType || "application/octet-stream",
          size: file.size,
        }),
      },
      signal,
      false,
    );
    const initData = (await initResponse.json()) as { uploadUrl?: unknown };
    if (typeof initData.uploadUrl !== "string" || !initData.uploadUrl) {
      throw new Error("The server did not start this upload.");
    }
    const uploadUrl = initData.uploadUrl;

    const uploadChunk = async (
      start: number,
      end: number,
      bytes: Uint8Array,
    ) => {
      return postUploadChunk(
        fetchImpl,
        buildFileRequestUploadPath("chunk", token, uploadUrl),
        start,
        end,
        file.size,
        bytes,
        signal,
        false,
      );
    };

    if (file.size === 0) {
      const response = await retryFetch(
        fetchImpl,
        buildFileRequestUploadPath("chunk", token, uploadUrl),
        {
          method: "POST",
          headers: {
            "Content-Range": "bytes 0-0/0",
            "Content-Type": "application/octet-stream",
          },
          body: asRequestBody(new Uint8Array(0)),
        },
        signal,
        false,
      );
      const data = (await response.json()) as { status?: string };
      if (data.status !== "completed") {
        throw new Error("The server did not finish this upload.");
      }
      onProgress(100);
      return;
    }

    let start = 0;
    while (start < file.size) {
      if (signal?.aborted) throw new Error("Upload cancelled");
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const bytes = await file.readChunk(start, end, signal);
      if (bytes.byteLength !== end - start) {
        throw new Error("Could not read the selected file completely.");
      }

      const chunk = await uploadChunk(start, end, bytes);
      if (chunk.status !== "partial" && chunk.status !== "completed") {
        throw new Error("The server did not finish this upload.");
      }
      start = end;
      onProgress(Math.floor((start / file.size) * 100));
      if (chunk.status === "completed") {
        onProgress(100);
        return;
      }
    }
    throw new Error("The server did not confirm that this upload completed.");
  } finally {
    await file.close?.();
  }
}

export function decodeBase64File(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.codePointAt(i) ?? 0;
  }
  return bytes;
}
