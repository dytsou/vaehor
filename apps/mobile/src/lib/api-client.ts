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

export type ServerFetchTimeoutOptions = {
  requestTimeoutMs?: number;
  uploadTimeoutMs?: number;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_UPLOAD_TIMEOUT_MS = 180_000;

function isUploadRequest(path: string, method: string, headers: Headers) {
  return (
    /(?:^|\/)(?:upload|uploads|chunk|chunks)(?:\/|$)/i.test(path) ||
    method === "PUT" ||
    method === "PATCH" ||
    headers.has("Content-Range")
  );
}

function createScopedServerFetch(
  origin: string,
  authorizationToken: string | null,
  timeoutOptions: ServerFetchTimeoutOptions = {},
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

    const controller = new AbortController();
    const callerSignal = init.signal;
    const method = (init.method ?? "GET").toUpperCase();
    const configuredTimeout = isUploadRequest(url.pathname, method, headers)
      ? (timeoutOptions.uploadTimeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS)
      : (timeoutOptions.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(configuredTimeout)
      ? Math.max(1, configuredTimeout)
      : DEFAULT_REQUEST_TIMEOUT_MS;
    const abortFromCaller = () => {
      controller.abort(callerSignal?.reason);
      clearTimeout(timeout);
    };
    const timeout = setTimeout(() => {
      controller.abort(new Error("server_request_timeout"));
      callerSignal?.removeEventListener("abort", abortFromCaller);
    }, timeoutMs);
    (
      timeout as ReturnType<typeof setTimeout> & { unref?: () => void }
    ).unref?.();

    if (callerSignal?.aborted) {
      abortFromCaller();
    } else {
      callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
    }

    return fetch(url.toString(), {
      ...init,
      headers,
      credentials: "omit",
      signal: controller.signal,
    }).catch((cause: unknown) => {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", abortFromCaller);
      throw cause;
    });
  };
}

export function createServerFetch(
  origin: string,
  sessionToken: string,
  timeoutOptions?: ServerFetchTimeoutOptions,
): ServerFetch {
  return createScopedServerFetch(origin, sessionToken, timeoutOptions);
}

export function createPublicServerFetch(
  origin: string,
  timeoutOptions?: ServerFetchTimeoutOptions,
): ServerFetch {
  return createScopedServerFetch(origin, null, timeoutOptions);
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
