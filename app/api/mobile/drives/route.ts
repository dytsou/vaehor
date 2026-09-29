import { NextResponse } from "next/server";
import { createUserRoute } from "@/lib/api-middleware";
import { getRootFolderId } from "@/lib/config";
import { kv } from "@/lib/kv";
import {
  MANUAL_DRIVES_KEY,
  parseManualDriveRecords,
  parseManualDrivesFromEnv,
} from "@/lib/manual-drives";

type MobileDrive = {
  id: string;
  name: string;
  isProtected: boolean;
};

type ManualDrive = {
  id: string;
  name: string;
  isProtected?: boolean;
};

function toMobileDrive(drive: ManualDrive): MobileDrive | null {
  const id = drive.id.trim();
  if (!id) return null;
  return {
    id,
    name: drive.name.trim() || id,
    isProtected: drive.isProtected ?? false,
  };
}

export const GET = createUserRoute(async ({ session }) => {
  try {
    const rootFolderId = (await getRootFolderId()).trim();
    if (!rootFolderId) {
      return NextResponse.json(
        { error: "File storage is not configured" },
        { status: 503 },
      );
    }

    const drives = new Map<string, MobileDrive>();
    drives.set(rootFolderId, {
      id: rootFolderId,
      name: process.env.NEXT_PUBLIC_ROOT_FOLDER_NAME?.trim() || "Home",
      isProtected: false,
    });

    const envDrives = parseManualDrivesFromEnv(
      process.env.NEXT_PUBLIC_MANUAL_DRIVES || "",
    );
    const savedDrives = parseManualDriveRecords(
      await kv.get(MANUAL_DRIVES_KEY),
    );

    for (const drive of [...envDrives, ...savedDrives]) {
      const normalized = toMobileDrive(drive);
      if (normalized) drives.set(normalized.id, normalized);
    }

    return NextResponse.json({
      rootFolderId,
      drives: [...drives.values()],
      role: typeof session.user.role === "string" ? session.user.role : "user",
    });
  } catch {
    return NextResponse.json(
      { error: "Mobile file roots are unavailable" },
      { status: 503 },
    );
  }
});
