import {
  getCreateShareLinkUrl,
  getDeleteShareLinkUrl,
  getListShareLinksUrl,
  getRevokeShareLinkUrl,
  type CreateShareLinkRequest,
  type CreateShareLinkResponse,
  type ShareLink,
} from "@vaehor/sdk";

export type MobileFetch = (
  path: string,
  init?: RequestInit,
) => Promise<Response>;

async function requestJson<T>(
  fetchImpl: MobileFetch,
  path: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(path, init);
  } catch {
    throw new Error(
      "Could not reach the server. Check your connection and retry.",
    );
  }

  const payload = (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;
  if (!response.ok) {
    throw new Error(
      typeof payload?.error === "string"
        ? payload.error
        : "The server could not complete this request.",
    );
  }
  return payload as T;
}

export function listMobileShareLinks(
  fetchImpl: MobileFetch,
): Promise<ShareLink[]> {
  return requestJson(fetchImpl, getListShareLinksUrl());
}

export function createMobileShareLink(
  fetchImpl: MobileFetch,
  body: CreateShareLinkRequest,
): Promise<CreateShareLinkResponse> {
  return requestJson(fetchImpl, getCreateShareLinkUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function revokeMobileShareLink(
  fetchImpl: MobileFetch,
  body: { jti: string; expiresAt: string },
): Promise<{ success: boolean }> {
  return requestJson(fetchImpl, getRevokeShareLinkUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function deleteMobileShareLink(
  fetchImpl: MobileFetch,
  body: { jti: string; expiresAt: string },
): Promise<{ success: boolean }> {
  return requestJson(fetchImpl, getDeleteShareLinkUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
