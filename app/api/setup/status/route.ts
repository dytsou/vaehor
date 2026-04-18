export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requiresSetupSecret } from "@/lib/setup-secret";

export function GET() {
  return NextResponse.json({ requiresSetupToken: requiresSetupSecret() });
}
