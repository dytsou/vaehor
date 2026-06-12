import { NextResponse, type NextRequest } from "next/server";
import path from "path";
import type { ShareLink as DbShareLink } from "@/generated/prisma/client";
import type { Session } from "next-auth";
import { jwtVerify } from "jose";
import { auth } from "@/auth";
import { logActivity } from "@/lib/activityLogger";
import { trackBandwidth } from "@/lib/analyticsTracker";
import { checkRateLimit } from "@/lib/ratelimit";
import { isAccessRestricted } from "@/lib/securityUtils";
import { kv } from "@/lib/kv";
import { db } from "@/lib/db";
import {
  authenticateShareRequest,
  shareGrantsAccessToFile,
  shouldBlockDueToPreventDownload,
  type ShareAuthOk,
} from "@/lib/share-scope";
import { logger } from "@/lib/logger";
import type { DriveFile } from "@/lib/drive";
import {
  EXPORT_TYPE_MAP,
  ERROR_MESSAGES,
  GOOGLE_DRIVE_API_BASE_URL,
} from "@/lib/constants";

export interface DownloadContext {
  fileId: string;
  shareToken: string | null;
  accessTokenParam: string | null;
  range: string | null;
  isStream: boolean;
  shareRecord?: DbShareLink;
}

export type DownloadErrorType = {
  error: string;
  status: number;
};

function getDownloadRateLimitIdentifier(
  request: NextRequest,
  fileId: string | null,
): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const requester = forwardedFor
    ? forwardedFor.split(",")[0].trim()
    : "127.0.0.1";

  return `${requester}:${fileId || "unknown"}`;
}

function createEmptyDownloadContext(): DownloadContext {
  return {
    fileId: "",
    shareToken: null,
    accessTokenParam: null,
    range: null,
    isStream: false,
  };
}

export async function validateDownloadRequest(request: NextRequest): Promise<{
  context: DownloadContext;
  session: Session | null;
  error?: DownloadErrorType;
}> {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get("fileId");
  const shareToken = searchParams.get("share_token");
  const accessTokenParam = searchParams.get("access_token");
  const range = request.headers.get("range");
  const rateLimitType = range ? "API" : "DOWNLOAD";
  const { success } = await checkRateLimit(
    request,
    rateLimitType,
    getDownloadRateLimitIdentifier(request, fileId),
  );
  if (!success) {
    return {
      context: createEmptyDownloadContext(),
      session: null,
      error: { error: ERROR_MESSAGES.DOWNLOAD_LIMIT_EXCEEDED, status: 429 },
    };
  }

  const session = await auth();
  let shareRecord: DbShareLink | undefined;
  let shareAuthOk: ShareAuthOk | undefined;

  if (shareToken) {
    const shareRes = await authenticateShareRequest(request);
    if (!shareRes) {
      return {
        context: createEmptyDownloadContext(),
        session,
        error: { error: ERROR_MESSAGES.INVALID_SHARE_TOKEN, status: 401 },
      };
    }
    if ("error" in shareRes) {
      return {
        context: createEmptyDownloadContext(),
        session,
        error: { error: shareRes.error, status: shareRes.status },
      };
    }
    shareAuthOk = shareRes;
    shareRecord = shareRes.shareRecord;
    if (
      shareRecord.preventDownload &&
      shouldBlockDueToPreventDownload(request)
    ) {
      return {
        context: createEmptyDownloadContext(),
        session,
        error: {
          error: "Unduhan dinonaktifkan untuk file ini.",
          status: 403,
        },
      };
    }
  }

  if (!fileId) {
    return {
      context: createEmptyDownloadContext(),
      session,
      error: { error: ERROR_MESSAGES.MISSING_FILE_ID, status: 400 },
    };
  }

  if (fileId.startsWith("local-storage:")) {
    const localRest = fileId.slice("local-storage:".length);
    if (
      localRest.length === 0 ||
      localRest.length > 4096 ||
      localRest.includes("..") ||
      /[\0\r\n]/.test(localRest)
    ) {
      return {
        context: createEmptyDownloadContext(),
        session,
        error: { error: ERROR_MESSAGES.INVALID_FILE_ID, status: 400 },
      };
    }
  } else {
    // Google Drive file IDs are URL path segments; disallow characters that can
    // change the path structure or introduce ambiguity.
    const fileIdPattern = /^[a-zA-Z0-9_-]+$/;
    if (!fileIdPattern.test(fileId) || fileId.length > 255) {
      return {
        context: createEmptyDownloadContext(),
        session,
        error: { error: ERROR_MESSAGES.INVALID_FILE_ID, status: 400 },
      };
    }
  }

  const userRole = session?.user?.role;

  if (shareToken && shareAuthOk) {
    const scopeOk = await shareGrantsAccessToFile(shareAuthOk, fileId);
    if (!scopeOk) {
      return {
        context: createEmptyDownloadContext(),
        session,
        error: { error: ERROR_MESSAGES.ACCESS_DENIED, status: 403 },
      };
    }
  }

  if (fileId.startsWith("local-storage:") && userRole !== "ADMIN") {
    const hasAccess = await import("@/lib/auth").then((m) =>
      m.checkLocalStorageAccess(request),
    );
    if (!hasAccess) {
      return {
        context: createEmptyDownloadContext(),
        session,
        error: { error: "Autentikasi Local Storage diperlukan", status: 401 },
      };
    }
  } else if (userRole !== "ADMIN") {
    const isRestricted = await isAccessRestricted(
      fileId,
      [],
      session?.user?.email,
    );

    if (isRestricted) {
      const authHeader = request.headers.get("Authorization");
      const token = authHeader?.split(" ")[1] || accessTokenParam;

      let accessGranted = false;
      if (token) {
        try {
          const secret = new TextEncoder().encode(
            process.env.SHARE_SECRET_KEY!,
          );
          const { payload } = await jwtVerify(token, secret);
          const authorizedFolderId = payload.folderId as string;

          if (authorizedFolderId) {
            const stillRestricted = await isAccessRestricted(
              fileId,
              [authorizedFolderId],
              session?.user?.email,
            );
            if (!stillRestricted) {
              accessGranted = true;
            }
          }
        } catch (e) {
          logger.error(
            { err: e },
            "[Download Service] Token verification failed",
          );
        }
      }

      if (!accessGranted) {
        return {
          context: createEmptyDownloadContext(),
          session,
          error: { error: ERROR_MESSAGES.ACCESS_DENIED, status: 403 },
        };
      }
    }
  }

  return {
    context: {
      fileId,
      shareToken,
      accessTokenParam,
      range,
      isStream: !!range,
      shareRecord,
    },
    session,
  };
}

