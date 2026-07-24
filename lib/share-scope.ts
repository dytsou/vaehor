import type { NextRequest } from "next/server";
import type { ShareLink } from "@/generated/prisma/client";
import { jwtVerify } from "jose";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { kv } from "@/lib/kv";
import { getFileDetailsFromDrive } from "@/lib/drive";
import { ERROR_MESSAGES, MIME_TYPES, REDIS_KEYS } from "@/lib/constants";
import { parseShareCollectionItems } from "@/lib/link-payloads";

export type ParsedSharePath =
  | { kind: "folder"; folderId: string }
  | { kind: "file"; folderId: string; fileId: string }
  | { kind: "collection"; shareId: string };

export function parseShareLinkPath(path: string): ParsedSharePath | null {
  const trimmed = path.trim();
  const collectionMatch = /^\/share\/([^/]+)\/?$/.exec(trimmed);
  if (collectionMatch) {
    return { kind: "collection", shareId: collectionMatch[1] };
  }
  const fileMatch = /^\/folder\/([^/]+)\/file\/([^/]+)(?:\/|$)/.exec(trimmed);
  if (fileMatch) {
    return {
      kind: "file",
      folderId: decodeURIComponent(fileMatch[1]),
      fileId: decodeURIComponent(fileMatch[2]),
    };
  }
  const folderMatch = /^\/folder\/([^/]+)\/?$/.exec(trimmed);
  if (folderMatch) {
    return {
      kind: "folder",
      folderId: decodeURIComponent(folderMatch[1]),
    };
  }
  return null;
}

export function normalizeResourceId(raw: string | null | undefined): string {
  if (!raw) return "";
  return decodeURIComponent(raw).split("&")[0].split("?")[0].trim();
}

type ShareAuthError = { error: string; status: number };

export type ShareAuthOk = { shareRecord: ShareLink; parsed: ParsedSharePath };

export type ShareAuthResult = ShareAuthError | ShareAuthOk;

/**
 * Validates share_token query param: JWT, revocation, DB row, maxUses, loginRequired, path shape.
 */
export async function authenticateShareRequest(
  request: NextRequest,
): Promise<ShareAuthResult | null> {
  const shareToken = new URL(request.url).searchParams.get("share_token");
  if (!shareToken) return null;

  const shareSecretKey = process.env.SHARE_SECRET_KEY;
  if (!shareSecretKey || shareSecretKey.length < 32) {
    return { error: ERROR_MESSAGES.INVALID_SHARE_TOKEN, status: 401 };
  }

  try {
    const secret = new TextEncoder().encode(shareSecretKey);
    const { payload } = await jwtVerify(shareToken, secret);

    if (typeof payload.jti !== "string") {
      return { error: ERROR_MESSAGES.INVALID_SHARE_TOKEN, status: 401 };
    }

    const isBlocked = await kv.get(`${REDIS_KEYS.SHARE_BLOCKED}${payload.jti}`);
    if (isBlocked) {
      return { error: ERROR_MESSAGES.SHARE_LINK_REVOKED, status: 401 };
    }

    const shareRecord = await db.shareLink.findUnique({
      where: { jti: payload.jti },
    });

    if (!shareRecord) {
      return { error: ERROR_MESSAGES.INVALID_SHARE_TOKEN, status: 401 };
    }

    if (
      shareRecord.maxUses !== null &&
      shareRecord.views >= shareRecord.maxUses
    ) {
      return {
        error: "Batas maksimum unduhan/akses untuk tautan ini telah tercapai.",
        status: 403,
      };
    }

    if (payload.loginRequired || shareRecord.loginRequired) {
      const session = await auth();
      if (
        !session ||
        session.user?.role === "GUEST" ||
        session.user?.isGuest === true
      ) {
        return { error: "Login required.", status: 401 };
      }
    }

    const parsed = parseShareLinkPath(shareRecord.path);
    if (!parsed) {
      return { error: ERROR_MESSAGES.ACCESS_DENIED, status: 403 };
    }

    return { shareRecord, parsed };
  } catch {
    return { error: ERROR_MESSAGES.INVALID_SHARE_TOKEN, status: 401 };
  }
}

async function getCollectionItems(shareId: string) {
  return parseShareCollectionItems(
    await kv.get(`${REDIS_KEYS.SHARE_ITEMS}${shareId}`),
  );
}

function isLocalStorageDescendant(
  nodeId: string,
  rootId: string,
): boolean | null {
  if (
    !rootId.startsWith("local-storage:") ||
    !nodeId.startsWith("local-storage:")
  ) {
    return null;
  }

  const prefix = rootId.endsWith("/") ? rootId : `${rootId}/`;
  return nodeId === rootId || nodeId.startsWith(prefix);
}

