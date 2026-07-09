import { NextResponse } from "next/server";
import { decode } from "next-auth/jwt";
import { z } from "zod";
import { createPublicRoute } from "@/lib/api-middleware";
import { safeMobileRedirectPath } from "@/lib/mobile-origins";
import {
  MOBILE_SESSION_COOKIE_NAME,
  createMobileOAuthState,
  mintSessionBootstrapToken,
  redeemSessionBootstrapToken,
} from "@/lib/services/mobile-oauth";

export const dynamic = "force-dynamic";

async function isValidSessionToken(sessionToken: string): Promise<boolean> {
  const secret = process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) return false;
  try {
    const payload = await decode({
      token: sessionToken,
      secret,
      salt: MOBILE_SESSION_COOKIE_NAME,
    });
    return payload != null;
  } catch {
    return false;
  }
}

function sessionCookieOptions(requestUrl: URL) {
  const isSecure =
    requestUrl.protocol === "https:" ||
    (process.env.NEXTAUTH_URL?.startsWith("https://") ?? false);
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isSecure,
    path: "/",
  };
}

export const GET = createPublicRoute(
  async ({ request }) => {
    const token = request.nextUrl.searchParams.get("token");
    if (!token) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    }

    const sessionToken = await redeemSessionBootstrapToken(token);
    if (!sessionToken) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 },
      );
    }

    const rawRedirect = request.nextUrl.searchParams.get("redirect");
    const redirectTo = safeMobileRedirectPath(
      rawRedirect,
      new URL("/", request.url).pathname,
    );
    if (rawRedirect && !redirectTo) {
      return NextResponse.json({ error: "Invalid redirect" }, { status: 400 });
    }
    const response = NextResponse.redirect(
      new URL(redirectTo ?? "/", request.url),
    );
    response.cookies.set(
      MOBILE_SESSION_COOKIE_NAME,
      sessionToken,
      sessionCookieOptions(request.nextUrl),
    );
    return response;
  },
  { rateLimit: false },
);

const issueBodySchema = z.object({
  sessionToken: z.string().min(1),
});

export const POST = createPublicRoute(
  async ({ request, body }) => {
    if (!(await isValidSessionToken(body.sessionToken))) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const bootstrapToken = await mintSessionBootstrapToken(body.sessionToken);
    const bootstrapUrl = new URL("/api/mobile/session-bootstrap", request.url);
    bootstrapUrl.searchParams.set("token", bootstrapToken);

    return NextResponse.json({
      bootstrapUrl: `${bootstrapUrl.pathname}${bootstrapUrl.search}`,
    });
  },
  { bodySchema: issueBodySchema, rateLimit: false },
);
