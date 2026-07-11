import { NextResponse } from "next/server";
import { createPublicRoute } from "@/lib/api-middleware";
import {
  parseFolderPathParams,
  missingFolderIdResponse,
  resolveFolderPathShareAccess,
  ensurePrivateFolderAccess,
  tryCachedOrStaticPath,
  fetchDriveFolderPath,
  folderPathErrorResponse,
} from "@/lib/services/folder-path";

export const dynamic = "force-dynamic";

export const GET = createPublicRoute(
  async ({ request, session }) => {
    const params = parseFolderPathParams(new URL(request.url).searchParams);

    const shareAccess = await resolveFolderPathShareAccess(
      request,
      params.hasShareToken,
      params.folderId,
      params.locale,
    );
    if (shareAccess.error) {
      return shareAccess.error;
    }

    if (params.rawFolderId) {
      const privateDenied = ensurePrivateFolderAccess(
        params.rawFolderId,
        session,
        shareAccess.shareScoped,
      );
      if (privateDenied) {
        return privateDenied;
      }
    }

    if (!params.folderId) {
      return missingFolderIdResponse(params.locale);
    }

    const cacheKey = `vaehor:folder-path-v7:${params.folderId}:${params.locale}`;
    const staticOrCached = await tryCachedOrStaticPath(
      params.folderId,
      params.locale,
      cacheKey,
    );
    if (staticOrCached) {
      return staticOrCached;
    }

    try {
      const path = await fetchDriveFolderPath(
        params.folderId,
        params.locale,
        cacheKey,
      );
      return NextResponse.json(path);
    } catch (error: unknown) {
      return folderPathErrorResponse(error);
    }
  },
  { includeSession: true, rateLimit: false },
);
