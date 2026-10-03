import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminRoute } from "@/lib/api-middleware";
import { cancelScheduledUploadAsAdmin } from "@/lib/services/scheduled-upload";

const bodySchema = z.object({
  scheduleId: z.string().min(1),
});

export const POST = createAdminRoute(
  async ({ body, session }) => {
    try {
      const schedule = await cancelScheduledUploadAsAdmin(body.scheduleId, {
        email: session.user?.email ?? "",
      });
      return NextResponse.json({ schedule });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        error.status === 404
      ) {
        return NextResponse.json(
          { error: "Scheduled upload not found." },
          {
            status: 404,
          },
        );
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        error.status === 409
      ) {
        return NextResponse.json(
          { error: "Scheduled upload release has started." },
          {
            status: 409,
          },
        );
      }
      throw error;
    }
  },
  { bodySchema },
);
