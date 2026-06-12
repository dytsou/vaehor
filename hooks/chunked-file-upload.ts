const CHUNK_SIZE = 2 * 1024 * 1024;
const MAX_RETRIES = 3;
const LOCAL_UPLOAD_PREFIX = "local-storage-upload://";

export interface ChunkedUploadCallbacks {
  onProgress: (
    percent: number,
    status: "uploading" | "success" | "error",
    error?: string,
  ) => void;
  onComplete: () => void;
  onRemoveLater: () => void;
}

export interface ChunkedUploadMessages {
  initFailed: string;
  chunkFailed: string;
}

async function retryFetch(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES,
): Promise<Response> {
  try {
    const response = await fetch(url, options);
    if (!response.ok && retries > 0 && response.status >= 500) {
      throw new Error(`Server error: ${response.status}`);
    }
    return response;
  } catch (error) {
    if (retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return retryFetch(url, options, retries - 1);
    }
    throw error;
  }
}

function buildChunkUploadUrl(uploadUrl: string, targetParentId: string) {
  return `/api/files/upload?type=chunk&uploadUrl=${encodeURIComponent(
    uploadUrl,
  )}&parentId=${targetParentId}`;
}

function buildZeroByteHeaders(uploadUrl: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
  };

  if (uploadUrl.startsWith(LOCAL_UPLOAD_PREFIX)) {
    headers["Content-Range"] = "bytes 0-0/0";
  } else {
    headers["Content-Length"] = "0";
  }

  return headers;
}

async function initializeUpload(
  file: File,
  targetParentId: string,
  initFailedMessage: string,
): Promise<string> {
  const initResponse = await retryFetch("/api/files/upload?type=init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      parentId: targetParentId,
      size: file.size,
    }),
  });

  if (!initResponse.ok) {
    throw new Error(initFailedMessage);
  }

  const { uploadUrl } = await initResponse.json();
  return uploadUrl as string;
}

async function assertChunkCompleted(
  chunkResponse: Response,
  chunkFailedMessage: string,
) {
  if (!chunkResponse.ok) {
    throw new Error(chunkFailedMessage);
  }

  const chunkData = await chunkResponse.json();
  if (chunkData.status !== "completed") {
    throw new Error(chunkFailedMessage);
  }

  return chunkData;
}

function finalizeSuccessfulUpload(callbacks: ChunkedUploadCallbacks) {
  callbacks.onProgress(100, "success");
  callbacks.onComplete();
  setTimeout(callbacks.onRemoveLater, 5000);
}

async function uploadEmptyFile(
  uploadUrl: string,
  targetParentId: string,
  chunkFailedMessage: string,
  callbacks: ChunkedUploadCallbacks,
) {
  const chunkResponse = await retryFetch(
    buildChunkUploadUrl(uploadUrl, targetParentId),
    {
      method: "POST",
      headers: buildZeroByteHeaders(uploadUrl),
      body: new Uint8Array(0),
    },
  );

  await assertChunkCompleted(chunkResponse, chunkFailedMessage);
  finalizeSuccessfulUpload(callbacks);
}

async function uploadSingleChunk(
  file: File,
  uploadUrl: string,
  targetParentId: string,
  start: number,
  end: number,
  chunkFailedMessage: string,
) {
  const chunkResponse = await retryFetch(
    buildChunkUploadUrl(uploadUrl, targetParentId),
    {
      method: "POST",
      headers: {
        "Content-Range": `bytes ${start}-${end - 1}/${file.size}`,
        "Content-Type": "application/octet-stream",
      },
      body: file.slice(start, end),
    },
  );

  if (!chunkResponse.ok) {
    throw new Error(chunkFailedMessage);
  }

  return chunkResponse.json();
}

async function uploadFileInChunks(
  file: File,
  uploadUrl: string,
  targetParentId: string,
  chunkFailedMessage: string,
  callbacks: ChunkedUploadCallbacks,
) {
  let start = 0;

  while (start < file.size) {
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunkData = await uploadSingleChunk(
      file,
      uploadUrl,
      targetParentId,
      start,
      end,
      chunkFailedMessage,
    );

    const percent = Math.round((end / file.size) * 100);
    callbacks.onProgress(percent, "uploading");

    if (chunkData.status === "completed") {
      finalizeSuccessfulUpload(callbacks);
      return;
    }

    start = end;
  }
}

export async function runChunkedFileUpload(
  file: File,
  targetParentId: string,
  messages: ChunkedUploadMessages,
  callbacks: ChunkedUploadCallbacks,
) {
  callbacks.onProgress(0, "uploading");

  const uploadUrl = await initializeUpload(
    file,
    targetParentId,
    messages.initFailed,
  );

  if (file.size === 0) {
    await uploadEmptyFile(
      uploadUrl,
      targetParentId,
      messages.chunkFailed,
      callbacks,
    );
    return;
  }

  await uploadFileInChunks(
    file,
    uploadUrl,
    targetParentId,
    messages.chunkFailed,
    callbacks,
  );
}
