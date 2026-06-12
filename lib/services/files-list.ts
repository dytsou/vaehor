import { NextResponse, type NextRequest } from "next/server";
import type { Session } from "next-auth";
import { jwtVerify } from "jose";
import { listAllFiles } from "@/lib/storage";
import { ZeeFile } from "@/types/storage";
import { isPrivateFolder } from "@/lib/auth";
import {
  isAccessRestricted,
  getProtectedFolderIdsCached,
} from "@/lib/securityUtils";
import { RequestError, getErrorMessage } from "@/lib/errors";
import {
  authenticateShareRequest,
  shareGrantsAccessToFolder,
  shareGrantsAccessToFile,
  type ShareAuthOk,
} from "@/lib/share-scope";

export type FilesListParams = {
  folderId: string;
  pageToken: string | null;
  forceRefresh: boolean;
  hasShareToken: boolean;
};

export type ShareAccessResult = {
  shareScoped: boolean;
  shareCtx: ShareAuthOk | null;
  error?: NextResponse;
};

export type ProcessedZeeFile = ZeeFile & {
  isFolder: boolean;
  isProtected: boolean;
};

export function parseFilesListParams(request: NextRequest): FilesListParams {
  const { searchParams } = new URL(request.url);
  const rawFolderId =
    searchParams.get("folderId") || process.env.NEXT_PUBLIC_ROOT_FOLDER_ID;

  let folderId = "";
  if (rawFolderId) {
    folderId = decodeURIComponent(rawFolderId)
      .split("&")[0]
      .split("?")[0]
      .trim();
  }

  return {
    folderId,
    pageToken: searchParams.get("pageToken"),
    forceRefresh: searchParams.get("refresh") === "true",
    hasShareToken: searchParams.has("share_token"),
  };
}

export function folderIdMissingResponse(folderId: string): NextResponse | null {
  if (!folderId || folderId === "undefined") {
    return NextResponse.json(
      { error: "Folder ID tidak ditemukan." },
      { status: 400 },
    );
  }
  return null;
}

export async function resolveShareAccess(
  request: NextRequest,
  params: FilesListParams,
): Promise<ShareAccessResult> {
  if (!params.hasShareToken) {
    return { shareScoped: false, shareCtx: null };
  }

  const shareRes = await authenticateShareRequest(request);
  if (!shareRes || "error" in shareRes) {
    return {
      shareScoped: false,
      shareCtx: null,
      error: NextResponse.json(
        {
          error:
            (shareRes && "error" in shareRes && shareRes.error) ||
            "Invalid share token or login required.",
        },
        {
          status: shareRes && "error" in shareRes ? shareRes.status : 401,
        },
      ),
    };
  }

  const allowed = await shareGrantsAccessToFolder(shareRes, params.folderId);
  if (!allowed) {
    return {
      shareScoped: false,
      shareCtx: null,
      error: NextResponse.json(
        { error: "This share link does not allow access to this folder." },
        { status: 403 },
      ),
    };
  }

  return { shareScoped: true, shareCtx: shareRes };
}

async function verifyFolderAccessToken(
  token: string,
  folderId: string,
  userEmail: string | null | undefined,
): Promise<boolean> {
  try {
    const secret = new TextEncoder().encode(process.env.SHARE_SECRET_KEY!);
    const { payload } = await jwtVerify(token, secret);
    const authorizedFolderId = payload.folderId as string;

    if (!authorizedFolderId) {
      return false;
    }

    const stillRestricted = await isAccessRestricted(
      folderId,
      [authorizedFolderId],
      userEmail,
    );
    return !stillRestricted;
  } catch (error) {
    console.error("[Files API] Token verification failed:", error);
    return false;
  }
}

async function ensureLocalStorageAccess(
  request: NextRequest,
): Promise<NextResponse | null> {
  const { checkLocalStorageAccess } = await import("@/lib/auth");
  const hasLocalAccess = await checkLocalStorageAccess(request);

  if (hasLocalAccess) {
    return null;
  }

  return NextResponse.json(
    {
      error: "Autentikasi Local Storage diperlukan",
      isLocalAuthNeeded: true,
    },
    { status: 401 },
  );
}

async function ensureProtectedFolderAccess(
  request: NextRequest,
  folderId: string,
  userEmail: string | null | undefined,
): Promise<NextResponse | null> {
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.split(" ")[1];
  const accessGranted = token
    ? await verifyFolderAccessToken(token, folderId, userEmail)
    : false;

  if (accessGranted || folderId.startsWith("local-storage:")) {
    return null;
  }

  return NextResponse.json(
    {
      error: "Authentication required for this folder.",
      protected: true,
      folderId,
    },
    { status: 401 },
  );
}

