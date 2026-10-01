import {
  getDownloadFileUrl,
  getDeleteFileUrl,
  getBulkDownloadUrl,
  getBulkDeleteFilesUrl,
  getBulkMoveFilesUrl,
  getGetFileDetailsUrl,
  getAddMobilePinUrl,
  getAddMobileTagUrl,
  getListFilesUrl,
  getListMobileFavoritesUrl,
  getListMobilePinnedFoldersUrl,
  getListMobileTagsUrl,
  getListMobileDrivesUrl,
  getMoveFileUrl,
  getRemoveMobilePinUrl,
  getRemoveMobileTagUrl,
  getSetMobileFavoriteUrl,
  getSearchFilesUrl,
  getUnlockMobileLocalStorageUrl,
  type DownloadFileParams,
  type DriveFile,
  type FileListResponse,
  type GetFileDetailsParams,
  type ListFilesParams,
  type MobileLocalStorageUnlockResponse,
  type MobileDrivesResponse,
  type MobileFavoriteUpdateBody,
  type MobileFavoriteIdsResponse,
  type MobileFavoritesResponse,
  type MobilePinnedFoldersResponse,
  type MobilePinMutationResponse,
  type MobileTagMutationResponse,
  type MobileTagsResponse,
  type SearchFilesParams,
} from "@vaehor/sdk";
import { requireSecureServerOrigin } from "./api-client";

export class MobileApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly access: {
      protected?: boolean;
      folderId?: string;
      isLocalAuthNeeded?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "MobileApiError";
  }
}

type MobileApiErrorPayload = {
  protected?: unknown;
  folderId?: unknown;
  isLocalAuthNeeded?: unknown;
  error?: unknown;
  message?: unknown;
};

const MOBILE_STATUS_ERROR_MESSAGES: Record<number, string> = {
  401: "Your sign-in has expired. Return to the server screen and sign in again.",
  403: "This server did not allow the requested file operation.",
  404: "This file or folder is no longer available.",
  429: "Too many requests. Wait a moment and retry.",
};

function mobileApiErrorMessage(
  payload: MobileApiErrorPayload | null,
  status: number,
): string {
  if (typeof payload?.message === "string") return payload.message;
  if (typeof payload?.error === "string") return payload.error;
  if (payload?.protected === true)
    return "This folder requires its access credentials.";
  if (payload?.isLocalAuthNeeded === true)
    return "Local storage requires its access password.";
  return (
    MOBILE_STATUS_ERROR_MESSAGES[status] ??
    "The server could not complete this request."
  );
}

export function buildSameOriginUrl(origin: string, path: string): string {
  const serverOrigin = requireSecureServerOrigin(origin);
  const url = new URL(path, `${serverOrigin}/`);
  if (url.origin !== serverOrigin) {
    throw new Error("cross_origin_request_blocked");
  }
  return url.toString();
}

async function requestJson<T>(
  fetchImpl: (path: string, init?: RequestInit) => Promise<Response>,
  path: string,
  signal?: AbortSignal,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(path, {
      ...init,
      signal: signal ?? init.signal,
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new MobileApiError(
      0,
      "Could not reach the server. Check your connection and retry.",
    );
  }

  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => null)) as MobileApiErrorPayload | null;
    const isProtected = payload?.protected === true;
    const isLocalAuthNeeded = payload?.isLocalAuthNeeded === true;
    throw new MobileApiError(
      response.status,
      mobileApiErrorMessage(payload, response.status),
      {
        protected: isProtected,
        folderId:
          typeof payload?.folderId === "string" ? payload.folderId : undefined,
        isLocalAuthNeeded,
      },
    );
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new MobileApiError(
      response.status,
      "The server returned an invalid response.",
    );
  }
}

export function listMobileDrives(
  fetchImpl: (path: string, init?: RequestInit) => Promise<Response>,
  signal?: AbortSignal,
): Promise<MobileDrivesResponse> {
  return requestJson(fetchImpl, getListMobileDrivesUrl(), signal);
}

export function listMobileFavorites(
  fetchImpl: (path: string, init?: RequestInit) => Promise<Response>,
  pageToken?: string,
  signal?: AbortSignal,
): Promise<MobileFavoritesResponse> {
  const params = new URLSearchParams();
  if (pageToken) params.set("pageToken", pageToken);
  const query = params.toString();
  const querySuffix = query ? `?${query}` : "";
  const path = `${getListMobileFavoritesUrl()}${querySuffix}`;
  return requestJson(fetchImpl, path, signal);
}

