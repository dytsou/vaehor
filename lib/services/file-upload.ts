import { NextResponse, type NextRequest } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { getAccessToken } from "@/lib/drive";
import { logActivity } from "@/lib/activityLogger";
import { invalidateFolderCache } from "@/lib/cache";

const GOOGLE_UPLOAD_HOST = "www.googleapis.com";
const GOOGLE_UPLOAD_PATH_PREFIX = "/upload/drive/v3/files";

export const uploadInitBodySchema = z.object({
  name: z.string().min(1),
  mimeType: z.string().min(1),
  parentId: z.string().min(1),
  size: z.number().nonnegative(),
});

export const uploadQuerySchema = z
  .object({
    type: z.enum(["init", "chunk"]),
    uploadUrl: z.string().url().optional(),
    parentId: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === "chunk" && !value.uploadUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["uploadUrl"],
        message: "uploadUrl wajib diisi untuk chunk upload.",
      });
    }
  });

export type UploadQuery = z.infer<typeof uploadQuerySchema>;

function isAllowedResumableUploadUrl(uploadUrl: string): boolean {
  try {
    const parsed = new URL(uploadUrl);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === GOOGLE_UPLOAD_HOST &&
      parsed.pathname.startsWith(GOOGLE_UPLOAD_PATH_PREFIX) &&
      parsed.searchParams.has("upload_id")
    );
  } catch {
    return false;
  }
}

function invalidChunkParamsResponse() {
  return NextResponse.json(
    { error: "Parameter uploadUrl tidak valid atau header kurang." },
    { status: 400 },
  );
}

async function recordChunkUploadActivity(
  session: Session,
  parentId: string | undefined,
  file: { name: string; id: string; size?: string | number; mimeType?: string },
) {
  if (parentId) {
    await invalidateFolderCache(parentId);
  }

  await logActivity("UPLOAD", {
    itemName: file.name,
    itemId: file.id,
    itemSize: file.size,
    userEmail: session.user?.email,
    status: "success",
    metadata: {
      operation: "file_upload",
      fileId: file.id,
      parentId: parentId || undefined,
      ...(file.mimeType ? { mimeType: file.mimeType } : {}),
      uploadType: "chunk",
    },
  });
}

export async function handleUploadInit(request: NextRequest) {
  const body = await request.json();
  const parsedBody = uploadInitBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Input upload init tidak valid.",
        details: parsedBody.error.issues,
      },
      { status: 400 },
    );
  }

  const { name, mimeType, parentId, size } = parsedBody.data;

  if (parentId.startsWith("local-storage:")) {
    return NextResponse.json({
      uploadUrl: `local-storage-upload://${encodeURIComponent(
        parentId,
      )}/${encodeURIComponent(name)}`,
    });
  }

  const accessToken = await getAccessToken();
  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Length": size.toString(),
        "X-Upload-Content-Type": mimeType,
      },
      body: JSON.stringify({
        name,
        mimeType,
        parents: [parentId],
      }),
    },
  );

  if (!response.ok) {
    throw new Error("Gagal menginisialisasi sesi upload dengan Google Drive.");
  }

  const uploadUrl = response.headers.get("Location");
  return NextResponse.json({ uploadUrl });
}

async function handleLocalStorageChunk(
  request: NextRequest,
  uploadUrl: string,
  parentId: string | undefined,
  session: Session,
) {
  const { saveLocalChunk } = await import("@/lib/storage/local");
  const chunkBuffer = await request.arrayBuffer();
  const contentRange = request.headers.get("Content-Range") || "";
  const result = await saveLocalChunk(uploadUrl, chunkBuffer, contentRange);

  if (result.status === "completed" && result.file) {
    await recordChunkUploadActivity(session, parentId, result.file);
  }

  return NextResponse.json(result);
}

async function handleGoogleDriveChunk(
  request: NextRequest,
  uploadUrl: string,
  parentId: string | undefined,
  session: Session,
) {
  const contentRange = request.headers.get("Content-Range");
  const contentLength = request.headers.get("Content-Length");
  const chunkBuffer = await request.arrayBuffer();
  const isEmptyChunk = chunkBuffer.byteLength === 0;

  if (!isAllowedResumableUploadUrl(uploadUrl)) {
    return invalidChunkParamsResponse();
  }

  if (!isEmptyChunk && !contentRange) {
    return invalidChunkParamsResponse();
  }

  const driveHeaders: Record<string, string> = {
    "Content-Length": contentLength ?? chunkBuffer.byteLength.toString(),
  };
  if (contentRange) {
    driveHeaders["Content-Range"] = contentRange;
  }

  const driveResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: driveHeaders,
    body: chunkBuffer.byteLength === 0 ? new Uint8Array(0) : chunkBuffer,
  });

  if (driveResponse.status === 308) {
    return NextResponse.json({ status: "partial" });
  }

  if (!driveResponse.ok) {
    throw new Error("Gagal mengunggah chunk ke Google Drive.");
  }

  const fileData = await driveResponse.json();
  await recordChunkUploadActivity(session, parentId, fileData);
  return NextResponse.json({ status: "completed", file: fileData });
}

export async function handleUploadChunk(
  request: NextRequest,
  uploadUrl: string,
  parentId: string | undefined,
  session: Session,
) {
  if (uploadUrl.startsWith("local-storage-upload://")) {
    return handleLocalStorageChunk(request, uploadUrl, parentId, session);
  }

  return handleGoogleDriveChunk(request, uploadUrl, parentId, session);
}

export function uploadErrorResponse(error: unknown) {
  const errorMessage =
    error instanceof Error ? error.message : "Terjadi kesalahan tidak dikenal.";
  console.error("Upload API Error:", error);
  return NextResponse.json(
    { error: errorMessage || "Internal Server Error." },
    { status: 500 },
  );
}