export function prepareGoogleDriveUrl(
  fileId: string,
  fileDetails: Pick<DriveFile, "mimeType" | "name">,
): { url: string; mimeType: string; filename: string } {
  const safeFileId = encodeURIComponent(fileId);
  let downloadUrl = `${GOOGLE_DRIVE_API_BASE_URL}/files/${safeFileId}?alt=media&supportsAllDrives=true`;
  let responseMimeType = fileDetails.mimeType;
  let responseFileName = fileDetails.name;

  const isGoogleDoc = fileDetails.mimeType.startsWith(
    "application/vnd.google-apps.",
  );

  if (isGoogleDoc) {
    const exportInfo = EXPORT_TYPE_MAP[
      fileDetails.mimeType as keyof typeof EXPORT_TYPE_MAP
    ] || {
      mime: "application/pdf",
      ext: ".pdf",
    };
    downloadUrl = `${GOOGLE_DRIVE_API_BASE_URL}/files/${safeFileId}/export?mimeType=${encodeURIComponent(exportInfo.mime)}&supportsAllDrives=true`;
    responseMimeType = exportInfo.mime;
    if (!responseFileName.endsWith(exportInfo.ext)) {
      responseFileName += exportInfo.ext;
    }
  } else if (
    responseMimeType === "video/x-matroska" ||
    responseFileName.toLowerCase().endsWith(".mkv")
  ) {
    responseMimeType = "video/mp4";
  }

  return {
    url: downloadUrl,
    mimeType: responseMimeType,
    filename: responseFileName,
  };
}

export function prepareResponseHeaders(
  mimeType: string,
  filename: string,
  range: string | null,
  secFetchDest: string | null,
  googleResponse: Response | null,
  isHEAD: boolean = false,
  requestOrigin?: string | null,
): Headers {
  const responseHeaders = new Headers();
  const encodedFileName = encodeURIComponent(filename).replace(
    /['()]/g,
    (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase(),
  );

  const isDirectDownload = !range && !secFetchDest;
  const disposition = isDirectDownload ? "attachment" : "inline";

  responseHeaders.set("Content-Type", mimeType);
  responseHeaders.set(
    "Content-Disposition",
    `${disposition}; filename="${encodedFileName}"; filename*=UTF-8''${encodedFileName}`,
  );

  const isVideoOrAudio =
    mimeType.startsWith("video/") || mimeType.startsWith("audio/");
  if (isVideoOrAudio) {
    responseHeaders.set(
      "Cache-Control",
      "public, max-age=604800, no-transform",
    );
  } else {
    responseHeaders.set(
      "Cache-Control",
      "public, max-age=31536000, no-transform, immutable",
    );
  }

  responseHeaders.set("X-Accel-Buffering", "no");
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  responseHeaders.set("Connection", "keep-alive");

  const allowedOrigin = requestOrigin || process.env.NEXTAUTH_URL || "";
  responseHeaders.set("Access-Control-Allow-Origin", allowedOrigin);
  responseHeaders.set(
    "Access-Control-Expose-Headers",
    "Content-Range, Content-Length, Accept-Ranges",
  );

  if (isHEAD) return responseHeaders;

  responseHeaders.set("Transfer-Encoding", "chunked");

  const contentRange = googleResponse?.headers.get("Content-Range");
  if (contentRange) {
    responseHeaders.set("Content-Range", contentRange);
  }

  const contentLength = googleResponse?.headers.get("Content-Length");
  if (contentLength) {
    responseHeaders.set("Content-Length", contentLength);
  }

  responseHeaders.set("Accept-Ranges", "bytes");

  return responseHeaders;
}

export async function respondWithLocalStorageDownload(
  request: NextRequest,
  fileId: string,
  range: string | null,
): Promise<Response> {
  const { getLocalFilePath } = await import("@/lib/storage/local");
  const { getMimeType } = await import("@/lib/storage/mime");
  const { createReadStream } = await import("fs");
  const { stat } = await import("fs/promises");

  const localPath = fileId.replace("local-storage:", "");
  const absolutePath = await getLocalFilePath(localPath);
  const fileStats = await stat(absolutePath);

  if (fileStats.isDirectory()) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.FOLDER_DOWNLOAD_NOT_SUPPORTED },
      { status: 400 },
    );
  }

  const mimeType = getMimeType(absolutePath);
  const filename = path.basename(absolutePath);
  const stream = createReadStream(absolutePath);
  const webStream = new ReadableStream({
    start(controller) {
      stream.on("data", (chunk) => controller.enqueue(chunk));
      stream.on("end", () => controller.close());
      stream.on("error", (err) => controller.error(err));
    },
    cancel() {
      stream.destroy();
    },
  });

  const responseHeaders = prepareResponseHeaders(
    mimeType,
    filename,
    range,
    request.headers.get("Sec-Fetch-Dest"),
    null,
    false,
    request.headers.get("origin"),
  );
  responseHeaders.set("Content-Length", fileStats.size.toString());
  responseHeaders.set("Accept-Ranges", "bytes");

  return new Response(webStream, {
    status: 200,
    headers: responseHeaders,
  });
}

