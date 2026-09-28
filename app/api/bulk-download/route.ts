export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createPublicRoute } from "@/lib/api-middleware";
import { getAccessToken } from "@/lib/drive";
import JSZip from "jszip";
import { isAccessRestricted } from "@/lib/securityUtils";
import { z } from "zod";
import {
  BulkDownloadLimitError,
  MAX_BULK_DOWNLOAD_BYTES,
  readResponseWithinByteLimit,
} from "@/lib/bulk-download-limits";

const bulkDownloadSchema = z.object({
  fileIds: z
    .array(z.string().min(1))
    .min(1, "Parameter fileIds tidak valid.")
    .max(20, "Maksimal 20 file per unduhan sekaligus."),
});

async function addFileToArchive(
  zip: JSZip,
  fileId: string,
  accessToken: string,
  remainingBytes: number,
  role: string | undefined,
  email: string | undefined,
): Promise<number | null> {
  if (role !== "ADMIN" && (await isAccessRestricted(fileId, [], email))) {
    return null;
  }

  const driveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const detailsUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name`;
  const headers = { Authorization: `Bearer ${accessToken}` };
  const detailsResponse = await fetch(detailsUrl, { headers });
  if (!detailsResponse.ok) return null;

  const fileDetails = await detailsResponse.json();
  const fileName = fileDetails.name || fileId;
  const fileResponse = await fetch(driveUrl, { headers });
  if (!fileResponse.ok) return null;

  const fileBuffer = await readResponseWithinByteLimit(
    fileResponse,
    remainingBytes,
  );
  zip.file(fileName, fileBuffer);
  return fileBuffer.byteLength;
}

export const POST = createPublicRoute(
  async ({ body, session }) => {
    try {
      if (!session?.user) {
        return NextResponse.json(
          { error: "Authentication required for bulk download." },
          { status: 401 },
        );
      }

      const { fileIds } = body;

      const accessToken = await getAccessToken();
      const zip = new JSZip();
      let addedCount = 0;
      let totalBytes = 0;

      for (const fileId of fileIds) {
        const addedBytes = await addFileToArchive(
          zip,
          fileId,
          accessToken,
          MAX_BULK_DOWNLOAD_BYTES - totalBytes,
          session.user.role,
          session.user.email ?? undefined,
        );
        if (addedBytes === null) continue;
        totalBytes += addedBytes;
        addedCount += 1;
      }

      if (addedCount === 0) {
        return NextResponse.json(
          { error: "No files could be included in the archive." },
          { status: 400 },
        );
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });

      const headers = new Headers();
      headers.set("Content-Type", "application/zip");
      headers.set("Content-Disposition", 'attachment; filename="download.zip"');

      return new NextResponse(zipBlob, { status: 200, headers });
    } catch (error: unknown) {
      if (error instanceof BulkDownloadLimitError) {
        return NextResponse.json({ error: error.message }, { status: 413 });
      }
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Terjadi kesalahan tidak dikenal.";
      console.error(errorMessage);
      return NextResponse.json(
        { error: "Internal Server Error." },
        { status: 500 },
      );
    }
  },
  { includeSession: true, rateLimit: false, bodySchema: bulkDownloadSchema },
);
