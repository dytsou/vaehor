import { headers } from "next/headers";
import { toNextJsHandler } from "better-auth/next-js";
import { authServer } from "@/lib/auth-server";

export { authServer };

/** NextAuth-shaped session for gradual call-site migration. */
export type AppSession = {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
    role?: string;
    isGuest?: boolean;
  };
  expires: string;
};

/**
 * Drop-in for NextAuth `auth()` — reads Better Auth session from request headers.
 */
export async function auth(): Promise<AppSession | null> {
  const session = await authServer.api.getSession({
    headers: await headers(),
  });
  if (!session) return null;

  const role =
    (session.user as { role?: string }).role ??
    ((session.session as { isGuest?: boolean }).isGuest ? "GUEST" : "USER");

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
    },
    expires: new Date(session.session.expiresAt).toISOString(),
  };
}

export const handlers = toNextJsHandler(authServer);
