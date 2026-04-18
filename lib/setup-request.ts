/** Same-origin check for browser-initiated setup POSTs (Origin header). */
export function isAllowedSetupRequestOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    return false;
  }

  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);

    return originUrl.origin === requestUrl.origin;
  } catch {
    return false;
  }
}
