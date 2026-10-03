import { NextResponse } from "next/server";
import { createCronRoute } from "@/lib/api-middleware";
import { runScheduledUploadWorkerTick } from "@/lib/services/scheduled-upload-worker";

export const dynamic = "force-dynamic";

export const GET = createCronRoute(async () => {
  const summary = await runScheduledUploadWorkerTick();
  return NextResponse.json({
    success: true,
    summary,
  });
});