export function getMobileFavoriteIds(
  fetchImpl: (path: string, init?: RequestInit) => Promise<Response>,
  signal?: AbortSignal,
): Promise<MobileFavoriteIdsResponse> {
  const params = new URLSearchParams({ idsOnly: "true" });
  return requestJson(
    fetchImpl,
    `${getListMobileFavoritesUrl()}?${params.toString()}`,
    signal,
  );
}

export function setMobileFavorite(
  fetchImpl: (path: string, init?: RequestInit) => Promise<Response>,
  body: MobileFavoriteUpdateBody,
): Promise<{ success: boolean; isFavorite: boolean }> {
  return requestJson(fetchImpl, getSetMobileFavoriteUrl(), undefined, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function listMobilePinnedFolders(
  fetchImpl: (path: string, init?: RequestInit) => Promise<Response>,
  signal?: AbortSignal,
): Promise<MobilePinnedFoldersResponse> {
  return requestJson(fetchImpl, getListMobilePinnedFoldersUrl(), signal);
}

export function setMobileFolderPinned(
  fetchImpl: (path: string, init?: RequestInit) => Promise<Response>,
  folderId: string,
  isPinned: boolean,
): Promise<MobilePinMutationResponse> {
  return requestJson(
    fetchImpl,
    isPinned ? getAddMobilePinUrl() : getRemoveMobilePinUrl(),
    undefined,
    {
      method: isPinned ? "POST" : "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId }),
    },
  );
}

export function listMobileTags(
  fetchImpl: (path: string, init?: RequestInit) => Promise<Response>,
  fileId: string,
  signal?: AbortSignal,
): Promise<MobileTagsResponse> {
  return requestJson(fetchImpl, getListMobileTagsUrl({ fileId }), signal);
}

export function addMobileTag(
  fetchImpl: (path: string, init?: RequestInit) => Promise<Response>,
  fileId: string,
  tag: string,
): Promise<MobileTagMutationResponse> {
  return requestJson(fetchImpl, getAddMobileTagUrl(), undefined, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId, tag }),
  });
}

export function removeMobileTag(
  fetchImpl: (path: string, init?: RequestInit) => Promise<Response>,
  fileId: string,
  tag: string,
): Promise<MobileTagMutationResponse> {
  return requestJson(fetchImpl, getRemoveMobileTagUrl(), undefined, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId, tag }),
  });
}

