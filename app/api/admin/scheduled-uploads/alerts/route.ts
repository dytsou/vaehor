import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminRoute } from "@/lib/api-middleware";
import { listScheduledUploadAdminAlerts } from "@/lib/services/scheduled-upload-admin-alert";

const querySchema = z.object({
  status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED"]).optional(),
});

export const dynamic = "force-dynamic";

export const GET = createAdminRoute(async ({ request }) => {
  const parsed = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid alert status." },
      { status: 400 },
    );
  }

  const alerts = await listScheduledUploadAdminAlerts(parsed.data.status);
  return NextResponse.json({ alerts });
});
