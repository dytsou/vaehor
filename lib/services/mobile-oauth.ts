import { SignJWT, jwtVerify } from "jose";
import { REDIS_KEYS } from "@/lib/constants";
import { kv } from "@/lib/kv";
import { getLocalStorageAuthSecret } from "@/lib/local-auth-secret";

const PURPOSE_STATE = "mobile-oauth-state";
const PURPOSE_EXCHANGE = "mobile-oauth-exchange";
const PURPOSE_BOOTSTRAP = "mobile-session-bootstrap";

const JTI_TTL_SECONDS = {
  state: 600,
  exchange: 120,
  bootstrap: 120,
} as const;

export const MOBILE_SESSION_COOKIE_NAME = "authjs.session-token";

function signingSecret(): Uint8Array {
  const secret = getLocalStorageAuthSecret();
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is not configured for mobile OAuth");
  }
  return secret;
}

function jtiKey(jti: string): string {
  return `${REDIS_KEYS.MOBILE_OAUTH_JTI}${jti}`;
}

async function markJtiConsumed(
  jti: string,
  ttlSeconds: number,
): Promise<boolean> {
  const key = jtiKey(jti);
  const count = await kv.incr(key);
  if (count !== 1) return false;
  await kv.expire(key, ttlSeconds);
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
    return markJtiConsumed(payload.jti, JTI_TTL_SECONDS.state);
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
    if (!(await markJtiConsumed(payload.jti, JTI_TTL_SECONDS.exchange))) {
      return null;
    }
    return typeof payload.sessionToken === "string"
      ? payload.sessionToken
      : null;
  } catch {
    return null;
  }
}

export async function mintSessionBootstrapToken(
  sessionToken: string,
): Promise<string> {
  const jti = crypto.randomUUID();
  return new SignJWT({ purpose: PURPOSE_BOOTSTRAP, sessionToken })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime("2m")
    .sign(signingSecret());
}

export async function redeemSessionBootstrapToken(
  token: string,
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, signingSecret());
    if (
      payload.purpose !== PURPOSE_BOOTSTRAP ||
      typeof payload.jti !== "string"
    ) {
      return null;
    }
    if (!(await markJtiConsumed(payload.jti, JTI_TTL_SECONDS.bootstrap))) {
      return null;
    }
    return typeof payload.sessionToken === "string"
      ? payload.sessionToken
      : null;
  } catch {
    return null;
  }
}

export async function resetMobileOAuthNonceStoreForTests(): Promise<void> {
  const keys = await kv.keys(`${REDIS_KEYS.MOBILE_OAUTH_JTI}*`);
  if (keys.length > 0) {
    await kv.del(...keys);
  }
}