export function buildGoogleDriveFetchHeaders(
  accessToken: string,
  range: string | null,
  mimeType: string,
): Headers {
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("User-Agent", "Zee-Index-Streamer/1.0");
  headers.set("Accept-Encoding", "identity");

  const isGoogleDoc = mimeType.startsWith("application/vnd.google-apps.");
  if (range && !isGoogleDoc) {
    headers.set("Range", range);
  }

  return headers;
}

export function createGoogleDriveHeadResponse(
  request: NextRequest,
  fileDetails: Pick<DriveFile, "size">,
  mimeType: string,
  filename: string,
): Response {
  const headHeaders = prepareResponseHeaders(
    mimeType,
    filename,
    null,
    null,
    null,
    true,
    request.headers.get("origin"),
  );
  if (fileDetails.size) headHeaders.set("Content-Length", fileDetails.size);
  headHeaders.set("Accept-Ranges", "bytes");
  return new Response(null, { status: 200, headers: headHeaders });
}

export async function fetchGoogleDriveStream(
  url: string,
  headers: Headers,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    return await fetch(url, {
      headers,
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function googleDriveErrorResponse(
  googleResponse: Response,
  fileId: string,
): Promise<NextResponse | null> {
  if (googleResponse.ok) return null;

  const errorJson = await googleResponse.json().catch(() => ({}));
  logger.error({ errorJson, fileId }, "Google Drive API Error");
  return NextResponse.json(
    {
      error:
        errorJson.error?.message || "Gagal mengambil file dari Google Drive",
    },
    { status: googleResponse.status },
  );
}

function getDownloadUserIdentifier(
  request: NextRequest,
  session: Session | null,
): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const ip = forwardedFor
    ? forwardedFor.split(",")[0].trim()
    : realIp || "anonymous";
  return session?.user?.email || ip;
}

export async function recordDownloadMetrics(
  request: NextRequest,
  session: Session | null,
  context: DownloadContext,
  fileDetails: Pick<DriveFile, "name" | "size">,
  fileId: string,
  mimeType: string,
): Promise<void> {
  const userIdentifier = getDownloadUserIdentifier(request, session);
  const dedupeKey = `loop_prevent:download:${fileId}:${userIdentifier}`;
  const isDuplicate = await kv.get(dedupeKey);

  if (isDuplicate) {
    logger.info(
      { fileId, userIdentifier },
      "[Download] Skipping duplicate log",
    );
    return;
  }

  await kv.set(dedupeKey, "1", { ex: 5 });

  if (context.shareRecord) {
    try {
      await db.shareLink.update({
        where: { jti: context.shareRecord.jti },
        data: { views: { increment: 1 } },
      });
    } catch (e) {
      logger.error({ err: e }, "Failed to increment sharelink uses");
    }
  }

  logActivity("DOWNLOAD", {
    itemName: fileDetails.name,
    itemId: fileId,
    itemSize: fileDetails.size || "0",
    userEmail: session?.user?.email,
    metadata: {
      fileId,
      mimeType,
      rangeRequest: false,
      isShareAccess: !!context.shareRecord,
      shareLinkId: context.shareRecord?.jti,
    },
  }).catch((e) => logger.error({ err: e }, "Gagal mencatat log aktivitas"));

  const downloadSize = parseInt(fileDetails.size || "0", 10);
  if (downloadSize > 0) {
    trackBandwidth(downloadSize).catch(() => {});
  }
}
