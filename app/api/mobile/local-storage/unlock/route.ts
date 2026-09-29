import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { z } from "zod";
import { createUserRoute } from "@/lib/api-middleware";
import { getAppConfig, isHashedLocalStoragePassword } from "@/lib/app-config";
import { db } from "@/lib/db";
import { getLocalStorageAuthSecret } from "@/lib/local-auth-secret";

const bodySchema = z.object({ password: z.string().min(1).max(1024) });

export const POST = createUserRoute(
  async ({ request, body }) => {
    if (!request.headers.get("authorization")?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const secret = getLocalStorageAuthSecret();
    if (!secret) {
      return NextResponse.json(
        { error: "Server authentication secret is not configured." },
        { status: 503 },
      );
    }

    try {
      const config = await getAppConfig();
      const dbProtected = await db.protectedFolder.findUnique({
        where: { folderId: "local-storage:" },
      });

      let passwordIsValid = false;
      if (dbProtected?.password) {
        passwordIsValid = await bcrypt.compare(
          body.password,
          dbProtected.password,
        );
      } else if (
        config.localStorageAuthEnabled &&
        config.localStoragePassword
      ) {
        passwordIsValid = isHashedLocalStoragePassword(
          config.localStoragePassword,
        )
          ? await bcrypt.compare(body.password, config.localStoragePassword)
          : body.password === config.localStoragePassword;
      } else if (!config.localStorageAuthEnabled) {
        return NextResponse.json({ success: true, protected: false });
      }

      if (!passwordIsValid) {
        return NextResponse.json(
          { error: "The local storage password is incorrect." },
          { status: 403 },
        );
      }

      const token = await new SignJWT({ unlocked: true })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("24h")
        .sign(secret);

      return NextResponse.json({ success: true, protected: true, token });
    } catch {
      return NextResponse.json(
        { error: "Could not unlock local storage." },
        { status: 500 },
      );
    }
  },
  { bodySchema, rateLimit: "AUTH" },
);
