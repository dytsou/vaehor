import { kv } from "@/lib/kv";
import {
  GOOGLE_DRIVE_API_BASE_URL,
  MIME_TYPES,
  REDIS_TTL,
} from "@/lib/constants";
import { logger } from "@/lib/logger";
import { fetchWithRetry } from "./client";

const MAX_FOLDER_TREE_DEPTH = 10;

type FolderListPage = {
  files: { id: string }[];
  nextPageToken: string | null;
};

async function readFolderTreeCache(cacheKey: string): Promise<string[] | null> {
  try {
    return (await kv.get<string[]>(cacheKey)) ?? null;
  } catch (error) {
    logger.warn({ err: error }, "Failed to get folder tree from cache");
    return null;
  }
}

async function writeFolderTreeCache(
  cacheKey: string,
  folderIds: string[],
): Promise<void> {
  try {
    await kv.set(cacheKey, folderIds, { ex: REDIS_TTL.FOLDER_TREE });
  } catch (error) {
    logger.warn({ err: error }, "Failed to cache folder tree");
  }
}

function buildChildFoldersQuery(
  folderId: string,
  pageToken: string | null,
): URLSearchParams {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and mimeType='${MIME_TYPES.FOLDER}' and trashed=false`,
    fields: "nextPageToken, files(id)",
    pageSize: "1000",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });

  if (pageToken) {
    params.set("pageToken", pageToken);
  }

  return params;
}

async function fetchChildFoldersPage(
  accessToken: string,
  folderId: string,
  pageToken: string | null,
): Promise<FolderListPage | null> {
  const params = buildChildFoldersQuery(folderId, pageToken);

  try {
    const response = await fetchWithRetry(
      `${GOOGLE_DRIVE_API_BASE_URL}/files?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return null;
    }

    const data: {
      files?: { id: string }[];
      nextPageToken?: string | null;
    } = await response.json();

    return {
      files: data.files ?? [],
      nextPageToken: data.nextPageToken ?? null,
    };
  } catch {
    return null;
  }
}

async function listChildFolders(
  accessToken: string,
  folderId: string,
): Promise<{ id: string }[]> {
  const folders: { id: string }[] = [];
  let pageToken: string | null = null;

  do {
    const page = await fetchChildFoldersPage(accessToken, folderId, pageToken);
    if (!page) {
      break;
    }

    folders.push(...page.files);
    pageToken = page.nextPageToken;
  } while (pageToken);

  return folders;
}

function enqueueDiscoveredFolders(
  folders: { id: string }[],
  allFolderIds: Set<string>,
  queue: [string, number][],
  depth: number,
) {
  for (const folder of folders) {
    if (allFolderIds.has(folder.id)) {
      continue;
    }

    allFolderIds.add(folder.id);
    queue.push([folder.id, depth + 1]);
  }
}

async function collectDescendantFolderIds(
  accessToken: string,
  rootFolderId: string,
): Promise<string[]> {
  const allFolderIds = new Set<string>([rootFolderId]);
  const queue: [string, number][] = [[rootFolderId, 0]];

  while (queue.length > 0) {
    const [folderId, depth] = queue.shift()!;
    if (depth >= MAX_FOLDER_TREE_DEPTH) {
      continue;
    }

    const childFolders = await listChildFolders(accessToken, folderId);
    enqueueDiscoveredFolders(childFolders, allFolderIds, queue, depth);
  }

  return Array.from(allFolderIds);
}

export async function resolveDescendantFolders(
  accessToken: string,
  rootFolderId: string,
  cacheKey: string,
): Promise<string[]> {
  const cachedTree = await readFolderTreeCache(cacheKey);
  if (cachedTree) {
    return cachedTree;
  }

  const folderIds = await collectDescendantFolderIds(accessToken, rootFolderId);
  await writeFolderTreeCache(cacheKey, folderIds);
  return folderIds;
}
