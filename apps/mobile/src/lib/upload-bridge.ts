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

async function classifyUploadAuthentication(
  response: Response,
  enabled: boolean,
): Promise<void> {
  if (!enabled) return;
  if (response.status === 401) {
    const payload = (await response.json().catch(() => null)) as {
      isLocalAuthNeeded?: unknown;
    } | null;
    if (payload?.isLocalAuthNeeded === true) {
      throw new UploadLocalStorageAuthError();
    }
    throw new UploadAuthError();
  }
  if (response.status === 403) throw new UploadAuthError();
}

function shouldRethrowUploadError(
  error: unknown,
  signal: AbortSignal | undefined,
  attempt: number,
): boolean {
  return (
    error instanceof UploadAuthError ||
    error instanceof UploadLocalStorageAuthError ||
    error instanceof UploadHttpError ||
    isAbortError(error, signal) ||
    attempt === MAX_RETRIES
  );
}

async function tryUploadRequest(
  fetchImpl: ServerFetch,
  path: string,
  options: RequestInit,
  signal?: AbortSignal,
  attempt = 0,
  classifyAuthentication = true,
): Promise<Response | null> {
  try {
    const response = await fetchImpl(path, { ...options, signal });
    await classifyUploadAuthentication(response, classifyAuthentication);
    if (response.ok) return response;
    if (response.status < 500 || attempt === MAX_RETRIES) {
      throw new UploadHttpError(response.status);
    }
  } catch (error) {
    if (shouldRethrowUploadError(error, signal, attempt)) throw error;
  }
  return null;
}

async function retryFetch(
  fetchImpl: ServerFetch,
  path: string,
  options: RequestInit,
  signal?: AbortSignal,
  classifyAuthentication = true,
): Promise<Response> {
  const attemptRequest = async (attempt: number): Promise<Response> => {
    if (attempt > MAX_RETRIES) {
      throw new Error("Upload retry limit reached");
    }
    if (signal?.aborted) throw new Error("Upload cancelled");
    const response = await tryUploadRequest(
      fetchImpl,
      path,
      options,
      signal,
      attempt,
      classifyAuthentication,
    );
    if (response) return response;

    await waitBeforeRetry(signal);
    return attemptRequest(attempt + 1);
  };

  return attemptRequest(0);
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

type UploadChunkOptions = Readonly<{
  fetchImpl: ServerFetch;
  path: string;
  start: number;
  end: number;
  total: number;
  bytes: Uint8Array;
  signal?: AbortSignal;
  classifyAuthentication?: boolean;
}>;

async function postUploadChunk({
  fetchImpl,
  path,
  start,
  end,
  total,
  bytes,
  signal,
  classifyAuthentication = true,
}: UploadChunkOptions): Promise<{ status: string }> {
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
  options: Readonly<{
    fetchImpl: ServerFetch;
    uploadUrl: string;
    parentId: string;
    start: number;
    end: number;
    total: number;
    bytes: Uint8Array;
    signal?: AbortSignal;
  }>,
): Promise<{ status: string }> {
  return postUploadChunk({
    ...options,
    path: buildChunkUploadPath(options.uploadUrl, options.parentId),
  });
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
      await uploadEmptyNativeFile({
        fetchImpl,
        uploadUrl,
        parentId,
        signal,
        onProgress,
      });
      return;
    }
    await uploadNativeFileChunks({
      fetchImpl,
      file,
      uploadUrl,
      parentId,
      signal,
      onProgress,
    });
  } finally {
    await file.close?.();
  }
}

async function uploadEmptyNativeFile(options: {
  fetchImpl: ServerFetch;
  uploadUrl: string;
  parentId: string;
  signal?: AbortSignal;
  onProgress: (percent: number) => void;
}): Promise<void> {
  const response = await retryFetch(
    options.fetchImpl,
    buildChunkUploadPath(options.uploadUrl, options.parentId),
    {
      method: "POST",
      headers: buildZeroByteHeaders(options.uploadUrl),
      body: asRequestBody(new Uint8Array(0)),
    },
    options.signal,
  );
  const data = (await response.json()) as { status?: string };
  if (data.status !== "completed") {
    throw new Error("The server did not finish this upload.");
  }
  options.onProgress(100);
}

