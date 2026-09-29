export const MAX_BULK_DOWNLOAD_BYTES = 50 * 1024 * 1024;

export class BulkDownloadLimitError extends Error {
  constructor() {
    super("Bulk download archives are limited to 50 MiB total.");
    this.name = "BulkDownloadLimitError";
  }
}

export async function readResponseWithinByteLimit(
  response: Response,
  remainingBytes: number,
): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (
      Number.isSafeInteger(declaredLength) &&
      declaredLength > remainingBytes
    ) {
      throw new BulkDownloadLimitError();
    }
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > remainingBytes) throw new BulkDownloadLimitError();
    return bytes;
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > remainingBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BulkDownloadLimitError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
