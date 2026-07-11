const MOBILE_STATIC_ORIGINS = new Set([
  "capacitor://localhost",
  "ionic://localhost",
  "http://localhost",
  "http://localhost:5173",
  "http://127.0.0.1",
  "http://127.0.0.1:5173",
]);

function appOrigin(): string | null {
  const configured = process.env.NEXTAUTH_URL?.trim();
  if (!configured) return null;
  try {
    return new URL(configured).origin;
  } catch {
    return null;
  }
}

export function isAllowedMobileOrigin(
  origin: string | null | undefined,
): boolean {
  if (!origin) return false;
  if (MOBILE_STATIC_ORIGINS.has(origin)) return true;
  const configuredOrigin = appOrigin();
  return configuredOrigin !== null && origin === configuredOrigin;
}

export function resolveDownloadCorsOrigin(
  requestOrigin: string | null | undefined,
): string | null {
  if (!requestOrigin) return null;
  if (isAllowedMobileOrigin(requestOrigin)) return requestOrigin;
  const configuredOrigin = appOrigin();
  if (configuredOrigin && requestOrigin === configuredOrigin) {
    return requestOrigin;
  }
  return null;
}

export function applyDownloadCorsHeaders(
  headers: Headers,
  requestOrigin?: string | null,
): void {
  headers.set(
    "Access-Control-Expose-Headers",
    "Content-Range, Content-Length, Accept-Ranges",
  );

  const resolved = resolveDownloadCorsOrigin(requestOrigin);
  if (resolved) {
    headers.set("Access-Control-Allow-Origin", resolved);
    return;
  }

  if (!requestOrigin) {
    const fallback = appOrigin() ?? process.env.NEXTAUTH_URL ?? "";
    if (fallback) {
      headers.set("Access-Control-Allow-Origin", fallback);
    }
  }
}

export function mobileApiCorsHeaders(
  origin: string | null,
): Record<string, string> | null {
  if (!origin || !isAllowedMobileOrigin(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

/** Same-origin relative path only; blocks open redirects. */
export function safeMobileRedirectPath(
  redirect: string | null | undefined,
  fallback = "/",
): string | null {
  if (!redirect) return fallback;
  if (!redirect.startsWith("/") || redirect.startsWith("//")) return null;
  if (redirect.includes("\\")) return null;

  try {
    const parsed = new URL(redirect, "http://localhost");
    if (parsed.origin !== "http://localhost") return null;
    const pathname = decodeURIComponent(parsed.pathname);
    if (!pathname.startsWith("/") || pathname.startsWith("//")) {
      return null;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}
