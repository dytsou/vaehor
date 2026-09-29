import type { ServerFetch } from "./api-client";

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

function adminApiErrorMessage(
  details: { error?: unknown; message?: unknown } | null,
  status: number,
): string {
  if (typeof details?.message === "string") return details.message;
  if (typeof details?.error === "string") return details.error;
  if (status === 401)
    return "Your sign-in has expired. Return to the server screen and sign in again.";
  if (status === 403)
    return "Administrator access is required for this operation.";
  return "The server could not complete this operation.";
}

export async function adminRequest<T>(
  fetchImpl: ServerFetch,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(path, init);
  } catch {
    throw new AdminApiError(
      0,
      "Could not reach the server. Check your connection and retry.",
    );
  }

  const body = await response.text();
  let payload: unknown;
  if (body) {
    try {
      payload = JSON.parse(body) as unknown;
    } catch {
      throw new AdminApiError(
        response.status,
        "The server returned an invalid response.",
      );
    }
  }

  if (!response.ok) {
    const details =
      payload && typeof payload === "object"
        ? (payload as { error?: unknown; message?: unknown })
        : null;
    throw new AdminApiError(
      response.status,
      adminApiErrorMessage(details, response.status),
    );
  }

  return payload as T;
}

export function adminJsonRequest(
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

export function redactAdminData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAdminData);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      /password|secret|token|credential|private.?key/i.test(key)
        ? "[redacted]"
        : redactAdminData(entry),
    ]),
  );
}
