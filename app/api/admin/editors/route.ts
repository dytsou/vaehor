import { kv } from "@/lib/kv";
import { NextResponse } from "next/server";
import { createAdminRoute } from "@/lib/api-middleware";
import { REDIS_KEYS } from "@/lib/constants";
import { z } from "zod";
import { revokeEditorAccess } from "@/lib/services/auth-jwt";

const emailSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Invalid email format")
    .transform((v) => v.toLowerCase()),
});

export const dynamic = "force-dynamic";

export const GET = createAdminRoute(async () => {
  try {
    const editors = await kv.smembers(REDIS_KEYS.ADMIN_EDITORS);
    return NextResponse.json(editors || []);
  } catch (error) {
    console.error("Editors fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch editors" },
      { status: 500 },
    );
  }
});

export const POST = createAdminRoute(
  async ({ body }) => {
    try {
      const { email } = body;
      await kv.sadd(REDIS_KEYS.ADMIN_EDITORS, email);
      return NextResponse.json({ message: "Editor added", email });
    } catch (error) {
      console.error("Editor add error:", error);
      return NextResponse.json(
        { error: "Failed to add editor" },
        { status: 500 },
      );
    }
  },
  { bodySchema: emailSchema },
);

export const DELETE = createAdminRoute(
  async ({ body }) => {
    try {
      const { email } = body;
      const normalizedEmail = await revokeEditorAccess(email);
      return NextResponse.json({
        message: "Editor removed",
        email: normalizedEmail,
      });
    } catch (error) {
      console.error("Editor remove error:", error);
      return NextResponse.json(
        { error: "Failed to remove editor" },
        { status: 500 },
      );
    }
  },
  { bodySchema: emailSchema },
);
