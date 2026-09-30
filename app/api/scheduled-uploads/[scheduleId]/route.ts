import { NextResponse } from "next/server";
import { z } from "zod";
import { createUserRoute } from "@/lib/api-middleware";
import {
  cancelScheduledUpload,
  getScheduledUpload,
  readBoundedJson,
  updateScheduledUploadTime,
} from "@/lib/services/scheduled-upload";

export const dynamic = "force-dynamic";

const scheduleParamsSchema = z.object({
  scheduleId: z.string().min(1).max(128),
});
const noStore = { "Cache-Control": "private, no-store" };

export const GET = createUserRoute(
  async ({ params, session }) => {
    const schedule = await getScheduledUpload(params.scheduleId, {
      email: session.user.email ?? "",
    });
    return NextResponse.json({ schedule }, { headers: noStore });
  },
  { paramsSchema: scheduleParamsSchema },
);

export const PATCH = createUserRoute(
  async ({ params, request, session }) => {
    const body = await readBoundedJson(request);
    const schedule = await updateScheduledUploadTime(params.scheduleId, body, {
      email: session.user.email ?? "",
    });
    return NextResponse.json({ schedule }, { headers: noStore });
  },
  { paramsSchema: scheduleParamsSchema },
);

export const DELETE = createUserRoute(
  async ({ params, session }) => {
    const schedule = await cancelScheduledUpload(params.scheduleId, {
      email: session.user.email ?? "",
    });
    return NextResponse.json({ schedule }, { headers: noStore });
  },
  { paramsSchema: scheduleParamsSchema },
);
