/** Native shell HTTP helpers; paths and types from @vaehor/sdk (R20). */

import { getHealthCheckUrl } from "@vaehor/sdk";

export function normalizeServerOrigin(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("invalid_origin");
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const url = new URL(withScheme);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("invalid_protocol");
  }
  if (url.username || url.password) {
    throw new Error("credentials_in_origin_blocked");
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.origin;
}

export function requireSecureServerOrigin(input: string): string {
  const origin = normalizeServerOrigin(input);
  const { protocol, hostname } = new URL(origin);
  const isLoopback =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]";
  if (protocol !== "https:" && !isLoopback) {
    throw new Error("https_required");
  }
  return origin;
}

export type ServerFetch = (
  path: string,
  init?: RequestInit,
) => Promise<Response>;

function createScopedServerFetch(
  origin: string,
  authorizationToken: string | null,
): ServerFetch {
  const base = requireSecureServerOrigin(origin);
  return (path, init = {}) => {
    const url = new URL(path, `${base}/`);
    if (url.origin !== base) {
      throw new Error("cross_origin_request_blocked");
    }
    const headers = new Headers(init.headers);
    headers.delete("Cookie");
    if (authorizationToken === null) {
      headers.delete("Authorization");
    } else {
      headers.set("Authorization", `Bearer ${authorizationToken}`);
    }
    return fetch(url.toString(), {
      ...init,
      headers,
      credentials: "omit",
    });
  };
}

export function createServerFetch(
  origin: string,
  sessionToken: string,
): ServerFetch {
  return createScopedServerFetch(origin, sessionToken);
}

export function createPublicServerFetch(origin: string): ServerFetch {
  return createScopedServerFetch(origin, null);
}

export async function checkServerHealth(origin: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(
      `${normalizeServerOrigin(origin)}${getHealthCheckUrl()}`,
      {
        method: "GET",
        signal: controller.signal,
      },
    );
    return res.ok;
  } finally {
    clearTimeout(timeout);
  }
}
