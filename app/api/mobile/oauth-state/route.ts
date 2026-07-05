import { NextResponse } from "next/server";
import { createPublicRoute } from "@/lib/api-middleware";
import { createMobileOAuthState } from "@/lib/services/mobile-oauth";

export const dynamic = "force-dynamic";

export const GET = createPublicRoute(
  async () => {
    return NextResponse.json({ state: await createMobileOAuthState() });
  },
  { rateLimit: false },
);
