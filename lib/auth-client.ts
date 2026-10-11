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

type SignInResult = { error?: string; ok?: boolean; url?: string };

type SignInOptions = {
  email?: string;
  password?: string;
  callbackUrl?: string;
  redirect?: boolean;
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

function maybeRedirect(url: string, redirect: boolean | undefined) {
  if (redirect !== false && typeof window !== "undefined") {
    window.location.href = url;
  }
}

async function signInGoogle(callbackUrl: string): Promise<SignInResult> {
  const { error } = await authClient.signIn.social({
    provider: "google",
    callbackURL: callbackUrl,
  });
  if (error) {
    return { error: error.message ?? "Google sign-in failed", ok: false };
  }
  return { ok: true, url: callbackUrl };
}

async function signInCredentials(
  options: SignInOptions,
  callbackUrl: string,
): Promise<SignInResult> {
  const res = await authClient.$fetch<{
    twoFactorRequired?: boolean;
  }>("/vaehor/sign-in/credentials", {
    method: "POST",
    body: {
      email: options.email,
      password: options.password,
    },
  });
  if (res.error) {
    return { error: res.error.message ?? "Invalid credentials", ok: false };
  }
  const nextUrl = res.data?.twoFactorRequired
    ? `/verify-2fa?callbackUrl=${encodeURIComponent(callbackUrl)}`
    : callbackUrl;
  maybeRedirect(nextUrl, options.redirect);
  return { ok: true, url: nextUrl };
}

async function signInGuest(
  options: SignInOptions,
  callbackUrl: string,
): Promise<SignInResult> {
  const res = await authClient.$fetch("/vaehor/sign-in/guest", {
    method: "POST",
    body: {},
  });
  if (res.error) {
    return { error: res.error.message ?? "Guest sign-in failed", ok: false };
  }
  maybeRedirect(callbackUrl, options.redirect);
  return { ok: true, url: callbackUrl };
}

/**
 * NextAuth-shaped signIn: google | credentials | guest.
 */
export async function signIn(
  provider: string,
  options: SignInOptions = {},
): Promise<SignInResult | undefined> {
  const callbackUrl = options.callbackUrl ?? "/";

  if (provider === "google") return signInGoogle(callbackUrl);
  if (provider === "credentials") {
    return signInCredentials(options, callbackUrl);
  }
  if (provider === "guest") return signInGuest(options, callbackUrl);

  return { error: `Unknown provider: ${provider}`, ok: false };
}

export async function signOut(options: { callbackUrl?: string } = {}) {
  await authClient.signOut();
  if (typeof window !== "undefined") {
    window.location.href = options.callbackUrl ?? "/login";
  }
}
