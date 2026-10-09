import { NextResponse } from "next/server";
import { z } from "zod";
import { createUserRoute } from "@/lib/api-middleware";
import {
  readScheduledUploadItemContent,
  stageScheduledUploadItem,
} from "@/lib/services/scheduled-upload";

export const dynamic = "force-dynamic";
export const maxDuration = 900;

const paramsSchema = z.object({
  scheduleId: z.string().min(1).max(128),
  itemId: z.string().min(1).max(128),
});

export const GET = createUserRoute(
  async ({ params, session }) => {
    const content = await readScheduledUploadItemContent(
      params.scheduleId,
      params.itemId,
      { email: session.user.email ?? "" },
    );
    return new Response(content.stream, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(content.fileName)}`,
        "Content-Length": String(content.size),
        "Content-Type": "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
  { paramsSchema },
);

export const PUT = createUserRoute(
  async ({ params, request, session }) => {
    const result = await stageScheduledUploadItem({
      scheduleId: params.scheduleId,
      itemId: params.itemId,
      actor: { email: session.user.email ?? "" },
      body: request.body,
      contentLength: request.headers.get("content-length"),
    });
    return NextResponse.json(
      { item: result },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  },
  { paramsSchema },
);
