import { NextRequest, NextResponse } from "next/server";

const maxStateLength = 256;
const maxCodeLength = 4096;

export function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const state = searchParams.get("state") ?? "";
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (
    !state ||
    state.length > maxStateLength ||
    (!code && !error) ||
    (code !== null && code.length > maxCodeLength) ||
    (error !== null && error.length > 256)
  ) {
    return NextResponse.json(
      { error: "Invalid OAuth callback." },
      { status: 400 },
    );
  }

  const appUrl = new URL("vaehor:///setup");
  appUrl.searchParams.set("serverOrigin", request.nextUrl.origin);
  appUrl.searchParams.set("state", state);
  if (code) appUrl.searchParams.set("code", code);
  if (error) appUrl.searchParams.set("error", error);

  const response = NextResponse.redirect(appUrl, { status: 302 });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
