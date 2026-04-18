import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * When SETUP_SECRET is set, POST /api/setup/* must send the same value via
 * `X-Setup-Secret` or `Authorization: Bearer <token>`.
 */
export function requiresSetupSecret(): boolean {
  return Boolean(process.env.SETUP_SECRET?.trim());
}

export function verifySetupSecret(request: Request): NextResponse | null {
  const secret = process.env.SETUP_SECRET?.trim();
  if (!secret) {
    return null;
  }

  const header = request.headers.get("x-setup-secret")?.trim() ?? "";
  const auth = request.headers.get("authorization");
  const bearer =
    auth?.toLowerCase().startsWith("bearer ") === true
      ? auth.slice(7).trim()
      : "";

  const provided = header || bearer;
  if (!provided) {
    return NextResponse.json(
      {
        error:
          "Setup token required. Set SETUP_SECRET on the server and send it with X-Setup-Secret.",
      },
      { status: 403 },
    );
  }

  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(secret, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json(
      { error: "Invalid setup token." },
      { status: 403 },
    );
  }

  return null;
}
