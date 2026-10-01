import { jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import { isAccessRestricted } from "@/lib/securityUtils";

export function getFolderAccessToken(
  request: NextRequest,
  fallbackToken?: string | null,
): string | null {
  const folderToken = request.headers.get("x-folder-access-token")?.trim();
  if (folderToken) return folderToken;
  if (fallbackToken) return fallbackToken;
  return request.headers.get("Authorization")?.split(" ")[1] ?? null;
}

export async function getAuthorizedFolderIds(
  request: NextRequest,
  fallbackToken?: string | null,
): Promise<string[]> {
  const token = getFolderAccessToken(request, fallbackToken);
  const secretValue = process.env.SHARE_SECRET_KEY;
  if (!token || !secretValue) return [];

  try {
    const secret = new TextEncoder().encode(secretValue);
    const { payload } = await jwtVerify(token, secret);
    return typeof payload.folderId === "string" ? [payload.folderId] : [];
  } catch {
    return [];
  }
}

export async function hasFolderAccessTokenAccess(
  request: NextRequest,
  folderId: string,
  userEmail?: string | null,
  fallbackToken?: string | null,
): Promise<boolean> {
  const authorizedFolderIds = await getAuthorizedFolderIds(
    request,
    fallbackToken,
  );
  return (
    authorizedFolderIds.length > 0 &&
    !(await isAccessRestricted(folderId, authorizedFolderIds, userEmail))
  );
}
