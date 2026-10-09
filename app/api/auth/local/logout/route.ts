import { NextResponse } from "next/server";

export function POST() {
  const response = NextResponse.json({ success: true, message: "Logged out" });
  response.cookies.set("local_storage_token", "", {
    maxAge: 0,
    path: "/",
  });
  return response;
}
