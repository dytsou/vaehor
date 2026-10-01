import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidateTag } from "next/cache";
import { createAdminRoute, createUserRoute } from "@/lib/api-middleware";
import { kv } from "@/lib/kv";

const TAGS_PREFIX = "zee_tags:";
const querySchema = z.object({ fileId: z.string().trim().min(1).max(512) });
const tagSchema = z.object({
  fileId: z.string().trim().min(1).max(512),
  tag: z.string().trim().min(1).max(80),
});

export const dynamic = "force-dynamic";

export const GET = createUserRoute(
  async ({ query }) => {
    try {
      const tags = await kv.smembers(`${TAGS_PREFIX}${query.fileId}`);
      return NextResponse.json({ tags: tags || [] });
    } catch {
      return NextResponse.json(
        { error: "Tags are unavailable." },
        { status: 503 },
      );
    }
  },
  { querySchema },
);

export const POST = createAdminRoute(
  async ({ body }) => {
    const key = `${TAGS_PREFIX}${body.fileId}`;
    await kv.sadd(key, body.tag);
    revalidateTag(`tags:${body.fileId}`, "max");
    return NextResponse.json({ success: true });
  },
  { bodySchema: tagSchema },
);

export const DELETE = createAdminRoute(
  async ({ body }) => {
    const key = `${TAGS_PREFIX}${body.fileId}`;
    await kv.srem(key, body.tag);
    revalidateTag(`tags:${body.fileId}`, "max");
    return NextResponse.json({ success: true });
  },
  { bodySchema: tagSchema },
);
