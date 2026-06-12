export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createEditorRoute } from "@/lib/api-middleware";
import {
  uploadQuerySchema,
  handleUploadInit,
  handleUploadChunk,
  uploadErrorResponse,
} from "@/lib/services/file-upload";

export const maxDuration = 60;

export const POST = createEditorRoute(
  async ({ request, session, query }) => {
    try {
      if (query.type === "init") {
        return await handleUploadInit(request);
      }

      if (query.type === "chunk") {
        return await handleUploadChunk(
          request,
          query.uploadUrl!,
          query.parentId,
          session,
        );
      }

      return NextResponse.json(
        { error: "Invalid upload type" },
        { status: 400 },
      );
    } catch (error: unknown) {
      return uploadErrorResponse(error);
    }
  },
  { querySchema: uploadQuerySchema },
);
