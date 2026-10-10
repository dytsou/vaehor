import { NextRequest, NextResponse } from "next/server";
import { authServer } from "@/lib/auth-server";

export interface MiddlewareAuthResult {
  isAuthenticated: boolean;
  isGuest: boolean;
  is2FARequired: boolean;
  token: {
    role?: string;
    email?: string | null;
    twoFactorRequired?: boolean;
    isGuest?: boolean;
    sub?: string;
  } | null;
}

export async function checkAuth(
  request: NextRequest,
  _secret?: string | undefined,
): Promise<MiddlewareAuthResult> {
  const session = await authServer.api.getSession({
    headers: request.headers,
  });

  if (!session) {
    return {
      isAuthenticated: false,
      isGuest: false,
      is2FARequired: false,
      token: null,
    };
  }

  const role =
    (session.user as { role?: string }).role ??
    ((session.session as { isGuest?: boolean }).isGuest ? "GUEST" : "USER");
  const twoFactorRequired = !!(
    session.session as { twoFactorRequired?: boolean }
  ).twoFactorRequired;
  const isGuest =
    (session.session as { isGuest?: boolean }).isGuest === true ||
    role === "GUEST";

  return {
    isAuthenticated: true,
    isGuest,
    is2FARequired: twoFactorRequired,
    token: {
      role,
      email: session.user.email,
      twoFactorRequired,
      isGuest,
      sub: session.user.id,
    },
  };
}

export function handleAuthRedirect(
  request: NextRequest,
  pathname: string,
  error?: string,
) {
  if (pathname.startsWith("/api")) {
    return NextResponse.json(
      { error: error || "Unauthorized" },
      { status: 401 },
    );
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("callbackUrl", pathname);
  if (error) {
    loginUrl.searchParams.set("error", error);
  }
  return NextResponse.redirect(loginUrl);
}
