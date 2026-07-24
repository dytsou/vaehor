import { NextResponse, type NextRequest } from "next/server";
import type { Session } from "next-auth";
import { jwtVerify } from "jose";
import { getAccessToken, type DriveFile } from "@/lib/drive";
import {
  authenticateShareRequest,
  shareGrantsAccessToFolder,
  type ShareAuthOk,
} from "@/lib/share-scope";
import { isAccessRestricted } from "@/lib/securityUtils";
import { kv } from "@/lib/kv";
import { db } from "@/lib/db";

const CACHE_TTL = 3600;
const FILE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export type FolderSearchParams = {
  searchTerm: string;
  folderId: string | null;
  searchType: string;
  mimeType: string | null;
  modifiedTime: string | null;
  minSize: string | null;
};

export type FolderSearchParamsResult =
  | { ok: true; params: FolderSearchParams }
  | { ok: false; error: NextResponse };

const sanitizeString = (str: string) => str.replaceAll(/<[^>]*>?/gm, "");

function getMimeQuery(mimeType?: string | null) {
  switch (mimeType) {
    case "image":
      return " and mimeType contains 'image/'";
    case "video":
      return " and mimeType contains 'video/'";
    case "audio":
      return " and mimeType contains 'audio/'";
    case "pdf":
      return " and mimeType = 'application/pdf'";
    case "folder":
      return " and mimeType = 'application/vnd.google-apps.folder'";
    default:
      return "";
  }
}

function getDateQuery(modifiedTime?: string | null) {
  const now = Date.now();
  let dateString = "";

  if (modifiedTime === "today") {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    dateString = today.toISOString();
  } else if (modifiedTime === "week") {
    const lastWeek = new Date(now - 7 * 24 * 60 * 60 * 1000);
    lastWeek.setHours(0, 0, 0, 0);
    dateString = lastWeek.toISOString();
  } else if (modifiedTime === "month") {
    const lastMonth = new Date(now);
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    lastMonth.setHours(0, 0, 0, 0);
    dateString = lastMonth.toISOString();
  }

  if (dateString) {
    return ` and modifiedTime > '${dateString}'`;
  }
  return "";
}

export async function resolveFolderSearchShareAccess(
  request: NextRequest,
  hasShareToken: boolean,
  folderId: string | null,
): Promise<{ shareCtx: ShareAuthOk | null; error?: NextResponse }> {
  if (!hasShareToken) {
    return { shareCtx: null };
  }

  if (!folderId) {
    return {
      shareCtx: null,
      error: NextResponse.json(
        {
          error: "Folder-scoped search is required when using a share link.",
        },
        { status: 403 },
      ),
    };
  }

  const shareRes = await authenticateShareRequest(request);
  if (!shareRes || "error" in shareRes) {
    return {
      shareCtx: null,
      error: NextResponse.json(
        {
          error:
            (shareRes && "error" in shareRes && shareRes.error) ||
            "Invalid share token.",
        },
        {
          status: shareRes && "error" in shareRes ? shareRes.status : 401,
        },
      ),
    };
  }

  const allowed = await shareGrantsAccessToFolder(shareRes, folderId);
  if (!allowed) {
    return {
      shareCtx: null,
      error: NextResponse.json(
        { error: "This share link does not allow search in this folder." },
        { status: 403 },
      ),
    };
  }

  return { shareCtx: shareRes };
}

export function parseFolderSearchParams(
  searchParams: URLSearchParams,
): FolderSearchParamsResult {
  const rawSearchTerm = searchParams.get("q");
  const mimeType = searchParams.get("mimeType");
  const modifiedTime = searchParams.get("modifiedTime");
  const minSize = searchParams.get("minSize");

  if (!rawSearchTerm && !mimeType && !modifiedTime && !minSize) {
    return {
      ok: false,
      error: NextResponse.json(
        { error: "Search criteria is required." },
        { status: 400 },
      ),
    };
  }

  const sanitizedSearchTerm = rawSearchTerm
    ? sanitizeString(rawSearchTerm)
    : "";

  return {
    ok: true,
    params: {
      searchTerm: sanitizedSearchTerm.replaceAll("'", "''"),
      folderId: searchParams.get("folderId"),
      searchType: searchParams.get("searchType") || "name",
      mimeType,
      modifiedTime,
      minSize,
    },
  };
}

function buildSearchCacheKey(
  params: FolderSearchParams,
  session: Session | null,
) {
  return `search:${JSON.stringify({
    q: params.searchTerm,
    folderId: params.folderId,
    searchType: params.searchType,
    mimeType: params.mimeType,
    modifiedTime: params.modifiedTime,
    minSize: params.minSize,
    isAdmin: session?.user?.role === "ADMIN",
  })}`;
}

function shouldUseSearchCache(
  session: Session | null,
  hasShareToken: boolean,
): boolean {
  return session?.user?.role === "ADMIN" && !hasShareToken;
}

export async function getCachedSearchResult(
  session: Session | null,
  hasShareToken: boolean,
  params: FolderSearchParams,
) {
  if (!shouldUseSearchCache(session, hasShareToken)) {
    return null;
  }

  try {
    return await kv.get(buildSearchCacheKey(params, session));
  } catch {
    return null;
  }
}

