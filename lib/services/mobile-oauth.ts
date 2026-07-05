import { SignJWT, jwtVerify } from "jose";
import { getLocalStorageAuthSecret } from "@/lib/local-auth-secret";

const PURPOSE_STATE = "mobile-oauth-state";
const PURPOSE_EXCHANGE = "mobile-oauth-exchange";

// ponytail: in-memory one-time jti set; lost on process restart; upgrade to KV for multi-instance
const consumedJtis = new Set<string>();

export const MOBILE_SESSION_COOKIE_NAME = "authjs.session-token";

function signingSecret(): Uint8Array {
  const secret = getLocalStorageAuthSecret();
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is not configured for mobile OAuth");
  }
  return secret;
}

function markJtiConsumed(jti: string): boolean {
  if (consumedJtis.has(jti)) return false;
  consumedJtis.add(jti);
  return true;
}

export async function createMobileOAuthState(): Promise<string> {
  const jti = crypto.randomUUID();
  return new SignJWT({ purpose: PURPOSE_STATE })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(signingSecret());
}

export async function consumeMobileOAuthState(state: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(state, signingSecret());
    if (payload.purpose !== PURPOSE_STATE || typeof payload.jti !== "string") {
      return false;
    }
    return markJtiConsumed(payload.jti);
  } catch {
    return false;
  }
}

export async function mintMobileExchangeToken(
  sessionToken: string,
): Promise<string> {
  const jti = crypto.randomUUID();
  return new SignJWT({ purpose: PURPOSE_EXCHANGE, sessionToken })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime("2m")
    .sign(signingSecret());
}

export async function redeemMobileExchangeToken(
  token: string,
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, signingSecret());
    if (
      payload.purpose !== PURPOSE_EXCHANGE ||
      typeof payload.jti !== "string"
    ) {
      return null;
    }
    if (!markJtiConsumed(payload.jti)) return null;
    return typeof payload.sessionToken === "string"
      ? payload.sessionToken
      : null;
  } catch {
    return null;
  }
}

export function resetMobileOAuthNonceStoreForTests(): void {
  consumedJtis.clear();
}
