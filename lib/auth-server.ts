import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "@/lib/db";
import { vaehorCredentialsPlugin } from "@/lib/auth-credentials-plugin";

/**
 * Better Auth server (vinext sole-default). Credential/guest via plugin;
 * Google via socialProviders.
 */
export const authServer = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? process.env.NEXTAUTH_URL,
  emailAndPassword: {
    enabled: false,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "USER",
        required: false,
        input: false,
      },
    },
  },
  session: {
    additionalFields: {
      twoFactorRequired: {
        type: "boolean",
        defaultValue: false,
        required: false,
        input: false,
      },
      isGuest: {
        type: "boolean",
        defaultValue: false,
        required: false,
        input: false,
      },
    },
  },
  plugins: [vaehorCredentialsPlugin()],
});

export type AuthSession = typeof authServer.$Infer.Session;
