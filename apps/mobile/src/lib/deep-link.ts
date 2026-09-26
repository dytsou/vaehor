import { requireSecureServerOrigin } from "./api-client";
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
  if (url.protocol !== "vaehor:") return { kind: "ignored" };
  if (url.hostname === "auth") return { kind: "ignored" };
  if (url.hostname !== "share") return { kind: "invalid", error: "malformed" };

  const originParam = url.searchParams.get("origin");
  const pathParam = url.searchParams.get("path");
  if (!originParam || !pathParam) {
    return { kind: "invalid", error: "malformed" };
  }

  try {
    const origin = requireSecureServerOrigin(originParam);
    const path = pathParam.startsWith("/") ? pathParam : `/${pathParam}`;
    const parsedPath = new URL(path, `${origin}/`);
    if (parsedPath.origin !== origin) {
      return { kind: "invalid", error: "malformed" };
    }
    const shareToken = url.searchParams.get("share_token");
    if (shareToken && !parsedPath.searchParams.has("share_token")) {
      parsedPath.searchParams.set("share_token", shareToken);
    }
    const pathOnly = parsedPath.pathname;
    const search = parsedPath.search;

    if (!isShareWebPath(pathOnly, search)) {
      return { kind: "invalid", error: "malformed" };
    }

    return {
      kind: "share",
      target: { origin, path: `${pathOnly}${search}` },
    };
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

  try {
    return {
      kind: "share",
      target: {
        origin: requireSecureServerOrigin(url.origin),
        path: `${url.pathname}${url.search}`,
      },
    };
  } catch {
    return { kind: "invalid", error: "malformed" };
  }
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
  let normalized: string;
  try {
    normalized = requireSecureServerOrigin(origin);
  } catch {
    return null;
  }
  return (
    servers.find((server) => {
      try {
        return requireSecureServerOrigin(server.url) === normalized;
      } catch {
        return false;
      }
    }) ?? null
  );
}

export function resolveShareDestination(
  target: DeepLinkTarget,
  servers: ServerBookmark[],
):
  | { kind: "bookmark"; bookmark: ServerBookmark }
  | { kind: "setup"; origin: string } {
  const origin = requireSecureServerOrigin(target.origin);
  const bookmark = findBookmarkForOrigin(origin, servers);
  return bookmark ? { kind: "bookmark", bookmark } : { kind: "setup", origin };
}

export function buildShareCustomSchemeUrl(target: DeepLinkTarget): string {
  const url = new URL("vaehor://share");
  const origin = requireSecureServerOrigin(target.origin);
  const parsed = new URL(target.path, `${origin}/`);
  if (
    parsed.origin !== origin ||
    !isShareWebPath(parsed.pathname, parsed.search)
  ) {
    throw new Error("invalid_share_target");
  }
  url.searchParams.set("origin", origin);
  url.searchParams.set("path", parsed.pathname);
  const shareToken = parsed.searchParams.get("share_token");
  if (shareToken) {
    url.searchParams.set("share_token", shareToken);
  }
  return url.toString();
}
