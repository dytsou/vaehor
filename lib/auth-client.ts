"use client";

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();

type CompatSession = {
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

/** NextAuth-shaped useSession for gradual UI migration. */
export function useSession() {
  const { data, isPending, error, refetch } = authClient.useSession();

  let status: "loading" | "authenticated" | "unauthenticated" = "loading";
  if (!isPending) {
    status = data ? "authenticated" : "unauthenticated";
  }

  const session: CompatSession | null = data
    ? {
        user: {
          id: data.user.id,
          name: data.user.name,
          email: data.user.email,
          image: data.user.image,
          role: (data.user as { role?: string }).role,
          isGuest:
            (data.session as { isGuest?: boolean } | undefined)?.isGuest ??
            (data.user as { role?: string }).role === "GUEST",
        },
        expires: new Date(data.session.expiresAt).toISOString(),
      }
    : null;

  return {
    data: session,
    status,
    error,
    update: refetch,
  };
}

type SignInOptions = {
  email?: string;
  password?: string;
  callbackUrl?: string;
  redirect?: boolean;
};

/**
 * NextAuth-shaped signIn: google | credentials | guest.
 */
export async function signIn(
  provider: string,
  options: SignInOptions = {},
): Promise<{ error?: string; ok?: boolean; url?: string } | undefined> {
  const callbackUrl = options.callbackUrl ?? "/";

  if (provider === "google") {
    const { error } = await authClient.signIn.social({
      provider: "google",
      callbackURL: callbackUrl,
    });
    if (error)
      return { error: error.message ?? "Google sign-in failed", ok: false };
    return { ok: true, url: callbackUrl };
  }

  if (provider === "credentials") {
    const res = await authClient.$fetch("/vaehor/sign-in/credentials", {
      method: "POST",
      body: {
        email: options.email,
        password: options.password,
      },
    });
    if (res.error) {
      return { error: res.error.message ?? "Invalid credentials", ok: false };
    }
    if (options.redirect !== false && typeof window !== "undefined") {
      window.location.href = callbackUrl;
    }
    return { ok: true, url: callbackUrl };
  }

  if (provider === "guest") {
    const res = await authClient.$fetch("/vaehor/sign-in/guest", {
      method: "POST",
      body: {},
    });
    if (res.error) {
      return { error: res.error.message ?? "Guest sign-in failed", ok: false };
    }
    if (options.redirect !== false && typeof window !== "undefined") {
      window.location.href = callbackUrl;
    }
    return { ok: true, url: callbackUrl };
  }

  return { error: `Unknown provider: ${provider}`, ok: false };
}

export async function signOut(options: { callbackUrl?: string } = {}) {
  await authClient.signOut();
  if (typeof window !== "undefined") {
    window.location.href = options.callbackUrl ?? "/login";
  }
}
