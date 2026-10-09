import { NextResponse } from "next/server";
import { mapAsyncInBatches } from "@/lib/async-sequence";
import { createAdminRoute } from "@/lib/api-middleware";
import { kv } from "@/lib/kv";
import { z } from "zod";

const FOLDERS_WITH_ACCESS_KEY = "vaehor:user-access:folders";
const getFolderAccessKey = (folderId: string) => `folder:access:${folderId}`;

const accessSchema = z.object({
  folderId: z.string().min(5, "Folder ID tidak valid."),
  email: z.string().email("Format email tidak valid."),
});

export const dynamic = "force-dynamic";

export const GET = createAdminRoute(async () => {
  try {
    const folderIds: string[] = await kv.smembers(FOLDERS_WITH_ACCESS_KEY);
    const entries = await mapAsyncInBatches(folderIds, 20, async (folderId) => {
      const emails: string[] = await kv.smembers(getFolderAccessKey(folderId));
      return emails.length > 0 ? ([folderId, emails] as const) : null;
    });
    const permissions = Object.fromEntries(
      entries.filter((entry) => entry !== null),
    );

    return NextResponse.json(permissions);
  } catch {
    return NextResponse.json(
      { error: "Gagal mengambil data." },
      { status: 500 },
    );
  }
});

export const POST = createAdminRoute(
  async ({ body }) => {
    try {
      const { folderId, email } = body;

      await kv.sadd(FOLDERS_WITH_ACCESS_KEY, folderId);
      await kv.sadd(getFolderAccessKey(folderId), email);

      return NextResponse.json({
        success: true,
        message: `Akses untuk ${email} ke folder ${folderId} telah ditambahkan.`,
      });
    } catch (error) {
      console.error("Gagal menambah akses pengguna:", error);
      return NextResponse.json(
        { error: "Gagal memproses permintaan." },
        { status: 500 },
      );
    }
  },
  { bodySchema: accessSchema },
);

export const DELETE = createAdminRoute(
  async ({ body }) => {
    try {
      const { folderId, email } = body;

      await kv.srem(getFolderAccessKey(folderId), email);

      const remainingEmails = await kv.scard(getFolderAccessKey(folderId));
      if (remainingEmails === 0) {
        await kv.srem(FOLDERS_WITH_ACCESS_KEY, folderId);
      }

      return NextResponse.json({
        success: true,
        message: `Akses untuk ${email} dari folder ${folderId} telah dihapus.`,
      });
    } catch (error) {
      console.error("Gagal menghapus akses pengguna:", error);
      return NextResponse.json(
        { error: "Gagal memproses permintaan." },
        { status: 500 },
      );
    }
  },
  { bodySchema: accessSchema },
);
