import { NextResponse } from "next/server";
import { createPublicRoute } from "@/lib/api-middleware";
import { authServer } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

/**
 * GET entry for native WebBrowser: Better Auth social sign-in is POST-only,
 * so this route starts Google OAuth and redirects to the authorize URL.
 */
export const GET = createPublicRoute(
  async ({ request }) => {
    const callbackURL = request.nextUrl.searchParams.get("callbackURL");
    if (!callbackURL) {
      return NextResponse.json(
        { error: "Missing callbackURL" },
        { status: 400 },
      );
    }

    let parsed: URL;
    try {
      parsed = new URL(callbackURL);
    } catch {
      return NextResponse.json(
        { error: "Invalid callbackURL" },
        { status: 400 },
      );
    }

    if (
      parsed.origin !== request.nextUrl.origin ||
      parsed.pathname !== "/api/mobile/oauth-complete"
    ) {
      return NextResponse.json(
        { error: "Invalid callbackURL" },
        { status: 400 },
      );
    }

    const result = await authServer.api.signInSocial({
      body: {
        provider: "google",
        callbackURL,
        disableRedirect: true,
      },
      headers: request.headers,
    });

    if (!result?.url) {
      return NextResponse.json(
        { error: "OAuth start failed" },
        { status: 500 },
      );
    }

    return NextResponse.redirect(result.url);
  },
  { rateLimit: false },
);
