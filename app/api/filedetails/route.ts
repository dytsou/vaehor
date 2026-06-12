import { NextResponse } from "next/server";
import { createPublicRoute } from "@/lib/api-middleware";
import {
  resolveFileDetailsAuth,
  parseFileIdParam,
  ensureShareFileAccess,
  ensureFileDetailsAccess,
  loadFileDetails,
  fileDetailsFetchErrorResponse,
} from "@/lib/services/file-details";

export const dynamic = "force-dynamic";

export const GET = createPublicRoute(
  async ({ request, session }) => {
    const { searchParams } = new URL(request.url);

    const auth = await resolveFileDetailsAuth(
      request,
      searchParams.has("share_token"),
      session,
    );
    if (auth.error) {
      return auth.error;
    }

    const fileIdResult = parseFileIdParam(searchParams);
    if (!fileIdResult.ok) {
      return fileIdResult.error;
    }

    const shareDenied = await ensureShareFileAccess(
      auth.shareAuthOk,
      fileIdResult.fileId,
    );
    if (shareDenied) {
      return shareDenied;
    }

    const accessDenied = await ensureFileDetailsAccess(
      request,
      fileIdResult.fileId,
      session,
      auth.shareAuthOk,
    );
    if (accessDenied) {
      return accessDenied;
    }

    try {
      const details = await loadFileDetails(fileIdResult.fileId);
      return NextResponse.json(details);
    } catch (error: unknown) {
      return fileDetailsFetchErrorResponse(error);
    }
  },
  { includeSession: true, rateLimit: false },
);
