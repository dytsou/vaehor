import { NextResponse, type NextRequest } from "next/server";
import type { Session } from "next-auth";
import { getAnyFileDetails } from "@/lib/storage";
import { isAccessRestricted } from "@/lib/securityUtils";
import {
  authenticateShareRequest,
  shareGrantsAccessToFile,
  type ShareAuthOk,
} from "@/lib/share-scope";

export type FileDetailsAuthResult = {
  shareAuthOk?: ShareAuthOk;
  error?: NextResponse;
};

export type FileIdParseResult =
  | { ok: true; fileId: string }
  | { ok: false; error: NextResponse };

export async function resolveFileDetailsAuth(
  request: NextRequest,
  hasShareToken: boolean,
  session: Session | null,
): Promise<FileDetailsAuthResult> {
  if (hasShareToken) {
    const shareRes = await authenticateShareRequest(request);
    if (!shareRes || "error" in shareRes) {
      return {
        error: NextResponse.json(
          {
            error:
              (shareRes && "error" in shareRes && shareRes.error) ||
              "Invalid share token.",
          },
          {
            status: shareRes && "error" in shareRes ? shareRes.status : 401,
          },
        ),
      };
    }
    return { shareAuthOk: shareRes };
  }

  if (!session) {
    return {
      error: NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      ),
    };
  }

  return {};
}

export function parseFileIdParam(
  searchParams: URLSearchParams,
): FileIdParseResult {
  const fileIdRaw = searchParams.get("fileId");
  if (!fileIdRaw) {
    return {
      ok: false,
      error: NextResponse.json(
        { error: "Parameter fileId tidak ditemukan." },
        { status: 400 },
      ),
    };
  }

  return { ok: true, fileId: decodeURIComponent(fileIdRaw) };
}

export async function ensureShareFileAccess(
  shareAuthOk: ShareAuthOk | undefined,
  fileId: string,
): Promise<NextResponse | null> {
  if (!shareAuthOk) {
    return null;
  }

  const allowed = await shareGrantsAccessToFile(shareAuthOk, fileId);
  if (!allowed) {
    return NextResponse.json(
      { error: "This share link does not allow access to this file." },
      { status: 403 },
    );
  }

  return null;
}

export async function ensureFileDetailsAccess(
  request: NextRequest,
  fileId: string,
  session: Session | null,
  shareAuthOk: ShareAuthOk | undefined,
): Promise<NextResponse | null> {
  const isAdmin = session?.user?.role === "ADMIN";

  if (fileId.startsWith("local-storage:") && !isAdmin) {
    const { checkLocalStorageAccess } = await import("@/lib/auth");
    const hasAccess = await checkLocalStorageAccess(request);
    if (!hasAccess) {
      return NextResponse.json(
        {
          error: "Autentikasi Local Storage diperlukan",
          isLocalAuthNeeded: true,
        },
        { status: 401 },
      );
    }
    return null;
  }

  if (!isAdmin && !shareAuthOk) {
    const isRestricted = await isAccessRestricted(fileId);
    if (isRestricted) {
      return NextResponse.json({ error: "Access Denied" }, { status: 403 });
    }
  }

  return null;
}

export function fileDetailsFetchErrorResponse(error: unknown) {
  const errorMessage =
    error instanceof Error ? error.message : "Terjadi kesalahan tidak dikenal.";
  console.error("File Details API Error:", errorMessage);
  return NextResponse.json(
    { error: "Gagal mengambil detail file.", details: errorMessage },
    { status: 500 },
  );
}

export async function loadFileDetails(fileId: string) {
  return getAnyFileDetails(fileId);
}
