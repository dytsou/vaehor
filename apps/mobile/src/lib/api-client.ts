/** Native shell HTTP helpers; paths and types from @zee-index/sdk (R20). */

import { getHealthCheckUrl } from "@zee-index/sdk";

export const SESSION_COOKIE_NAME = "authjs.session-token";

export function normalizeServerOrigin(input: string): string {
  const trimmed = input.trim();
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const url = new URL(withScheme);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("invalid_protocol");
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.origin;
}

export type ServerFetch = (
  path: string,
  init?: RequestInit,
) => Promise<Response>;

export function createServerFetch(
  origin: string,
  sessionToken: string,
): ServerFetch {
  const base = normalizeServerOrigin(origin);
  return (path, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Cookie", `${SESSION_COOKIE_NAME}=${sessionToken}`);
    return fetch(`${base}${path}`, {
      ...init,
      headers,
      credentials: "omit",
    });
  };
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
