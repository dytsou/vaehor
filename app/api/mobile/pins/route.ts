import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidateTag } from "next/cache";
import { createAdminRoute, createUserRoute } from "@/lib/api-middleware";
import { getFileDetailsFromDrive } from "@/lib/drive";
import { kv } from "@/lib/kv";

const PINNED_KEY = "vaehor:pinned-folders";
const PIN_LOOKUP_CONCURRENCY = 8;
const folderSchema = z.object({ folderId: z.string().trim().min(1).max(512) });

export const dynamic = "force-dynamic";

export const GET = createUserRoute(async () => {
  try {
    const ids = [...new Set((await kv.smembers(PINNED_KEY)).filter(Boolean))];
    const entries: Array<{
      id?: string;
      name?: string;
      mimeType?: string;
      parents?: string[];
    } | null> = [];

    for (
      let offset = 0;
      offset < ids.length;
      offset += PIN_LOOKUP_CONCURRENCY
    ) {
      const batch = await Promise.all(
        ids.slice(offset, offset + PIN_LOOKUP_CONCURRENCY).map(async (id) => {
          const file = await getFileDetailsFromDrive(id);
          if (!file || file.trashed || !file.isFolder) {
            await kv.srem(PINNED_KEY, id);
            return null;
          }
          return {
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            parents: file.parents,
          };
        }),
      );
      entries.push(...batch);
    }

    return NextResponse.json({
      folders: entries.filter((entry) => entry !== null),
    });
  } catch {
    return NextResponse.json(
      { error: "Pinned folders are unavailable." },
      { status: 503 },
    );
  }
});

export const POST = createAdminRoute(
  async ({ body }) => {
    await kv.sadd(PINNED_KEY, body.folderId);
    revalidateTag("pinned", "max");
    return NextResponse.json({ success: true, isPinned: true });
  },
  { bodySchema: folderSchema },
);

export const DELETE = createAdminRoute(
  async ({ body }) => {
    await kv.srem(PINNED_KEY, body.folderId);
    revalidateTag("pinned", "max");
    return NextResponse.json({ success: true, isPinned: false });
  },
  { bodySchema: folderSchema },
);
