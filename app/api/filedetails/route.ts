import { NextResponse } from "next/server";
import { createPublicRoute } from "@/lib/api-middleware";
import { getAnyFileDetails } from "@/lib/storage";
import { isAccessRestricted } from "@/lib/securityUtils";
import {
  authenticateShareRequest,
  shareGrantsAccessToFile,
  type ShareAuthOk,
} from "@/lib/share-scope";

export const dynamic = "force-dynamic";

export const GET = createPublicRoute(
  async ({ request, session }) => {
    const { searchParams } = new URL(request.url);
    const hasShareToken = searchParams.has("share_token");
    let shareAuthOk: ShareAuthOk | undefined;

    if (hasShareToken) {
      const shareRes = await authenticateShareRequest(request);
      if (!shareRes || "error" in shareRes) {
        return NextResponse.json(
          {
            error:
              (shareRes && "error" in shareRes && shareRes.error) ||
              "Invalid share token.",
          },
          {
            status: shareRes && "error" in shareRes ? shareRes.status : 401,
          },
        );
      }
      shareAuthOk = shareRes;
    } else if (!session) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    }

    const fileIdRaw = searchParams.get("fileId");
    if (!fileIdRaw) {
      return NextResponse.json(
        { error: "Parameter fileId tidak ditemukan." },
        { status: 400 },
      );
    }
    const fileId = decodeURIComponent(fileIdRaw);

    if (shareAuthOk) {
      const allowed = await shareGrantsAccessToFile(shareAuthOk, fileId);
      if (!allowed) {
        return NextResponse.json(
          { error: "This share link does not allow access to this file." },
          { status: 403 },
        );
      }
    }

    const isAdmin = session?.user?.role === "ADMIN";

    if (fileId.startsWith("local-storage:") && !isAdmin) {
      const hasAccess = await import("@/lib/auth").then((m) =>
        m.checkLocalStorageAccess(request),
      );
      if (!hasAccess) {
        return NextResponse.json(
          {
            error: "Autentikasi Local Storage diperlukan",
            isLocalAuthNeeded: true,
          },
          { status: 401 },
        );
      }
    } else if (!isAdmin && !shareAuthOk) {
      const isRestricted = await isAccessRestricted(fileId);
      if (isRestricted) {
        return NextResponse.json({ error: "Access Denied" }, { status: 403 });
      }
    }

    try {
      const details = await getAnyFileDetails(fileId);
      return NextResponse.json(details);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Terjadi kesalahan tidak dikenal.";
      console.error("File Details API Error:", errorMessage);
      return NextResponse.json(
        { error: "Gagal mengambil detail file.", details: errorMessage },
        { status: 500 },
      );
    }
  },
  { includeSession: true, rateLimit: false },
);
