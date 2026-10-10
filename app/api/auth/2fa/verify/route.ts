export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createUserRoute } from "@/lib/api-middleware";
import { verify } from "otplib";
import { kv } from "@/lib/kv";
import { checkRateLimit } from "@/lib/ratelimit";
import { z } from "zod";
import { authServer } from "@/lib/auth-server";
import { clearSessionTwoFactorRequired } from "@/lib/auth-2fa-session";

const verifyTwoFactorSchema = z.object({
  token: z.string().min(1, "Kode verifikasi tidak valid."),
});

export const POST = createUserRoute(
  async ({ request, session, body }) => {
    const { success } = await checkRateLimit(request, "AUTH");
    if (!success) {
      return NextResponse.json(
        { error: "Terlalu banyak percobaan. Silakan coba lagi nanti." },
        { status: 429 },
      );
    }

    try {
      const { token } = body;
      const userEmail = session.user.email!;

      const tempSecret: string | null = await kv.get(
        `2fa:secret:temp:${userEmail}`,
      );
      const permanentSecret: string | null = tempSecret
        ? null
        : await kv.get(`2fa:secret:${userEmail}`);
      const secret = tempSecret ?? permanentSecret;
      if (!secret) {
        return NextResponse.json(
          { error: "Sesi pembuatan 2FA telah kedaluwarsa." },
          { status: 400 },
        );
      }

      const { valid: isValid } = await verify({ token, secret });
      if (!isValid) {
        return NextResponse.json(
          { error: "Kode verifikasi tidak valid." },
          { status: 400 },
        );
      }

      if (tempSecret) {
        await kv.set(`2fa:secret:${userEmail}`, secret);
        await kv.set(`2fa:enabled:${userEmail}`, true);
        await kv.del(`2fa:secret:temp:${userEmail}`);
      }

      const baSession = await authServer.api.getSession({
        headers: request.headers,
      });
      if (baSession?.session.token) {
        await clearSessionTwoFactorRequired(baSession.session.token);
      }

      return NextResponse.json({
        success: true,
        message: tempSecret
          ? "2FA berhasil diaktifkan."
          : "2FA berhasil diverifikasi.",
      });
    } catch (error) {
      console.error("2FA Verify Error:", error);
      return NextResponse.json(
        { error: "Gagal memverifikasi kode 2FA." },
        { status: 500 },
      );
    }
  },
  { requireEmail: true, rateLimit: false, bodySchema: verifyTwoFactorSchema },
);
