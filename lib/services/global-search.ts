import { NextResponse, type NextRequest } from "next/server";
import type { Session } from "next-auth";
import { jwtVerify } from "jose";
import {
  getAccessToken,
  type DriveFile,
  getAllDescendantFolders,
  searchFilesInFolder,
} from "@/lib/drive";
import { isProtected } from "@/lib/auth";
import { isAccessRestricted } from "@/lib/securityUtils";
import { logger } from "@/lib/logger";

export type GlobalSearchParams = {
  searchTerm: string;
  searchType: string;
  mimeType: string | null;
  modifiedTime: string | null;
  rootFolderId: string;
};

export type GlobalSearchParamsResult =
  | { ok: true; params: GlobalSearchParams }
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
  const now = new Date();
  let dateString = "";

  if (modifiedTime === "today") {
    dateString = new Date(now.setHours(0, 0, 0, 0)).toISOString();
  } else if (modifiedTime === "week") {
    const lastWeek = new Date(now.setDate(now.getDate() - 7));
    dateString = new Date(lastWeek.setHours(0, 0, 0, 0)).toISOString();
  } else if (modifiedTime === "month") {
    const lastMonth = new Date(now.setMonth(now.getMonth() - 1));
    dateString = new Date(lastMonth.setHours(0, 0, 0, 0)).toISOString();
  }

  if (dateString) {
    return ` and modifiedTime > '${dateString}'`;
  }
  return "";
}

export function validateGlobalSearchAccess(
  request: NextRequest,
  session: Session | null,
): NextResponse | null {
  const { searchParams } = new URL(request.url);

  if (searchParams.has("share_token")) {
    return NextResponse.json(
      { error: "Global search is not available with a share link." },
      { status: 403 },
    );
  }

  if (!session) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  return null;
}

export function parseGlobalSearchParams(
  searchParams: URLSearchParams,
): GlobalSearchParamsResult {
  const rawSearchTerm = searchParams.get("q");
  const rootFolderId = process.env.NEXT_PUBLIC_ROOT_FOLDER_ID;

  if (!rawSearchTerm) {
    return {
      ok: false,
      error: NextResponse.json(
        { error: "Search term is required." },
        { status: 400 },
      ),
    };
  }

  if (!rootFolderId) {
    return {
      ok: false,
      error: NextResponse.json(
        { error: "Root folder ID is not configured." },
        { status: 500 },
      ),
    };
  }

  const sanitizedSearchTerm = sanitizeString(rawSearchTerm);

  return {
    ok: true,
    params: {
      searchTerm: sanitizedSearchTerm.replaceAll("'", "''"),
      searchType: searchParams.get("searchType") || "name",
      mimeType: searchParams.get("mimeType"),
      modifiedTime: searchParams.get("modifiedTime"),
      rootFolderId,
    },
  };
}

function collectFulfilledSearchResults(
  results: PromiseSettledResult<DriveFile[]>[],
): DriveFile[] {
  const allFiles: DriveFile[] = [];

  for (const result of results) {
    if (result.status === "fulfilled" && result.value.length > 0) {
      allFiles.push(...result.value);
      continue;
    }

    if (result.status === "rejected") {
      console.error("Sebagian pencarian global gagal:", result.reason);
    }
  }

  return allFiles;
}

function dedupeFiles(files: DriveFile[]): DriveFile[] {
  const uniqueFiles = new Map<string, DriveFile>();

  for (const file of files) {
    if (!uniqueFiles.has(file.id)) {
      uniqueFiles.set(file.id, file);
    }
  }

  return Array.from(uniqueFiles.values());
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

type ProcessedSearchFile = DriveFile & {
  isFolder: boolean;
  isProtected: boolean;
};

async function processSearchFiles(
  files: DriveFile[],
): Promise<ProcessedSearchFile[]> {
  return Promise.all(
    files.map(async (file) => {
      const isFolder = file.mimeType === "application/vnd.google-apps.folder";
      const protectedFolder = isFolder ? await isProtected(file.id) : false;

      return {
        ...file,
        isFolder,
        isProtected: protectedFolder,
      };
    }),
  );
}

async function filterFilesByAccess(
  files: ProcessedSearchFile[],
  session: Session,
  allowedTokens: string[],
) {
  const isAdmin = session.user?.role === "ADMIN";

  const filtered = await Promise.all(
    files.map(async (file) => {
      if (isAdmin) return file;
      const restricted = await isAccessRestricted(file.id, allowedTokens);
      return restricted ? null : file;
    }),
  );

  return filtered.filter((file) => file !== null);
}

export async function executeGlobalSearch(
  request: NextRequest,
  session: Session,
  params: GlobalSearchParams,
) {
  const accessToken = await getAccessToken();
  const descendantFolderIds = await getAllDescendantFolders(
    accessToken,
    params.rootFolderId,
  );
  const queryField = params.searchType === "fullText" ? "fullText" : "name";
  const mimeQuery = getMimeQuery(params.mimeType);
  const dateQuery = getDateQuery(params.modifiedTime);

  const results = await Promise.allSettled(
    descendantFolderIds.map((folderId) =>
      searchFilesInFolder(
        accessToken,
        folderId,
        params.searchTerm,
        queryField,
        mimeQuery,
        dateQuery,
      ),
    ),
  );

  const uniqueFiles = dedupeFiles(collectFulfilledSearchResults(results));
  const allowedTokens = await extractAllowedFolderTokens(request);
  const processedFiles = await processSearchFiles(uniqueFiles);

  return filterFilesByAccess(processedFiles, session, allowedTokens);
}

export function globalSearchErrorResponse(error: unknown) {
  logger.error({ err: error }, "Global search API failed");
  return NextResponse.json(
    { error: "Failed to perform global search." },
    { status: 500 },
  );
}
