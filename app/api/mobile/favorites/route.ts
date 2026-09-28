import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidateTag } from "next/cache";
import { createUserRoute } from "@/lib/api-middleware";
import { db } from "@/lib/db";
import { getFileDetailsFromDrive } from "@/lib/drive";
import { kv } from "@/lib/kv";
import { isPrivateFolder } from "@/lib/auth";
import { findProtectedFolderAncestorId } from "@/lib/protected-folder-ancestor";

const favoriteSchema = z.object({
  fileId: z.string().min(1),
  isFavorite: z.boolean(),
});

const FAVORITES_PAGE_SIZE = 30;
const DRIVE_LOOKUP_BATCH_SIZE = 6;
const compareFavoriteIds = (left: string, right: string) =>
  left.localeCompare(right, "en-US", { sensitivity: "variant" });

export const GET = createUserRoute(
  async ({ session, request }) => {
    const email = session.user.email!;
    const favoritesKey = `user:${email}:favorites`;
    const ids = [
      ...new Set((await kv.smembers(favoritesKey)).filter(Boolean)),
    ].sort(compareFavoriteIds);
    const { searchParams } = new URL(request.url);

    if (searchParams.get("idsOnly") === "true") {
      return NextResponse.json({ favoriteIds: ids });
    }

    const pageToken = searchParams.get("pageToken");
    const firstIdAfterCursor = pageToken
      ? ids.findIndex((id) => compareFavoriteIds(id, pageToken) > 0)
      : 0;
    const start = firstIdAfterCursor < 0 ? ids.length : firstIdAfterCursor;
    const pageIds = ids.slice(start, start + FAVORITES_PAGE_SIZE);
    const entries: {
      id: string;
      file: Awaited<ReturnType<typeof getFileDetailsFromDrive>>;
    }[] = [];

    for (
      let index = 0;
      index < pageIds.length;
      index += DRIVE_LOOKUP_BATCH_SIZE
    ) {
      const batch = pageIds.slice(index, index + DRIVE_LOOKUP_BATCH_SIZE);
      entries.push(
        ...(await Promise.all(
          batch.map(async (id) => ({
            id,
            file: await getFileDetailsFromDrive(id),
          })),
        )),
      );
    }

    const protectedFolders = await db.protectedFolder.findMany({
      select: { folderId: true },
    });

    const missingIds = entries
      .filter(({ file }) => !file || file.trashed)
      .map(({ id }) => id);
    if (missingIds.length > 0) {
      await Promise.all(missingIds.map((id) => kv.srem(favoritesKey, id)));
    }

    const protectedIds = new Set(
      protectedFolders.map(({ folderId }) => folderId),
    );
    const folderDetailsById = new Map<
      string,
      ReturnType<typeof getFileDetailsFromDrive>
    >();
    const getCachedFolderDetails = (folderId: string) => {
      let details = folderDetailsById.get(folderId);
      if (!details) {
        details = getFileDetailsFromDrive(folderId);
        folderDetailsById.set(folderId, details);
      }
      return details;
    };
    const protectedAncestorIds = await Promise.all(
      entries.map(({ file }) =>
        file && !file.trashed
          ? findProtectedFolderAncestorId(
              file,
              protectedIds,
              isPrivateFolder,
              getCachedFolderDetails,
            )
          : undefined,
      ),
    );
    const files = entries.flatMap(({ file }, index) => {
      if (!file || file.trashed) return [];
      const protectedFolderId = protectedAncestorIds[index];
      return [
        {
          ...file,
          isFolder: file.mimeType === "application/vnd.google-apps.folder",
          isProtected: protectedFolderId !== undefined,
          ...(protectedFolderId ? { protectedFolderId } : {}),
        },
      ];
    });

    const nextPageToken =
      start + pageIds.length < ids.length ? pageIds.at(-1) : undefined;

    return NextResponse.json({ files, nextPageToken });
  },
  { requireEmail: true },
);

export const POST = createUserRoute(
  async ({ session, body }) => {
    const email = session.user.email!;
    const favoritesKey = `user:${email}:favorites`;
    if (body.isFavorite) {
      await kv.sadd(favoritesKey, body.fileId);
    } else {
      await kv.srem(favoritesKey, body.fileId);
    }
    revalidateTag("favorites", "max");
    return NextResponse.json({ success: true, isFavorite: body.isFavorite });
  },
  { bodySchema: favoriteSchema, requireEmail: true },
);