async function walkDriveAncestorsForSharedRoot(
  nodeId: string,
  sharedRootFolderId: string,
): Promise<boolean> {
  let current: string | null = nodeId;
  const visited = new Set<string>();
  const rootEnv = process.env.NEXT_PUBLIC_ROOT_FOLDER_ID?.trim();

  for (let depth = 0; depth < 45; depth++) {
    if (!current || visited.has(current)) return false;
    visited.add(current);

    if (current === sharedRootFolderId) return true;

    const meta = await getFileDetailsFromDrive(current);
    if (!meta?.parents?.length) return false;

    const parent = meta.parents[0];
    if (parent === sharedRootFolderId) return true;
    if (rootEnv && parent === rootEnv) return false;

    current = parent;
  }

  return false;
}

/**
 * Walks Google Drive parents from nodeId upward; true if sharedRootFolderId is an ancestor (or equal).
 */
export async function isNodeInsideSharedFolder(
  nodeId: string,
  sharedRootFolderId: string,
): Promise<boolean> {
  const cleanNode = normalizeResourceId(nodeId);
  const cleanRoot = normalizeResourceId(sharedRootFolderId);

  if (cleanNode === cleanRoot) return true;

  const localStorageMatch = isLocalStorageDescendant(cleanNode, cleanRoot);
  if (localStorageMatch !== null) return localStorageMatch;

  return walkDriveAncestorsForSharedRoot(cleanNode, cleanRoot);
}

type ShareCollectionItem = {
  id: string;
  mimeType: string;
  parents?: string[];
};

async function collectionItemGrantsFolderAccess(
  cleanFolderId: string,
  item: ShareCollectionItem,
): Promise<boolean> {
  if (item.mimeType === MIME_TYPES.FOLDER) {
    return isNodeInsideSharedFolder(cleanFolderId, item.id);
  }

  const parent = item.parents?.[0];
  if (!parent) {
    return false;
  }

  return isNodeInsideSharedFolder(cleanFolderId, parent);
}

async function collectionShareGrantsFolderAccess(
  cleanFolderId: string,
  shareId: string,
): Promise<boolean> {
  const items = await getCollectionItems(shareId);
  if (!items?.length) {
    return false;
  }

  for (const item of items) {
    if (await collectionItemGrantsFolderAccess(cleanFolderId, item)) {
      return true;
    }
  }

  return false;
}

export async function shareGrantsAccessToFolder(
  ctx: ShareAuthOk,
  folderId: string,
): Promise<boolean> {
  const clean = normalizeResourceId(folderId);
  const { parsed } = ctx;

  if (parsed.kind === "file") {
    return clean === parsed.folderId;
  }

  if (parsed.kind === "folder") {
    return isNodeInsideSharedFolder(clean, parsed.folderId);
  }

  if (parsed.kind === "collection") {
    return collectionShareGrantsFolderAccess(clean, parsed.shareId);
  }

  return false;
}

async function collectionItemGrantsFileAccess(
  cleanFileId: string,
  item: ShareCollectionItem,
): Promise<boolean> {
  if (item.mimeType === MIME_TYPES.FOLDER) {
    return isNodeInsideSharedFolder(cleanFileId, item.id);
  }

  return item.id === cleanFileId;
}

async function collectionShareGrantsFileAccess(
  cleanFileId: string,
  shareId: string,
): Promise<boolean> {
  const items = await getCollectionItems(shareId);
  if (!items?.length) {
    return false;
  }

  for (const item of items) {
    if (await collectionItemGrantsFileAccess(cleanFileId, item)) {
      return true;
    }
  }

  return false;
}

async function folderShareGrantsFileAccess(
  cleanFileId: string,
  sharedFolderId: string,
): Promise<boolean> {
  const meta = await getFileDetailsFromDrive(cleanFileId);
  if (!meta) {
    return false;
  }

  if (meta.mimeType === MIME_TYPES.FOLDER) {
    return isNodeInsideSharedFolder(cleanFileId, sharedFolderId);
  }

  const parent = meta.parents?.[0];
  if (!parent) {
    return false;
  }

  if (parent === sharedFolderId) {
    return true;
  }

  return isNodeInsideSharedFolder(parent, sharedFolderId);
}

export async function shareGrantsAccessToFile(
  ctx: ShareAuthOk,
  fileId: string,
): Promise<boolean> {
  const clean = normalizeResourceId(fileId);
  const { parsed } = ctx;

  if (parsed.kind === "file") {
    return clean === parsed.fileId;
  }

  if (parsed.kind === "collection") {
    return collectionShareGrantsFileAccess(clean, parsed.shareId);
  }

  if (parsed.kind === "folder") {
    return folderShareGrantsFileAccess(clean, parsed.folderId);
  }

  return false;
}

/**
 * When preventDownload is set on the share, block obvious download attempts while
 * still allowing Range-based streaming and media element loads.
 */
export function shouldBlockDueToPreventDownload(request: NextRequest): boolean {
  if (request.headers.get("range")) {
    return false;
  }

  const dest = (request.headers.get("sec-fetch-dest") || "").toLowerCase();
  if (dest === "video" || dest === "audio" || dest === "image") {
    return false;
  }

  if (dest === "document") {
    return true;
  }

  const mode = (request.headers.get("sec-fetch-mode") || "").toLowerCase();
  if (mode === "navigate") {
    return true;
  }

  if (mode === "cors" || mode === "no-cors") {
    return true;
  }

  return false;
}
