import { NextResponse } from "next/server";
import { createAdminRoute } from "@/lib/api-middleware";
import { kv } from "@/lib/kv";

import {
  addManualDrive,
  DUPLICATE_MANUAL_DRIVE_ERROR,
  MANUAL_DRIVES_KEY,
  manualDriveCreateSchema,
  manualDriveDeleteSchema,
  parseManualDriveRecords,
  removeManualDrive,
} from "@/lib/manual-drives";

export const dynamic = "force-dynamic";

export const GET = createAdminRoute(async () => {
  try {
    const drives = parseManualDriveRecords(await kv.get(MANUAL_DRIVES_KEY));
    return NextResponse.json(drives);
  } catch (error) {
    console.error("Failed to fetch manual drives:", error);
    return NextResponse.json(
      { error: "Gagal mengambil data" },
      { status: 500 },
    );
  }
});

export const POST = createAdminRoute(
  async ({ body }) => {
    try {
      const drives = await addManualDrive(body);
      return NextResponse.json({ success: true, drives });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === DUPLICATE_MANUAL_DRIVE_ERROR
      ) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      console.error("Failed to create manual drive:", error);
      return NextResponse.json(
        { error: "Internal Server Error" },
        { status: 500 },
      );
    }
  },
  { bodySchema: manualDriveCreateSchema },
);

export const DELETE = createAdminRoute(
  async ({ body }) => {
    try {
      const drives = await removeManualDrive(body.id);
      return NextResponse.json({ success: true, drives });
    } catch (error) {
      console.error("Failed to delete manual drive:", error);
      return NextResponse.json({ error: "Gagal menghapus" }, { status: 500 });
    }
  },
  { bodySchema: manualDriveDeleteSchema },
);
