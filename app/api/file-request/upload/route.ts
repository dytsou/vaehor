export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { createPublicRoute } from "@/lib/api-middleware";
import { getAccessToken } from "@/lib/drive";
import { kv } from "@/lib/kv";
import { logActivity } from "@/lib/activityLogger";
import { REDIS_KEYS } from "@/lib/constants";
import {
  fileRequestUploadInitSchema,
  parseFileRequestLink,
  type FileRequestLink,
} from "@/lib/link-payloads";
import { z } from "zod";

export const maxDuration = 60;
const GOOGLE_UPLOAD_HOST = "www.googleapis.com";
const GOOGLE_UPLOAD_PATH_PREFIX = "/upload/drive/v3/files";

const fileRequestUploadQuerySchema = z
  .object({
    type: z.enum(["init", "chunk"]),
    token: z.string().min(1),
    uploadUrl: z.string().url().optional(),
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

export function isAllowedResumableUploadUrl(uploadUrl: string): boolean {
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

async function loadFileRequest(token: string): Promise<FileRequestLink | null> {
  const requestData = parseFileRequestLink(
    await kv.hget(REDIS_KEYS.FILE_REQUESTS, token),
  );
  if (!requestData || Date.now() > requestData.expiresAt) {
    return null;
  }
  return requestData;
}

async function handleUploadInit(
  request: NextRequest,
  requestData: FileRequestLink,
  accessToken: string,
) {
  const parsedBody = fileRequestUploadInitSchema.safeParse(
    await request.json(),
  );
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const { name, mimeType, size } = parsedBody.data;
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
        parents: [requestData.folderId],
      }),
    },
  );

  if (!response.ok) throw new Error("Failed to init upload");
  const uploadUrl = response.headers.get("Location");
  return NextResponse.json({ uploadUrl });
}

async function invalidateFolderListCache(folderId: string) {
  const rolesToInvalidate = ["ADMIN", "USER", "GUEST"] as const;
  await Promise.all(
    rolesToInvalidate.map((role) =>
      kv.del(`folder:content:${folderId}:${role}:page1`),
    ),
  );
}

async function handleUploadChunk(
  request: NextRequest,
  uploadUrl: string,
  requestData: FileRequestLink,
) {
  const contentRange = request.headers.get("Content-Range");
  if (!contentRange || !isAllowedResumableUploadUrl(uploadUrl)) {
    return NextResponse.json(
      { error: "Missing params or invalid upload URL" },
      { status: 400 },
    );
  }

  const chunkBuffer = await request.arrayBuffer();
  const driveResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Length": chunkBuffer.byteLength.toString(),
      "Content-Range": contentRange,
    },
    body: chunkBuffer,
  });

  if (driveResponse.status === 308) {
    return NextResponse.json({ status: "partial" });
  }

  if (!driveResponse.ok) {
    throw new Error("Chunk upload failed");
  }

  const fileData = await driveResponse.json();
  await invalidateFolderListCache(requestData.folderId);
  await logActivity("UPLOAD", {
    itemName: fileData.name,
    itemSize: fileData.size,
    userEmail: "Public Uploader",
    destinationFolder: requestData.folderName,
  });

  return NextResponse.json({ status: "completed", file: fileData });
}

function uploadErrorResponse(error: unknown) {
  console.error("Public Upload Error:", error);
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  return NextResponse.json({ error: errorMessage }, { status: 500 });
}

export const POST = createPublicRoute(
  async ({ request, query }) => {
    const requestData = await loadFileRequest(query.token);
    if (!requestData) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 403 },
      );
    }

    try {
      const accessToken = await getAccessToken();

      if (query.type === "init") {
        return await handleUploadInit(request, requestData, accessToken);
      }

      if (query.type === "chunk") {
        return await handleUploadChunk(request, query.uploadUrl!, requestData);
      }
    } catch (error: unknown) {
      return uploadErrorResponse(error);
    }

    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  },
  { rateLimit: false, querySchema: fileRequestUploadQuerySchema },
);
