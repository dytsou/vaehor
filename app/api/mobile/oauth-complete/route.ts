import { NextResponse } from "next/server";
import { z } from "zod";
import { createPublicRoute, createUserRoute } from "@/lib/api-middleware";
import { mobileApiCorsHeaders } from "@/lib/mobile-origins";
import {
  MOBILE_SESSION_COOKIE_NAME,
  consumeMobileOAuthState,
  mintMobileExchangeToken,
  redeemMobileExchangeToken,
} from "@/lib/services/mobile-oauth";

export const dynamic = "force-dynamic";

const exchangeBodySchema = z.object({
  token: z.string().min(1),
});

export async function OPTIONS(request: Request) {
  const cors = mobileApiCorsHeaders(request.headers.get("Origin"));
  if (!cors) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, { status: 204, headers: cors });
}

export const GET = createUserRoute(
  async ({ request }) => {
    const state = request.nextUrl.searchParams.get("state");
    if (!state || !(await consumeMobileOAuthState(state))) {
      return NextResponse.json(
        { error: "Invalid OAuth state" },
        { status: 401 },
      );
    }

    const sessionToken = request.cookies.get(MOBILE_SESSION_COOKIE_NAME)?.value;
    if (!sessionToken) {
      return NextResponse.json({ error: "Missing session" }, { status: 401 });
    }

    const exchange = await mintMobileExchangeToken(sessionToken);
    const callback = `zeeindex://auth/callback?token=${encodeURIComponent(exchange)}`;
    return NextResponse.redirect(callback);
  },
  { rateLimit: false },
);

export const POST = createPublicRoute(
  async ({ request, body }) => {
    const sessionToken = await redeemMobileExchangeToken(body.token);
    if (!sessionToken) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 },
      );
    }

    const cors = mobileApiCorsHeaders(request.headers.get("Origin"));
    return NextResponse.json(
      {
        cookieName: MOBILE_SESSION_COOKIE_NAME,
        sessionToken,
      },
      cors ? { headers: cors } : undefined,
    );
  },
  { bodySchema: exchangeBodySchema, rateLimit: false },
);
