/** Same-origin check for browser-initiated setup POSTs (Origin header). */
export function isAllowedSetupRequestOrigin(
  request: Request,
  options: { setupSecretVerified?: boolean } = {},
): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    return (
      options.setupSecretVerified === true &&
      Boolean(process.env.SETUP_SECRET?.trim()) &&
      Boolean(request.headers.get("x-setup-secret")?.trim())
    );
  }

  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);

    return originUrl.origin === requestUrl.origin;
  } catch {
    return false;
  }
}
