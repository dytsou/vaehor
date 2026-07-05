/** Minimal SDK-style client for native shell HTTP (health check in U2; upload in U5). */
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

export async function checkServerHealth(origin: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${origin}/api/health`, {
      method: "GET",
      signal: controller.signal,
    });
    return res.ok;
  } finally {
    clearTimeout(timeout);
  }
}