export function moveMobileFile(
  fetchImpl: (path: string, init?: RequestInit) => Promise<Response>,
  body: { fileId: string; currentParentId: string; newParentId: string },
): Promise<{ success: boolean }> {
  return requestJson(fetchImpl, getMoveFileUrl(), undefined, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function moveMobileFiles(
  fetchImpl: (path: string, init?: RequestInit) => Promise<Response>,
  body: { fileIds: string[]; currentParentId: string; newParentId: string },
): Promise<{ success: boolean; message?: string }> {
  return requestJson(fetchImpl, getBulkMoveFilesUrl(), undefined, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function deleteMobileFiles(
  fetchImpl: (path: string, init?: RequestInit) => Promise<Response>,
  body: { fileIds: string[]; parentId: string },
): Promise<{ success: boolean; message?: string }> {
  return requestJson(fetchImpl, getBulkDeleteFilesUrl(), undefined, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function deleteManagedMobileFile(
  fetchImpl: (path: string, init?: RequestInit) => Promise<Response>,
  fileId: string,
): Promise<{ success: boolean }> {
  return requestJson(fetchImpl, getDeleteFileUrl(), undefined, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId }),
  });
}

export function unlockMobileLocalStorage(
  fetchImpl: (path: string, init?: RequestInit) => Promise<Response>,
  password: string,
): Promise<MobileLocalStorageUnlockResponse> {
  return requestJson(fetchImpl, getUnlockMobileLocalStorageUrl(), undefined, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

export function listMobileFiles(
  fetchImpl: (path: string, init?: RequestInit) => Promise<Response>,
  params: ListFilesParams,
  signal?: AbortSignal,
): Promise<FileListResponse> {
  return requestJson(fetchImpl, getListFilesUrl(params), signal);
}

export function searchMobileFiles(
  fetchImpl: (path: string, init?: RequestInit) => Promise<Response>,
  params: SearchFilesParams,
  signal?: AbortSignal,
): Promise<FileListResponse> {
  return requestJson(fetchImpl, getSearchFilesUrl(params), signal);
}

export function getMobileFileDetails(
  fetchImpl: (path: string, init?: RequestInit) => Promise<Response>,
  params: GetFileDetailsParams,
  signal?: AbortSignal,
): Promise<DriveFile> {
  return requestJson(fetchImpl, getGetFileDetailsUrl(params), signal);
}

export async function downloadMobileFile(options: {
  origin: string;
  sessionToken: string;
  folderAccessToken?: string;
  localStorageAccessToken?: string;
  params: DownloadFileParams;
  fileName: string;
  signal?: AbortSignal;
  onProgress?: (progress: { bytesWritten: number; totalBytes: number }) => void;
}): Promise<import("expo-file-system").File> {
  const { File, Paths } = await import("expo-file-system");
  const url = buildSameOriginUrl(
    options.origin,
    getDownloadFileUrl(options.params),
  );
  const safeName = sanitizeFileName(options.fileName);
  const destination = new File(Paths.document, `${Date.now()}-${safeName}`);

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${options.sessionToken}`,
    };
    if (options.folderAccessToken) {
      headers["X-Folder-Access-Token"] = options.folderAccessToken;
    }
    if (options.localStorageAccessToken) {
      headers["X-Local-Storage-Token"] = options.localStorageAccessToken;
    }
    return await File.downloadFileAsync(url, destination, {
      headers,
      signal: options.signal,
      onProgress: options.onProgress,
    });
  } catch (cause) {
    if (options.signal?.aborted) throw cause;
    const status =
      cause instanceof Error ? readDownloadErrorStatus(cause.message) : 0;
    const messages: Record<number, string> = {
      401: "Your sign-in has expired. Return to the server screen and sign in again.",
      403: "This server does not allow this file to be downloaded.",
      404: "This file is no longer available.",
      429: "Too many requests. Wait a moment and retry.",
    };
    throw new MobileApiError(
      status || 0,
      messages[status] ??
        "The file could not be downloaded. Check your connection and retry.",
      {
        isLocalAuthNeeded:
          status === 401 && options.params.fileId.startsWith("local-storage:"),
      },
    );
  }
}

export function sanitizeFileName(fileName: string): string {
  const safeName = fileName.replace(/[\\/\u0000-\u001f\u007f]/g, "_").trim();
  return safeName && safeName !== "." && safeName !== ".."
    ? safeName
    : "download";
}

export function buildBulkDownloadRequest(fileIds: string[]): RequestInit {
  if (
    fileIds.length < 1 ||
    fileIds.length > 20 ||
    fileIds.some((id) => !id.trim())
  ) {
    throw new Error("Choose between 1 and 20 files to download.");
  }
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileIds }),
  };
}

function readDownloadErrorStatus(message: string): number {
  const upperMessage = message.toUpperCase();
  for (const label of ["STATUS", "HTTP"]) {
    const labelIndex = upperMessage.indexOf(label);
    if (labelIndex < 0) continue;

    let digitIndex = labelIndex + label.length;
    while (digitIndex < message.length) {
      const character = message[digitIndex];
      if (
        character === " " ||
        character === "\t" ||
        character === "\n" ||
        character === ":" ||
        character === "="
      ) {
        digitIndex += 1;
      } else {
        break;
      }
    }

    const digits = message.slice(digitIndex, digitIndex + 3);
    if (
      digits.length === 3 &&
      [...digits].every((digit) => digit >= "0" && digit <= "9")
    ) {
      return Number(digits);
    }
  }
  return 0;
}

export async function downloadMobileArchive(
  fetchImpl: (path: string, init?: RequestInit) => Promise<Response>,
  fileIds: string[],
): Promise<import("expo-file-system").File> {
  const response = await fetchImpl(
    getBulkDownloadUrl(),
    buildBulkDownloadRequest(fileIds),
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: unknown;
      message?: unknown;
    } | null;
    let message =
      response.status === 401
        ? "Your sign-in has expired. Return to the server screen and sign in again."
        : "The selected files could not be downloaded.";
    if (typeof payload?.error === "string") message = payload.error;
    if (typeof payload?.message === "string") message = payload.message;
    throw new MobileApiError(response.status, message);
  }

  try {
    const { File, Paths } = await import("expo-file-system");
    const archive = new File(
      Paths.document,
      `${Date.now()}-vaehor-download.zip`,
    );
    await archive.write(new Uint8Array(await response.arrayBuffer()));
    return archive;
  } catch {
    throw new MobileApiError(
      response.status,
      "The archive could not be saved on this device. Check available storage and retry.",
    );
  }
}

export type MobileFile = DriveFile & {
  protectedFolderId?: string;
};
