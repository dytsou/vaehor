import { NextResponse } from "next/server";
import { createPublicRoute } from "@/lib/api-middleware";
import {
  parseFilesListParams,
  folderIdMissingResponse,
  resolveShareAccess,
  ensureRestrictedFolderAccess,
  loadFolderListing,
  filterByShareScope,
  logShareLinkAccessIfNeeded,
  filesListErrorResponse,
} from "@/lib/services/files-list";

export const dynamic = "force-dynamic";

export const GET = createPublicRoute(
  async ({ request, session }) => {
    try {
      const params = parseFilesListParams(request);

      const missingFolderResponse = folderIdMissingResponse(params.folderId);
      if (missingFolderResponse) {
        return missingFolderResponse;
      }

      const shareAccess = await resolveShareAccess(request, params);
      if (shareAccess.error) {
        return shareAccess.error;
      }

      const accessDenied = await ensureRestrictedFolderAccess(
        request,
        params.folderId,
        session,
        shareAccess.shareScoped,
      );
      if (accessDenied) {
        return accessDenied;
      }

      const canSeeAll = session?.user?.role === "ADMIN";
      const { driveResponse, processedFiles } = await loadFolderListing(
        params.folderId,
        params.pageToken,
        params.forceRefresh,
        canSeeAll,
        session?.user?.email,
      );

      const responseFiles = await filterByShareScope(
        processedFiles,
        shareAccess.shareCtx,
      );

      logShareLinkAccessIfNeeded(
        shareAccess.shareScoped,
        params.folderId,
        session?.user?.email,
      );

      return NextResponse.json({
        files: responseFiles,
        nextPageToken: driveResponse.nextPageToken,
      });
    } catch (error: unknown) {
      return filesListErrorResponse(error);
    }
  },
  { includeSession: true, rateLimit: false },
);
