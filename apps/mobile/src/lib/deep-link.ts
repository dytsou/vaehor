import { normalizeServerOrigin } from "./api-client";
import type { ServerBookmark } from "./servers";

const LOCALES = ["en", "id", "zh-TW"] as const;

export type DeepLinkTarget = {
  origin: string;
  /** Locale-prefixed path plus query, e.g. /en/share/abc?share_token=… */
  path: string;
};

export type ParseDeepLinkResult =
  | { kind: "share"; target: DeepLinkTarget }
  | { kind: "invalid"; error: "malformed" }
  | { kind: "ignored" };

export function stripLocaleFromPathname(pathname: string): string {
  for (const locale of LOCALES) {
    if (pathname === `/${locale}`) return "/";
    if (pathname.startsWith(`/${locale}/`)) {
      return pathname.slice(locale.length + 1);
    }
  }
  return pathname;
}

function isShareWebPath(pathname: string, search: string): boolean {
  const stripped = stripLocaleFromPathname(pathname);
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  return (
    stripped.startsWith("/share/") ||
    stripped.startsWith("/folder/") ||
    params.has("share_token")
  );
}

function parseCustomShareLink(url: URL): ParseDeepLinkResult {
  if (url.protocol !== "zeeindex:") return { kind: "ignored" };
  if (url.hostname === "auth") return { kind: "ignored" };
  if (url.hostname !== "share") return { kind: "invalid", error: "malformed" };

  const originParam = url.searchParams.get("origin");
  const pathParam = url.searchParams.get("path");
  if (!originParam || !pathParam) {
    return { kind: "invalid", error: "malformed" };
  }

  try {
    const origin = normalizeServerOrigin(originParam);
    const path = pathParam.startsWith("/") ? pathParam : `/${pathParam}`;
    const shareToken = url.searchParams.get("share_token");
    const pathOnly = path.split("?")[0] ?? path;
    const fullPath =
      shareToken && !path.includes("share_token=")
        ? `${pathOnly}?share_token=${encodeURIComponent(shareToken)}`
        : path;

    if (
      !isShareWebPath(
        pathOnly,
        fullPath.includes("?") ? fullPath.slice(fullPath.indexOf("?")) : "",
      )
    ) {
      return { kind: "invalid", error: "malformed" };
    }

    return { kind: "share", target: { origin, path: fullPath } };
  } catch {
    return { kind: "invalid", error: "malformed" };
  }
}

function parseHttpsShareLink(url: URL): ParseDeepLinkResult {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { kind: "ignored" };
  }
  if (!isShareWebPath(url.pathname, url.search)) {
    return { kind: "ignored" };
  }

  return {
    kind: "share",
    target: {
      origin: url.origin,
      path: `${url.pathname}${url.search}`,
    },
  };
}

export function parseDeepLink(rawUrl: string): ParseDeepLinkResult {
  try {
    const url = new URL(rawUrl);
    const custom = parseCustomShareLink(url);
    if (custom.kind !== "ignored") return custom;
    return parseHttpsShareLink(url);
  } catch {
    return { kind: "invalid", error: "malformed" };
  }
}

export function findBookmarkForOrigin(
  origin: string,
  servers: ServerBookmark[],
): ServerBookmark | null {
  const normalized = normalizeServerOrigin(origin);
  return servers.find((server) => server.url === normalized) ?? null;
}

export function appendBootstrapRedirect(
  bootstrapPath: string,
  redirectPath: string,
): string {
  const separator = bootstrapPath.includes("?") ? "&" : "?";
  return `${bootstrapPath}${separator}redirect=${encodeURIComponent(redirectPath)}`;
}

export function buildShareCustomSchemeUrl(target: DeepLinkTarget): string {
  const url = new URL("zeeindex://share");
  const parsed = new URL(target.path, target.origin);
  url.searchParams.set("origin", target.origin);
  url.searchParams.set("path", parsed.pathname);
  const shareToken = parsed.searchParams.get("share_token");
  if (shareToken) {
    url.searchParams.set("share_token", shareToken);
  }
  return url.toString();
}