export function buildDriveSearchQuery(
  params: FolderSearchParams,
): { ok: true; query: string } | { ok: false; error: NextResponse } {
  const queryField = params.searchType === "fullText" ? "fullText" : "name";
  let driveQuery = "trashed=false";

  if (params.searchTerm) {
    driveQuery += ` and ${queryField} contains '${params.searchTerm}'`;
  }

  if (params.folderId) {
    if (
      !FILE_ID_PATTERN.test(params.folderId) ||
      params.folderId.length > 100
    ) {
      return {
        ok: false,
        error: NextResponse.json(
          { error: "Invalid folderId format." },
          { status: 400 },
        ),
      };
    }
    driveQuery += ` and '${params.folderId}' in parents`;
  }

  driveQuery += getMimeQuery(params.mimeType);
  driveQuery += getDateQuery(params.modifiedTime);

  if (params.minSize) {
    const bytes = Number.parseInt(params.minSize, 10) * 1024 * 1024;
    driveQuery += ` and size > ${bytes}`;
  }

  return { ok: true, query: driveQuery };
}

async function fetchDriveSearchResults(
  driveQuery: string,
  accessToken: string,
) {
  const params = new URLSearchParams({
    q: driveQuery,
    fields:
      "files(id, name, mimeType, size, modifiedTime, createdTime, webViewLink, thumbnailLink, hasThumbnail, parents)",
    pageSize: "100",
  });

  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      next: { revalidate: 3600 },
    },
  );

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Google Drive API Error: ${errorData.error.message}`);
  }

  return response.json();
}

async function extractAllowedFolderTokens(
  request: NextRequest,
): Promise<string[]> {
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.split(" ")[1];
  if (!token) {
    return [];
  }

  try {
    const secret = new TextEncoder().encode(process.env.SHARE_SECRET_KEY!);
    const { payload } = await jwtVerify(token, secret);
    if (payload.folderId) {
      return [payload.folderId as string];
    }
  } catch {
    // Ignore invalid folder access tokens.
  }

  return [];
}

async function loadProtectedFolderMap() {
  const rows = await db.protectedFolder.findMany({
    select: { folderId: true },
  });
  return Object.fromEntries(rows.map((row) => [row.folderId, true]));
}

type ProcessedSearchFile = DriveFile & {
  isFolder: boolean;
  isProtected: boolean;
};

async function processSearchFiles(
  files: DriveFile[],
  protectedFolderMap: Record<string, boolean>,
  isPrivateFolder: (folderId: string) => boolean,
): Promise<ProcessedSearchFile[]> {
  return files.map((file) => {
    const isFolder = file.mimeType === "application/vnd.google-apps.folder";
    const isProt = !!protectedFolderMap[file.id];
    const isPriv = isPrivateFolder(file.id);

    return {
      ...file,
      isFolder,
      isProtected: isProt || isPriv,
    };
  });
}

async function filterFilesByAccess(
  files: ProcessedSearchFile[],
  session: Session | null,
  allowedTokens: string[],
) {
  const isAdmin = session?.user?.role === "ADMIN";

  const filtered = await Promise.all(
    files.map(async (file) => {
      if (isAdmin) return file;
      const restricted = await isAccessRestricted(
        file.id,
        allowedTokens,
        session?.user?.email,
      );
      return restricted ? null : file;
    }),
  );

  return filtered.filter((file) => file !== null);
}

function applyShareFileFilter(
  files: ProcessedSearchFile[],
  shareCtx: ShareAuthOk | null,
) {
  const shareParsed = shareCtx?.parsed;
  if (shareParsed?.kind !== "file") {
    return files;
  }

  const { fileId: sharedFileId } = shareParsed;
  return files.filter((file) => file.id === sharedFileId);
}

async function cacheSearchResult(
  session: Session | null,
  hasShareToken: boolean,
  params: FolderSearchParams,
  result: unknown,
) {
  if (!shouldUseSearchCache(session, hasShareToken)) {
    return;
  }

  try {
    await kv.set(buildSearchCacheKey(params, session), result, {
      ex: CACHE_TTL,
    });
  } catch {
    // Ignore cache write failures.
  }
}

export async function executeFolderSearch(
  request: NextRequest,
  session: Session | null,
  shareCtx: ShareAuthOk | null,
  params: FolderSearchParams,
  hasShareToken: boolean,
  driveQuery: string,
) {
  const accessToken = await getAccessToken();
  const data = await fetchDriveSearchResults(driveQuery, accessToken);
  const [protectedFolderMap, { isPrivateFolder }] = await Promise.all([
    loadProtectedFolderMap(),
    import("@/lib/auth"),
  ]);
  const allowedTokens = await extractAllowedFolderTokens(request);
  const processedFiles = await processSearchFiles(
    data.files || [],
    protectedFolderMap,
    isPrivateFolder,
  );
  const visibleFiles = applyShareFileFilter(
    await filterFilesByAccess(processedFiles, session, allowedTokens),
    shareCtx,
  );

  const result = {
    files: visibleFiles,
    nextPageToken: data.nextPageToken,
  };

  await cacheSearchResult(session, hasShareToken, params, result);
  return result;
}

export function folderSearchErrorResponse(error: unknown) {
  const errorMessage =
    error instanceof Error ? error.message : "Terjadi kesalahan tidak dikenal.";
  return NextResponse.json(
    { error: "Failed to perform search.", details: errorMessage },
    { status: 500 },
  );
}