async function uploadNativeFileChunks(options: {
  fetchImpl: ServerFetch;
  file: NativeUploadFile;
  uploadUrl: string;
  parentId: string;
  signal?: AbortSignal;
  onProgress: (percent: number) => void;
}): Promise<void> {
  let start = 0;
  while (start < options.file.size) {
    if (options.signal?.aborted) throw new Error("Upload cancelled");
    const end = Math.min(start + CHUNK_SIZE, options.file.size);
    const bytes = await options.file.readChunk(start, end, options.signal);
    if (bytes.byteLength !== end - start) {
      throw new Error("Could not read the selected file completely.");
    }
    const chunk = await uploadSingleChunk({
      fetchImpl: options.fetchImpl,
      uploadUrl: options.uploadUrl,
      parentId: options.parentId,
      start,
      end,
      total: options.file.size,
      bytes,
      signal: options.signal,
    });
    if (chunk.status !== "completed" && chunk.status !== "partial") {
      throw new Error("The server did not finish this upload.");
    }
    start = end;
    options.onProgress(Math.floor((start / options.file.size) * 100));
    if (chunk.status === "completed") {
      options.onProgress(100);
      return;
    }
  }
  throw new Error("The server did not confirm that this upload completed.");
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

async function uploadEmptyRequestFile(
  fetchImpl: ServerFetch,
  token: string,
  uploadUrl: string,
  signal: AbortSignal | undefined,
  onProgress: (percent: number) => void,
): Promise<void> {
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
}

type RequestUploadChunkOptions = {
  fetchImpl: ServerFetch;
  file: NativeUploadFile;
  token: string;
  uploadUrl: string;
  signal?: AbortSignal;
};

async function initializeRequestUpload(
  fetchImpl: ServerFetch,
  file: NativeUploadFile,
  token: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await retryFetch(
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
  const data = (await response.json()) as { uploadUrl?: unknown };
  if (typeof data.uploadUrl !== "string" || !data.uploadUrl) {
    throw new Error("The server did not start this upload.");
  }
  return data.uploadUrl;
}

async function uploadRequestChunk(
  options: RequestUploadChunkOptions & {
    start: number;
    end: number;
  },
): Promise<{ status: string }> {
  const { fetchImpl, file, token, uploadUrl, signal, start, end } = options;
  const bytes = await file.readChunk(start, end, signal);
  if (bytes.byteLength !== end - start) {
    throw new Error("Could not read the selected file completely.");
  }
  const result = await postUploadChunk({
    fetchImpl,
    path: buildFileRequestUploadPath("chunk", token, uploadUrl),
    start,
    end,
    total: file.size,
    bytes,
    signal,
    classifyAuthentication: false,
  });
  if (result.status !== "partial" && result.status !== "completed") {
    throw new Error("The server did not finish this upload.");
  }
  return result;
}

async function uploadRequestChunks(
  options: RequestUploadChunkOptions & {
    onProgress: (percent: number) => void;
  },
): Promise<void> {
  const { fetchImpl, file, token, uploadUrl, signal, onProgress } = options;
  if (file.size === 0) {
    await uploadEmptyRequestFile(
      fetchImpl,
      token,
      uploadUrl,
      signal,
      onProgress,
    );
    return;
  }

  let start = 0;
  while (start < file.size) {
    if (signal?.aborted) throw new Error("Upload cancelled");
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const result = await uploadRequestChunk({
      fetchImpl,
      file,
      token,
      uploadUrl,
      signal,
      start,
      end,
    });
    start = end;
    onProgress(Math.floor((start / file.size) * 100));
    if (result.status === "completed") {
      onProgress(100);
      return;
    }
  }
  throw new Error("The server did not confirm that this upload completed.");
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
    const uploadUrl = await initializeRequestUpload(
      fetchImpl,
      file,
      token,
      signal,
    );
    await uploadRequestChunks({
      fetchImpl,
      file,
      token,
      uploadUrl,
      signal,
      onProgress,
    });
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
