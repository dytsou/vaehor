import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";
import type { NextAuthConfig } from "next-auth";
import { authorizeCredentials } from "@/lib/services/credential-auth";
import { handleJwtCallback } from "@/lib/services/auth-jwt";

const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(db as any),
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    }),
    Credentials({
      id: "guest",
      name: "Guest",
      credentials: {},
      async authorize() {
        const { getAppConfig } = await import("@/lib/app-config");
        const config = await getAppConfig();
        if (config.disableGuestLogin) {
          return null;
        }

        return {
          id: "guest",
          name: "Guest",
          email: undefined,
          role: "GUEST",
        };
      },
    }),
    Credentials({
      id: "credentials",
      name: "Email & Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: authorizeCredentials,
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    jwt: handleJwtCallback,
    async session({ session, token }) {
      if (session.user) {
        const role = (token.role as any) || "USER";
        session.user.role = role;
        session.user.email = token.email as string;
        session.user.isGuest =
          token.isGuest ?? (role ? role === "GUEST" : false);
      }
      return session;
    },
  },
  session: {
    strategy: "jwt",
  },
  cookies: {
    sessionToken: {
      name: `authjs.session-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NEXTAUTH_URL?.startsWith("https://") ?? false,
      },
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
};

export const { handlers, signIn, signOut, auth } = NextAuth(authConfig);
