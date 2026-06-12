import { NextResponse } from "next/server";
import { createPublicRoute } from "@/lib/api-middleware";
import {
  resolveFolderSearchShareAccess,
  parseFolderSearchParams,
  getCachedSearchResult,
  buildDriveSearchQuery,
  executeFolderSearch,
  folderSearchErrorResponse,
} from "@/lib/services/folder-search";

export const dynamic = "force-dynamic";

export const GET = createPublicRoute(
  async ({ request, session }) => {
    const searchParams = new URL(request.url).searchParams;
    const hasShareToken = searchParams.has("share_token");
    const folderId = searchParams.get("folderId");

    const shareAccess = await resolveFolderSearchShareAccess(
      request,
      hasShareToken,
      folderId,
    );
    if (shareAccess.error) {
      return shareAccess.error;
    }

    const paramsResult = parseFolderSearchParams(searchParams);
    if (!paramsResult.ok) {
      return paramsResult.error;
    }

    const cached = await getCachedSearchResult(
      session,
      hasShareToken,
      paramsResult.params,
    );
    if (cached) {
      return NextResponse.json(cached);
    }

    const queryResult = buildDriveSearchQuery(paramsResult.params);
    if (!queryResult.ok) {
      return queryResult.error;
    }

    try {
      const result = await executeFolderSearch(
        request,
        session,
        shareAccess.shareCtx,
        paramsResult.params,
        hasShareToken,
        queryResult.query,
      );
      return NextResponse.json(result);
    } catch (error: unknown) {
      return folderSearchErrorResponse(error);
    }
  },
  { includeSession: true, rateLimit: false },
);
