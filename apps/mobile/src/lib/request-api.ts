import type { ServerFetch } from "./api-client";

export type MobileFileRequest = {
  token: string;
  folderId: string;
  folderName: string;
  title: string;
  expiresAt: number;
  createdAt: number;
  createdBy?: string;
};

export type PublicFileRequest = Pick<
  MobileFileRequest,
  "folderId" | "folderName" | "title" | "expiresAt"
>;

export class FileRequestApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FileRequestApiError";
  }
}

async function requestJson<T>(
  fetchImpl: ServerFetch,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetchImpl(path, init);
  const payload = (await response.json().catch(() => null)) as
    | { error?: unknown }
    | T
    | null;
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `Request failed with status ${response.status}.`;
    throw new FileRequestApiError(message, response.status);
  }
  return payload as T;
}

export function listMobileFileRequests(
  fetchImpl: ServerFetch,
): Promise<MobileFileRequest[]> {
  return requestJson(fetchImpl, "/api/file-request");
}

export function createMobileFileRequest(
  fetchImpl: ServerFetch,
  body: {
    folderId: string;
    folderName: string;
    title: string;
    expiresIn: number;
  },
): Promise<{ success: boolean; token: string; publicUrl: string }> {
  return requestJson(fetchImpl, "/api/file-request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function deleteMobileFileRequest(
  fetchImpl: ServerFetch,
  token: string,
): Promise<{ success: boolean }> {
  return requestJson(fetchImpl, "/api/file-request", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

export function getPublicFileRequest(
  fetchImpl: ServerFetch,
  token: string,
): Promise<PublicFileRequest> {
  return requestJson(
    fetchImpl,
    `/api/file-request/${encodeURIComponent(token)}`,
  );
}
