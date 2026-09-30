import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminRoute } from "@/lib/api-middleware";
import { updateScheduledUploadAdminAlertStatus } from "@/lib/services/scheduled-upload-admin-alert";

const bodySchema = z.object({
  alertId: z.string().min(1),
  status: z.enum(["ACKNOWLEDGED", "RESOLVED"]),
});

export const POST = createAdminRoute(
  async ({ body, session }) => {
    const alert = await updateScheduledUploadAdminAlertStatus({
      alertId: body.alertId,
      status: body.status,
      actorEmail: session.user?.email ?? "",
    });
    if (!alert) {
      return NextResponse.json(
        { error: "Scheduled upload alert not found." },
        {
          status: 404,
        },
      );
    }
    return NextResponse.json({ alert });
  },
  { bodySchema },
);
