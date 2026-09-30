import { NextResponse } from "next/server";
import { z } from "zod";
import { createUserRoute } from "@/lib/api-middleware";
import { retryScheduledUpload } from "@/lib/services/scheduled-upload";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ scheduleId: z.string().min(1).max(128) });

export const POST = createUserRoute(
  async ({ params, session }) => {
    const schedule = await retryScheduledUpload(params.scheduleId, {
      email: session.user.email ?? "",
    });
    return NextResponse.json(
      { schedule },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  },
  { paramsSchema },
);
