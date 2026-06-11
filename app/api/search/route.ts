import { NextResponse } from "next/server";
import { createPublicRoute } from "@/lib/api-middleware";
import { getAccessToken, DriveFile } from "@/lib/drive";
import {
  authenticateShareRequest,
  shareGrantsAccessToFolder,
} from "@/lib/share-scope";
import { isAccessRestricted } from "@/lib/securityUtils";
import { jwtVerify } from "jose";
import { kv } from "@/lib/kv";
import { db } from "@/lib/db";

const CACHE_TTL = 3600;

const sanitizeString = (str: string) => str.replace(/<[^>]*>?/gm, "");
const getMimeQuery = (mimeType?: string | null) => {
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
};

const getDateQuery = (modifiedTime?: string | null) => {
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
};

export const dynamic = "force-dynamic";
export const GET = createPublicRoute(
  async ({ request, session }) => {
    const { searchParams } = new URL(request.url);
    const hasShareToken = searchParams.has("share_token");
    const rawSearchTerm = searchParams.get("q");
    const folderId = searchParams.get("folderId");

    if (hasShareToken && !folderId) {
      return NextResponse.json(
        {
          error: "Folder-scoped search is required when using a share link.",
        },
        { status: 403 },
      );
    }

    let shareCtx: Awaited<ReturnType<typeof authenticateShareRequest>> = null;
    if (hasShareToken && folderId) {
      const shareRes = await authenticateShareRequest(request);
      if (!shareRes || "error" in shareRes) {
        return NextResponse.json(
          {
            error:
              (shareRes && "error" in shareRes && shareRes.error) ||
              "Invalid share token.",
          },
          {
            status: shareRes && "error" in shareRes ? shareRes.status : 401,
          },
        );
      }
      const allowed = await shareGrantsAccessToFolder(shareRes, folderId);
      if (!allowed) {
        return NextResponse.json(
          { error: "This share link does not allow search in this folder." },
          { status: 403 },
        );
      }
      shareCtx = shareRes;
    }
    const searchType = searchParams.get("searchType") || "name";
    const mimeType = searchParams.get("mimeType");
    const modifiedTime = searchParams.get("modifiedTime");
    const minSize = searchParams.get("minSize");

    if (!rawSearchTerm && !mimeType && !modifiedTime && !minSize) {
      return NextResponse.json(
        { error: "Search criteria is required." },
        { status: 400 },
      );
    }

    const sanitizedSearchTerm = rawSearchTerm
      ? sanitizeString(rawSearchTerm)
      : "";
    const searchTerm = sanitizedSearchTerm.replace(/'/g, "''");

    const useSearchCache = session?.user?.role === "ADMIN" && !hasShareToken;

    const cacheKey = `search:${JSON.stringify({
      q: searchTerm,
      folderId,
      searchType,
      mimeType,
      modifiedTime,
      minSize,
      isAdmin: session?.user?.role === "ADMIN",
    })}`;

    let cachedData = null;
    if (useSearchCache) {
      try {
        cachedData = await kv.get(cacheKey);
      } catch {}
    }

    if (cachedData) {
      return NextResponse.json(cachedData);
    }

    try {
      const accessToken = await getAccessToken();
      const driveUrl = "https://www.googleapis.com/drive/v3/files";
      const queryField = searchType === "fullText" ? "fullText" : "name";

      let driveQuery = "trashed=false";
      if (searchTerm) {
        driveQuery += ` and ${queryField} contains '${searchTerm}'`;
      }

      const fileIdPattern = /^[a-zA-Z0-9_-]+$/;
      if (folderId) {
        if (!fileIdPattern.test(folderId) || folderId.length > 100) {
          return NextResponse.json(
            { error: "Invalid folderId format." },
            { status: 400 },
          );
        }
        driveQuery += ` and '${folderId}' in parents`;
      }

      driveQuery += getMimeQuery(mimeType);
      driveQuery += getDateQuery(modifiedTime);
      if (minSize) {
        const bytes = parseInt(minSize) * 1024 * 1024;
        driveQuery += ` and size > ${bytes}`;
      }

      const params = new URLSearchParams({
        q: driveQuery,
        fields:
          "files(id, name, mimeType, size, modifiedTime, createdTime, webViewLink, thumbnailLink, hasThumbnail, parents)",
        pageSize: "100",
      });
      const response = await fetch(`${driveUrl}?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        next: { revalidate: 3600 },
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Google Drive API Error: ${errorData.error.message}`);
      }

      const data = await response.json();

      const isAdmin = session?.user?.role === "ADMIN";
      const authHeader = request.headers.get("Authorization");
      const token = authHeader?.split(" ")[1];
      const allowedTokens: string[] = [];

      if (token) {
        try {
          const secret = new TextEncoder().encode(
            process.env.SHARE_SECRET_KEY!,
          );
          const { payload } = await jwtVerify(token, secret);
          if (payload.folderId) {
            allowedTokens.push(payload.folderId as string);
          }
        } catch {}
      }

      const [allProtectedFolders, isPrivFolder] = await Promise.all([
        db.protectedFolder
          .findMany({ select: { folderId: true } })
          .then((res: { folderId: string }[]) => {
            const map: Record<string, boolean> = {};
            res.forEach((r: { folderId: string }) => (map[r.folderId] = true));
            return map;
          }),
        import("@/lib/auth").then((m) => m.isPrivateFolder),
      ]);

      const processedFiles = (data.files || []).map((file: DriveFile) => {
        const isFolder = file.mimeType === "application/vnd.google-apps.folder";
        const fileId = file.id;
        const isProt = !!allProtectedFolders[fileId];
        const isPriv = isPrivFolder(fileId);

        return {
          ...file,
          isFolder,
          isProtected: isProt || isPriv,
        };
      });

      const filteredFiles = await Promise.all(
        processedFiles.map(async (file: DriveFile) => {
          if (isAdmin) return file;
          const restricted = await isAccessRestricted(
            file.id,
            allowedTokens,
            session?.user?.email,
          );
          return restricted ? null : file;
        }),
      );

      let visibleFiles = filteredFiles.filter((f) => f !== null);
      if (
        shareCtx &&
        !("error" in shareCtx) &&
        shareCtx.parsed.kind === "file"
      ) {
        visibleFiles = visibleFiles.filter(
          (f) => f !== null && f.id === shareCtx.parsed.fileId,
        );
      }

      const result = {
        files: visibleFiles,
        nextPageToken: data.nextPageToken,
      };

      if (useSearchCache) {
        try {
          await kv.set(cacheKey, result, { ex: CACHE_TTL });
        } catch {}
      }

      return NextResponse.json(result);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Terjadi kesalahan tidak dikenal.";
      return NextResponse.json(
        { error: "Failed to perform search.", details: errorMessage },
        { status: 500 },
      );
    }
  },
  { includeSession: true, rateLimit: false },
);
