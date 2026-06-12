import { NextResponse, type NextRequest } from "next/server";
import { createPublicRoute } from "@/lib/api-middleware";
import { getAccessToken, getFileDetailsFromDrive } from "@/lib/drive";
import { logger } from "@/lib/logger";
import { ERROR_MESSAGES } from "@/lib/constants";
import {
  validateDownloadRequest,
  prepareGoogleDriveUrl,
  prepareResponseHeaders,
  respondWithLocalStorageDownload,
  buildGoogleDriveFetchHeaders,
  createGoogleDriveHeadResponse,
  fetchGoogleDriveStream,
  googleDriveErrorResponse,
  recordDownloadMetrics,
} from "@/lib/services/download";

export const dynamic = "force-dynamic";

function folderDownloadNotSupported() {
  return NextResponse.json(
    { error: ERROR_MESSAGES.FOLDER_DOWNLOAD_NOT_SUPPORTED },
    { status: 400 },
  );
}

function fileNotFound() {
  return NextResponse.json(
    { error: ERROR_MESSAGES.FILE_NOT_FOUND },
    { status: 404 },
  );
}

async function handleGoogleDriveDownload(
  request: NextRequest,
  fileId: string,
  range: string | null,
  context: Awaited<ReturnType<typeof validateDownloadRequest>>["context"],
  session: Awaited<ReturnType<typeof validateDownloadRequest>>["session"],
) {
  const [accessToken, fileDetails] = await Promise.all([
    getAccessToken(),
    getFileDetailsFromDrive(fileId),
  ]);

  if (!fileDetails) return fileNotFound();
  if (fileDetails.mimeType === "application/vnd.google-apps.folder") {
    return folderDownloadNotSupported();
  }

  const { url, mimeType, filename } = prepareGoogleDriveUrl(
    fileId,
    fileDetails,
  );
  const googleRequestHeaders = buildGoogleDriveFetchHeaders(
    accessToken,
    range,
    fileDetails.mimeType,
  );

  if (request.method === "HEAD") {
    return createGoogleDriveHeadResponse(
      request,
      fileDetails,
      mimeType,
      filename,
    );
  }

  const googleResponse = await fetchGoogleDriveStream(
    url,
    googleRequestHeaders,
  );
  const driveError = await googleDriveErrorResponse(googleResponse, fileId);
  if (driveError) return driveError;

  const responseHeaders = prepareResponseHeaders(
    mimeType,
    filename,
    range,
    request.headers.get("Sec-Fetch-Dest"),
    googleResponse,
    false,
    request.headers.get("origin"),
  );

  if (!range) {
    await recordDownloadMetrics(
      request,
      session,
      context,
      fileDetails,
      fileId,
      mimeType,
    );
  }

  return new Response(googleResponse.body, {
    status: googleResponse.status,
    headers: responseHeaders,
  });
}

async function handleDownload(request: NextRequest) {
  try {
    const { context, session, error } = await validateDownloadRequest(request);
    if (error) {
      return NextResponse.json(
        { error: error.error },
        { status: error.status },
      );
    }

    const { fileId, range } = context;
    logger.info({ fileId }, "[Download] Starting download");

    if (fileId.startsWith("local-storage:")) {
      return respondWithLocalStorageDownload(request, fileId, range);
    }

    return handleGoogleDriveDownload(request, fileId, range, context, session);
  } catch (error: unknown) {
    logger.error({ err: error }, "Download API Error");
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : ERROR_MESSAGES.INTERNAL_SERVER_ERROR,
      },
      { status: 500 },
    );
  }
}

export const GET = createPublicRoute(
  async ({ request }) => {
    return await handleDownload(request);
  },
  { rateLimit: false },
);

export const HEAD = createPublicRoute(
  async ({ request }) => {
    return await handleDownload(request);
  },
  { rateLimit: false },
);
