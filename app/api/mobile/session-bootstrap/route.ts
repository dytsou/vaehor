import { NextResponse } from "next/server";
import { z } from "zod";
import { createPublicRoute } from "@/lib/api-middleware";
import { authServer } from "@/lib/auth-server";
import {
  mobileApiCorsHeaders,
  safeMobileRedirectPath,
} from "@/lib/mobile-origins";
import {
  mobileSessionCookieName,
  mintSessionBootstrapToken,
  redeemSessionBootstrapToken,
} from "@/lib/services/mobile-oauth";

export const dynamic = "force-dynamic";

async function isValidSessionToken(sessionToken: string): Promise<boolean> {
  try {
    const headers = new Headers();
    headers.set("authorization", `Bearer ${sessionToken}`);
    const session = await authServer.api.getSession({ headers });
    return session != null;
  } catch {
    return false;
  }
}

function sessionCookieOptions(requestUrl: URL) {
  const isSecure =
    requestUrl.protocol === "https:" ||
    (process.env.BETTER_AUTH_URL?.startsWith("https://") ?? false);
  return {
    name: mobileSessionCookieName(isSecure),
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
    const cookie = sessionCookieOptions(request.nextUrl);
    response.cookies.set(cookie.name, sessionToken, {
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      secure: cookie.secure,
      path: cookie.path,
    });
    return response;
  },
  { rateLimit: false },
);

const postBodySchema = z.union([
  z.object({ sessionToken: z.string().min(1) }),
  z.object({ bootstrapToken: z.string().min(1) }),
]);

export const POST = createPublicRoute(
  async ({ request, body }) => {
    if ("bootstrapToken" in body) {
      const sessionToken = await redeemSessionBootstrapToken(
        body.bootstrapToken,
      );
      if (!sessionToken) {
        return NextResponse.json(
          { error: "Invalid or expired token" },
          { status: 401 },
        );
      }

      const cors = mobileApiCorsHeaders(request.headers.get("Origin"));
      return NextResponse.json(
        { sessionToken },
        cors ? { headers: cors } : undefined,
      );
    }

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
  { bodySchema: postBodySchema, rateLimit: false },
);
