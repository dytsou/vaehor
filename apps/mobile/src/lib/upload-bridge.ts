export const CHUNK_SIZE = 2 * 1024 * 1024;
export const MAX_RETRIES = 3;
const LOCAL_UPLOAD_PREFIX = "local-storage-upload://";

export class UploadAuthError extends Error {
  constructor(message = "Upload unauthorized") {
    super(message);
    this.name = "UploadAuthError";
  }
}

export type NativeUploadFile = {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
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

async function retryFetch(
  fetchImpl: ServerFetch,
  path: string,
  options: RequestInit,
  retries = MAX_RETRIES,
): Promise<Response> {
  try {
    const response = await fetchImpl(path, options);
    if (!response.ok && retries > 0 && response.status >= 500) {
      throw new Error(`Server error: ${response.status}`);
    }
    return response;
  } catch (error) {
    if (retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return retryFetch(fetchImpl, path, options, retries - 1);
    }
    throw error;
  }
}

function buildChunkUploadPath(uploadUrl: string, parentId: string): string {
  return `/api/files/upload?type=chunk&uploadUrl=${encodeURIComponent(
    uploadUrl,
  )}&parentId=${parentId}`;
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
): Promise<string> {
  const initResponse = await retryFetch(
    fetchImpl,
    "/api/files/upload?type=init",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: file.name,
        mimeType: file.mimeType || "application/octet-stream",
        parentId,
        size: file.bytes.byteLength,
      }),
    },
  );

  if (initResponse.status === 401 || initResponse.status === 403) {
    throw new UploadAuthError();
  }
  if (!initResponse.ok) {
    throw new Error("Upload init failed");
  }

  const { uploadUrl } = (await initResponse.json()) as { uploadUrl: string };
  return uploadUrl;
}

function asRequestBody(bytes: Uint8Array): Blob {
  const copy = Uint8Array.from(bytes);
  return new Blob([copy], { type: "application/octet-stream" });
}

async function uploadSingleChunk(
  fetchImpl: ServerFetch,
  file: NativeUploadFile,
  uploadUrl: string,
  parentId: string,
  start: number,
  end: number,
) {
  const chunkResponse = await retryFetch(
    fetchImpl,
    buildChunkUploadPath(uploadUrl, parentId),
    {
      method: "POST",
      headers: {
        "Content-Range": `bytes ${start}-${end - 1}/${file.bytes.byteLength}`,
        "Content-Type": "application/octet-stream",
      },
      body: asRequestBody(file.bytes.subarray(start, end)),
    },
  );

  if (!chunkResponse.ok) {
    throw new Error("Chunk upload failed");
  }

  return chunkResponse.json() as Promise<{ status: string }>;
}

export async function runNativeChunkedUpload(options: {
  fetchImpl: ServerFetch;
  file: NativeUploadFile;
  parentId: string;
  onProgress: (percent: number) => void;
}): Promise<void> {
  const { fetchImpl, file, parentId, onProgress } = options;
  onProgress(0);

  const uploadUrl = await initializeUpload(fetchImpl, file, parentId);

  if (file.bytes.byteLength === 0) {
    const chunkResponse = await retryFetch(
      fetchImpl,
      buildChunkUploadPath(uploadUrl, parentId),
      {
        method: "POST",
        headers: buildZeroByteHeaders(uploadUrl),
        body: asRequestBody(new Uint8Array(0)),
      },
    );
    if (!chunkResponse.ok) throw new Error("Chunk upload failed");
    const chunkData = (await chunkResponse.json()) as { status: string };
    if (chunkData.status !== "completed")
      throw new Error("Chunk upload failed");
    onProgress(100);
    return;
  }

  let start = 0;
  while (start < file.bytes.byteLength) {
    const end = Math.min(start + CHUNK_SIZE, file.bytes.byteLength);
    const chunkData = await uploadSingleChunk(
      fetchImpl,
      file,
      uploadUrl,
      parentId,
      start,
      end,
    );

    onProgress(Math.round((end / file.bytes.byteLength) * 100));

    if (chunkData.status === "completed") {
      onProgress(100);
      return;
    }

    start = end;
  }
}

export function decodeBase64File(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
