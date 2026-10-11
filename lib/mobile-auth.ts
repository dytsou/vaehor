import type { NextRequest } from "next/server";
import type { AppSession } from "@/auth";
import { authServer } from "@/lib/auth-server";

/**
 * Resolve Better Auth session from a native client's Authorization bearer.
 * Cookie is stripped so an unrelated browser session cannot mask mobile creds.
 */
export async function readMobileBearerSession(
  request: NextRequest,
): Promise<AppSession | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) return null;

  const bearerHeaders = new Headers(request.headers);
  bearerHeaders.delete("cookie");

  const session = await authServer.api.getSession({
    headers: bearerHeaders,
  });
  if (!session) return null;

  const role =
    (session.user as { role?: string }).role ??
    ((session.session as { isGuest?: boolean }).isGuest ? "GUEST" : "USER");
  const twoFactorRequired = !!(
    session.session as { twoFactorRequired?: boolean }
  ).twoFactorRequired;

  if (twoFactorRequired) {
    return null;
  }

  return {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image,
      role,
      isGuest:
        (session.session as { isGuest?: boolean }).isGuest === true ||
        role === "GUEST",
      twoFactorRequired: false,
    },
    expires: new Date(session.session.expiresAt).toISOString(),
  };
}
