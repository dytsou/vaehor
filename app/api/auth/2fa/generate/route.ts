export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createUserRoute } from "@/lib/api-middleware";
import { generateSecret, generateURI } from "otplib";
import qrcode from "qrcode";
import { kv } from "@/lib/kv";

export const POST = createUserRoute(
  async ({ session }) => {
    try {
      const userEmail = session.user.email;
      if (!userEmail) {
        return NextResponse.json({ error: "Akses ditolak." }, { status: 401 });
      }

      const secret = generateSecret();
      const appName = "vaehor";

      await kv.set(`2fa:secret:temp:${userEmail}`, secret, { ex: 300 });

      const otpauth = generateURI({
        issuer: appName,
        label: userEmail,
        secret,
      });
      const qrCodeDataURL = await qrcode.toDataURL(otpauth);

      return NextResponse.json({ secret, qrCodeDataURL });
    } catch (error) {
      console.error("2FA Generate Error:", error);
      return NextResponse.json(
        { error: "Gagal membuat kode 2FA." },
        { status: 500 },
      );
    }
  },
  { requireEmail: true },
);