export async function ensureRestrictedFolderAccess(
  request: NextRequest,
  folderId: string,
  session: Session | null,
  shareScoped: boolean,
): Promise<NextResponse | null> {
  const userRole = session?.user?.role;
  const userEmail = session?.user?.email;
  const canSeeAll = userRole === "ADMIN";
  const isRestricted = await isAccessRestricted(folderId, [], userEmail);

  if (canSeeAll || !isRestricted || shareScoped) {
    return null;
  }

  if (folderId.startsWith("local-storage:")) {
    return ensureLocalStorageAccess(request);
  }

  return ensureProtectedFolderAccess(request, folderId, userEmail);
}

function buildProtectedFolderMap(
  protectedFolderIds: string[],
): Record<string, boolean> {
  return Object.fromEntries(protectedFolderIds.map((id) => [id, true]));
}

async function filterFilesForUser(
  files: ZeeFile[],
  canSeeAll: boolean,
  userEmail: string | null | undefined,
  protectedFolderMap: Record<string, boolean>,
): Promise<ZeeFile[]> {
  if (canSeeAll) {
    return files;
  }

  const privateFoldersToCheck = files.filter((file) =>
    isPrivateFolder(file.id),
  );
  const accessMap =
    userEmail && privateFoldersToCheck.length > 0
      ? await import("@/lib/auth").then((module) =>
          module.hasUserAccessBatch(
            userEmail,
            privateFoldersToCheck.map((file) => file.id),
          ),
        )
      : {};

  return files.filter((file) => {
    const isPriv = isPrivateFolder(file.id);
    const isProt = !!protectedFolderMap[file.id];

    if (!isPriv) return true;
    if (accessMap[file.id]) return true;
    if (isProt) return true;
    return false;
  });
}

function processFilesForResponse(
  files: ZeeFile[],
  protectedFolderMap: Record<string, boolean>,
  canSeeAll: boolean,
): ProcessedZeeFile[] {
  return files.map((file) => {
    const fileId = file.id as string;
    const isProt = !!protectedFolderMap[fileId];
    const isPriv = isPrivateFolder(fileId);

    return {
      ...file,
      isFolder: file.mimeType === "application/vnd.google-apps.folder",
      isProtected: (isProt || isPriv) && !canSeeAll,
    };
  });
}

export async function loadFolderListing(
  folderId: string,
  pageToken: string | null,
  forceRefresh: boolean,
  canSeeAll: boolean,
  userEmail: string | null | undefined,
) {
  const [driveResponse, protectedFolderIds] = await Promise.all([
    listAllFiles({
      folderId,
      pageToken: pageToken || undefined,
      pageSize: 50,
      useCache: !forceRefresh,
    }),
    getProtectedFolderIdsCached(),
  ]);

  const protectedFolderMap = buildProtectedFolderMap(protectedFolderIds);
  const filteredFiles = await filterFilesForUser(
    driveResponse.files,
    canSeeAll,
    userEmail,
    protectedFolderMap,
  );
  const processedFiles = processFilesForResponse(
    filteredFiles,
    protectedFolderMap,
    canSeeAll,
  );

  return { driveResponse, processedFiles };
}

export async function filterByShareScope(
  processedFiles: ProcessedZeeFile[],
  shareCtx: ShareAuthOk | null,
): Promise<ProcessedZeeFile[]> {
  const shareParsed = shareCtx?.parsed;

  if (shareParsed?.kind === "file") {
    const { fileId: sharedFileId } = shareParsed;
    return processedFiles.filter((file) => file.id === sharedFileId);
  }

  if (shareParsed?.kind === "collection" && shareCtx) {
    const accessChecks = await Promise.all(
      processedFiles.map(async (file) => ({
        file,
        allowed: await shareGrantsAccessToFile(shareCtx, file.id as string),
      })),
    );
    return accessChecks
      .filter((entry) => entry.allowed)
      .map((entry) => entry.file);
  }

  return processedFiles;
}

export function logShareLinkAccessIfNeeded(
  shareScoped: boolean,
  folderId: string,
  userEmail: string | null | undefined,
) {
  if (!shareScoped) {
    return;
  }

  import("@/lib/activityLogger").then((module) => {
    module.logActivity("SHARE_LINK_ACCESSED", {
      itemName: "Folder View",
      itemId: folderId,
      userEmail: userEmail || "Guest",
      status: "success",
    });
  });
}

export function filesListErrorResponse(error: unknown) {
  const requestError =
    error instanceof RequestError
      ? error
      : new RequestError(getErrorMessage(error), {
          cause: error,
        });

  if (!requestError.isProtected) {
    console.error(error);
  }

  return NextResponse.json(
    {
      error: requestError.message,
      protected: requestError.isProtected,
      folderId: requestError.folderId,
    },
    {
      status: requestError.status || (requestError.isProtected ? 401 : 500),
    },
  );
}
