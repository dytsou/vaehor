import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { checkAuth, handleAuthRedirect } from "@/lib/auth-check";
import {
  checkRateLimit,
  createRateLimitResponse,
  type RateLimitType,
} from "@/lib/ratelimit";
import { ERROR_MESSAGES } from "@/lib/constants";
import { isAppConfigured } from "@/lib/config";
import {
  continueApiRoute,
  continuePageRoute,
  validateShareTokenForApi,
  validateShareTokenForPage,
  validateFolderTokenForApi,
  validateFolderTokenForPage,
  handleFindPath,
} from "@/lib/middleware-helpers";
import {
  DEFAULT_LOCALE,
  LOCALES,
  stripLocaleFromPathname,
} from "@/lib/i18n-config";

const intlMiddleware = createMiddleware({
  locales: [...LOCALES],
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "always",
});

const PUBLIC_PATHS = new Set(["/login", "/verify-2fa", "/setup", "/request"]);
const PUBLIC_API_PREFIXES = [
  "/api/auth",
  "/api/config/public",
  "/api/setup",
  "/api/files",
  "/api/folderpath",
  "/api/tags",
  "/api/download",
  "/api/proxy-image",
  "/api/admin/analytics/track",
  "/api/health",
  "/api/metadata",
];

type IntlMiddleware = (request: NextRequest) => Response | Promise<Response>;

interface ProxyRouteContext {
  pathname: string;
  pathnameWithoutLocale: string;
  isApi: boolean;
}

interface AuthState {
  isAuthenticated: boolean;
  isGuest: boolean;
  is2FARequired: boolean;
}

const isPublicRoute = (pathname: string) => {
  return (
    PUBLIC_PATHS.has(pathname) ||
    ["/folder", "/share", "/request", "/login"].some((p) =>
      pathname.startsWith(p),
    )
  );
};

function buildRouteContext(request: NextRequest): ProxyRouteContext {
  const { pathname } = request.nextUrl;
  const pathnameWithoutLocale = stripLocaleFromPathname(pathname) || "/";

  return {
    pathname,
    pathnameWithoutLocale,
    isApi: pathnameWithoutLocale.startsWith("/api"),
  };
}

function shouldBypassProxy(pathname: string): boolean {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/static") ||
    pathname === "/sw.js" ||
    pathname === "/manifest.webmanifest" ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/api/download")
  );
}

async function enforceApiRateLimit(
  request: NextRequest,
  pathnameWithoutLocale: string,
): Promise<NextResponse | null> {
  if (
    !pathnameWithoutLocale.startsWith("/api") ||
    pathnameWithoutLocale.startsWith("/api/health")
  ) {
    return null;
  }

  const type: RateLimitType = pathnameWithoutLocale.startsWith("/api/admin")
    ? "ADMIN"
    : "API";
  const ratelimitResult = await checkRateLimit(request, type);

  if (!ratelimitResult.success) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.RATE_LIMIT_EXCEEDED },
      {
        status: 429,
        headers: createRateLimitResponse(ratelimitResult).headers,
      },
    );
  }

  return null;
}

function handleSetupWhenUnconfigured(
  request: NextRequest,
  context: ProxyRouteContext,
): NextResponse | Response | Promise<Response> {
  const isSetupPage =
    context.pathnameWithoutLocale.startsWith("/setup") ||
    context.pathnameWithoutLocale.startsWith("/api/setup");

  if (isSetupPage) {
    return context.isApi
      ? continueApiRoute()
      : continuePageRoute(request, intlMiddleware);
  }

  return NextResponse.redirect(new URL("/setup", request.url));
}

async function handleAppConfiguration(
  request: NextRequest,
  context: ProxyRouteContext,
): Promise<NextResponse | Response | Promise<Response> | null> {
  const isConfigured = await isAppConfigured();

  if (!isConfigured) {
    return handleSetupWhenUnconfigured(request, context);
  }

  if (context.pathnameWithoutLocale.startsWith("/setup")) {
    return NextResponse.redirect(new URL(`/${DEFAULT_LOCALE}`, request.url));
  }

  return null;
}

