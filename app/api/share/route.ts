export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createAdminRoute } from "@/lib/api-middleware";
import { shareCreateRequestSchema } from "@/lib/link-payloads";
import {
  getShareLocale,
  getShareTranslator,
  validateShareCreateRequest,
  createShareLink,
  shareCreateErrorResponse,
} from "@/lib/services/share-create";

export const POST = createAdminRoute(
  async ({ body, session, request }) => {
    const locale = getShareLocale(request);
    const t = await getShareTranslator(locale);

    try {
      const validationError = validateShareCreateRequest(body, t);
      if (validationError) {
        return validationError;
      }

      const result = await createShareLink(body, session, locale, t);
      return NextResponse.json(result);
    } catch (error) {
      return shareCreateErrorResponse(t, error);
    }
  },
  { requireEmail: true, bodySchema: shareCreateRequestSchema },
);
