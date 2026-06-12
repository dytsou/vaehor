import { NextResponse } from "next/server";
import { createPublicRoute } from "@/lib/api-middleware";
import {
  validateGlobalSearchAccess,
  parseGlobalSearchParams,
  executeGlobalSearch,
  globalSearchErrorResponse,
} from "@/lib/services/global-search";

export const dynamic = "force-dynamic";

export const GET = createPublicRoute(
  async ({ request, session }) => {
    const accessDenied = validateGlobalSearchAccess(request, session);
    if (accessDenied) {
      return accessDenied;
    }

    const paramsResult = parseGlobalSearchParams(
      new URL(request.url).searchParams,
    );
    if (!paramsResult.ok) {
      return paramsResult.error;
    }

    try {
      const files = await executeGlobalSearch(
        request,
        session!,
        paramsResult.params,
      );
      return NextResponse.json({ files });
    } catch (error: unknown) {
      return globalSearchErrorResponse(error);
    }
  },
  { includeSession: true, rateLimit: false },
);