function isExplicitPublicRoute(pathnameWithoutLocale: string): boolean {
  return (
    PUBLIC_PATHS.has(pathnameWithoutLocale) ||
    PUBLIC_API_PREFIXES.some((prefix) =>
      pathnameWithoutLocale.startsWith(prefix),
    )
  );
}

function enforceAuthenticationRules(
  request: NextRequest,
  context: ProxyRouteContext,
  auth: AuthState,
): NextResponse | null {
  if (!auth.isAuthenticated && !isPublicRoute(context.pathnameWithoutLocale)) {
    return handleAuthRedirect(request, context.pathname);
  }

  if (
    auth.isAuthenticated &&
    auth.isGuest &&
    context.pathnameWithoutLocale.startsWith("/admin")
  ) {
    return handleAuthRedirect(request, context.pathname, "GuestAccessDenied");
  }

  if (
    auth.isAuthenticated &&
    auth.is2FARequired &&
    context.pathnameWithoutLocale !== "/verify-2fa"
  ) {
    const verifyUrl = new URL("/verify-2fa", request.url);
    verifyUrl.searchParams.set("callbackUrl", context.pathname);
    return NextResponse.redirect(verifyUrl);
  }

  return null;
}

function resolveCurrentFolderId(
  request: NextRequest,
  context: ProxyRouteContext,
): string {
  if (context.pathnameWithoutLocale.startsWith("/folder/")) {
    return context.pathnameWithoutLocale.split("/")[2] || "";
  }

  if (context.pathname.startsWith("/api/files")) {
    return request.nextUrl.searchParams.get("folderId") || "";
  }

  return "";
}

async function validateFolderAccessIfNeeded(
  request: NextRequest,
  context: ProxyRouteContext,
  intlHandler: IntlMiddleware,
): Promise<Response | null> {
  const currentFolderId = resolveCurrentFolderId(request, context);
  if (!currentFolderId) {
    return null;
  }

  return context.isApi
    ? validateFolderTokenForApi(request, currentFolderId)
    : validateFolderTokenForPage(request, currentFolderId, intlHandler);
}

function enforceFinalAuthCheck(
  request: NextRequest,
  context: ProxyRouteContext,
  auth: AuthState,
): NextResponse | null {
  if (!auth.isAuthenticated && !isPublicRoute(context.pathnameWithoutLocale)) {
    return handleAuthRedirect(request, context.pathname);
  }

  return null;
}

export async function proxy(request: NextRequest) {
  const context = buildRouteContext(request);

  if (shouldBypassProxy(context.pathname)) {
    return NextResponse.next();
  }

  const rateLimitResponse = await enforceApiRateLimit(
    request,
    context.pathnameWithoutLocale,
  );
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const configurationResponse = await handleAppConfiguration(request, context);
  if (configurationResponse) {
    return configurationResponse;
  }

  if (isExplicitPublicRoute(context.pathnameWithoutLocale)) {
    return context.isApi
      ? continueApiRoute()
      : continuePageRoute(request, intlMiddleware);
  }

  const shareToken = request.nextUrl.searchParams.get("share_token");
  if (shareToken) {
    return context.isApi
      ? validateShareTokenForApi(request, shareToken, context.pathname)
      : validateShareTokenForPage(
          request,
          shareToken,
          context.pathname,
          intlMiddleware,
        );
  }

  const auth = await checkAuth(request, process.env.NEXTAUTH_SECRET);

  const authResponse = enforceAuthenticationRules(request, context, auth);
  if (authResponse) {
    return authResponse;
  }

  const folderResponse = await validateFolderAccessIfNeeded(
    request,
    context,
    intlMiddleware,
  );
  if (folderResponse) {
    return folderResponse;
  }

  const finalAuthResponse = enforceFinalAuthCheck(request, context, auth);
  if (finalAuthResponse) {
    return finalAuthResponse;
  }

  if (context.pathname.startsWith("/findpath")) {
    return handleFindPath(request);
  }

  return context.isApi
    ? continueApiRoute()
    : continuePageRoute(request, intlMiddleware);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png).*)"],
};
