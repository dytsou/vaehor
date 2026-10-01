import { NextResponse } from "next/server";
import { createUserRoute } from "@/lib/api-middleware";
import {
  createScheduledUpload,
  getScheduledUploadApiLimits,
  listScheduledUploads,
  readBoundedJson,
} from "@/lib/services/scheduled-upload";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

export const GET = createUserRoute(async ({ request, session }) => {
  const cursor = new URL(request.url).searchParams.get("cursor") || undefined;
  const { items, nextCursor } = await listScheduledUploads(
    { email: session.user.email ?? "" },
    { cursor },
  );
  return NextResponse.json(
    { items, nextCursor, limits: getScheduledUploadApiLimits() },
    { headers: noStore },
  );
});

export const POST = createUserRoute(async ({ request, session }) => {
  const body = await readBoundedJson(request);
  const schedule = await createScheduledUpload(body, {
    email: session.user.email ?? "",
  });
  return NextResponse.json(
    { schedule, limits: getScheduledUploadApiLimits() },
    { status: 201, headers: noStore },
  );
});
