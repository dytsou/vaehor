import type { Session } from "next-auth";
import type { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth-check";

/**
 * Resolve the same encrypted Auth.js session used by web requests from a
 * native client's Authorization header. The header takes precedence over a
 * cookie so an unrelated browser session can never mask a mobile credential.
 */
export async function readMobileBearerSession(
  request: NextRequest,
): Promise<Session | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) return null;

  const secret = process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) return null;

  // Auth.js checks its session cookie before the Authorization header. A
  // mobile bearer must be authoritative on its own, so validate it without
  // allowing a browser cookie on the same request to replace it.
  const bearerHeaders = new Headers(request.headers);
  bearerHeaders.delete("cookie");
  const authState = await checkAuth(
    { headers: bearerHeaders } as NextRequest,
    secret,
  );
  if (
    !authState.isAuthenticated ||
    authState.is2FARequired ||
    !authState.token
  ) {
    return null;
  }

  const token = authState.token;
  let id: string | null = null;
  if (typeof token.id === "string") id = token.id;
  else if (typeof token.sub === "string") id = token.sub;
  const expiresAt = typeof token.exp === "number" ? token.exp : null;
  if (!id || expiresAt === null || expiresAt * 1000 <= Date.now()) return null;

  const role = typeof token.role === "string" ? token.role : "USER";
  return {
    user: {
      id,
      name: typeof token.name === "string" ? token.name : null,
      email: typeof token.email === "string" ? token.email : null,
      image: typeof token.picture === "string" ? token.picture : null,
      role,
      isGuest:
        typeof token.isGuest === "boolean" ? token.isGuest : role === "GUEST",
    },
    expires: new Date(expiresAt * 1000).toISOString(),
  } as Session;
}
