import { kv } from "@/lib/kv";
import { getRootFolderId } from "@/lib/config";
import { GOOGLE_DRIVE_API_BASE_URL, REDIS_TTL } from "@/lib/constants";
import { logger } from "@/lib/logger";
import {
  MANUAL_DRIVES_KEY,
  parseManualDriveRecords,
  parseManualDrivesFromEnv,
} from "@/lib/manual-drives";
import { getAccessToken } from "./auth";
import { fetchWithRetry } from "./client";

const MAX_PATH_ITERATIONS = 20;

export type FolderPathNode = {
  id: string;
  name: string;
};

async function readFolderPathCache(
  cacheKey: string,
): Promise<FolderPathNode[] | null> {
  try {
    return (await kv.get<FolderPathNode[]>(cacheKey)) ?? null;
  } catch (error) {
    logger.warn({ err: error }, "Failed to get folder path cache");
    return null;
  }
}

async function writeFolderPathCache(
  cacheKey: string,
  path: FolderPathNode[],
): Promise<void> {
  try {
    await kv.set(cacheKey, path, { ex: REDIS_TTL.FOLDER_PATH });
  } catch (error) {
    logger.warn({ err: error }, "Failed to cache folder path");
  }
}

function localizedDriveFallback(locale: string): string {
  return locale === "id" ? "Drive Bersama" : "Shared Drive";
}

async function buildShortcutMap(locale: string): Promise<Map<string, string>> {
  const rootId = await getRootFolderId();
  const rootName =
    process.env.NEXT_PUBLIC_ROOT_FOLDER_NAME ||
    (locale === "id" ? "Beranda" : "Home");
  const dbDrives = parseManualDriveRecords(await kv.get(MANUAL_DRIVES_KEY));
  const envDrives = parseManualDrivesFromEnv(
    process.env.NEXT_PUBLIC_MANUAL_DRIVES,
  );
  const shortcutMap = new Map<string, string>();

  if (rootId) {
    shortcutMap.set(rootId, rootName);
  }

  for (const drive of envDrives) {
    if (drive.id?.trim()) {
      shortcutMap.set(drive.id.trim(), drive.name || "");
    }
  }

  for (const drive of dbDrives) {
    if (drive?.id) {
      shortcutMap.set(drive.id.trim(), drive.name || "");
    }
  }

  return shortcutMap;
}

async function fetchShortcutPathNode(
  currentId: string,
  accessToken: string,
  shortcutMap: Map<string, string>,
  driveFallback: string,
): Promise<FolderPathNode> {
  const driveUrl = `${GOOGLE_DRIVE_API_BASE_URL}/files/${currentId}?fields=id,name`;

  try {
    const response = await fetchWithRetry(driveUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });

    if (response.ok) {
      const data: { id: string; name: string } = await response.json();
      return {
        id: data.id,
        name: shortcutMap.get(currentId) || data.name,
      };
    }
  } catch {
    // Fall through to cached/fallback name.
  }

  return {
    id: currentId,
    name: shortcutMap.get(currentId) || driveFallback,
  };
}

async function fetchAncestorSegment(
  currentId: string,
  accessToken: string,
): Promise<{ node: FolderPathNode; parentId: string | null } | null> {
  const driveUrl = `${GOOGLE_DRIVE_API_BASE_URL}/files/${currentId}`;
  const params = new URLSearchParams({
    fields: "id, name, parents",
    supportsAllDrives: "true",
  });

  try {
    const response = await fetchWithRetry(`${driveUrl}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const data: { id: string; name: string; parents?: string[] } =
      await response.json();

    return {
      node: { id: data.id, name: data.name },
      parentId:
        data.parents && data.parents.length > 0 ? data.parents[0] : null,
    };
  } catch (error) {
    logger.error({ err: error }, "Error fetching folder path segment");
    return null;
  }
}

async function collectFolderPath(
  folderId: string,
  accessToken: string,
  shortcutMap: Map<string, string>,
  driveFallback: string,
): Promise<FolderPathNode[]> {
  const path: FolderPathNode[] = [];
  let currentId: string | undefined = folderId;
  let iterations = 0;

  while (currentId && iterations < MAX_PATH_ITERATIONS) {
    iterations += 1;

    if (shortcutMap.has(currentId)) {
      const shortcutNode = await fetchShortcutPathNode(
        currentId,
        accessToken,
        shortcutMap,
        driveFallback,
      );
      path.unshift(shortcutNode);
      break;
    }

    const segment = await fetchAncestorSegment(currentId, accessToken);
    if (!segment) {
      break;
    }

    path.unshift(segment.node);
    currentId = segment.parentId ?? undefined;
  }

  return path;
}

export async function resolveFolderPath(
  folderId: string,
  locale: string,
  cacheKey: string,
): Promise<FolderPathNode[]> {
  const cachedPath = await readFolderPathCache(cacheKey);
  if (cachedPath) {
    return cachedPath;
  }

  const accessToken = await getAccessToken();
  const shortcutMap = await buildShortcutMap(locale);
  const driveFallback = localizedDriveFallback(locale);
  const path = await collectFolderPath(
    folderId,
    accessToken,
    shortcutMap,
    driveFallback,
  );

  await writeFolderPathCache(cacheKey, path);
  return path;
}
