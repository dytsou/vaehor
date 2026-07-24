import { db } from "@/lib/db";
import { getFileDetailsFromDrive } from "@/lib/drive";
import { hasUserAccess } from "@/lib/auth";
import { getPrivateFolderIds } from "@/lib/utils";
import { logger } from "@/lib/logger";

let cachedProtectedIds: string[] | null = null;
let cachedRestrictedIds: string[] | null = null;
let lastProtectedUpdate = 0;
let lastRestrictedUpdate = 0;
const CACHE_TTL = 10000;

export function __resetCache() {
  cachedProtectedIds = null;
  cachedRestrictedIds = null;
  lastProtectedUpdate = 0;
  lastRestrictedUpdate = 0;
}

export async function getProtectedFolderIdsCached(): Promise<string[]> {
  const now = Date.now();
  if (cachedProtectedIds && now - lastProtectedUpdate < CACHE_TTL) {
    return cachedProtectedIds;
  }

  try {
    const protecteds = await db.protectedFolder.findMany({
      select: { folderId: true },
    });
    const dbProtectedIds = protecteds.map(
      (p: { folderId: string }) => p.folderId,
    );
    cachedProtectedIds = Array.from(new Set(dbProtectedIds));
    lastProtectedUpdate = now;
    return cachedProtectedIds;
  } catch (e) {
    logger.error({ err: e }, "Failed to fetch restricted IDs");
    // Fail closed: never return an empty list on first load failure (would treat
    // DB-protected folders as public). Fall back to env-configured private IDs.
    return cachedProtectedIds ?? getPrivateFolderIds();
  }
}

async function getRestrictedIds(): Promise<string[]> {
  const now = Date.now();
  if (cachedRestrictedIds && now - lastRestrictedUpdate < CACHE_TTL) {
    return cachedRestrictedIds;
  }

  try {
    const protectedIds = await getProtectedFolderIdsCached();
    const envPrivateIds = getPrivateFolderIds();

    cachedRestrictedIds = Array.from(
      new Set([...protectedIds, ...envPrivateIds]),
    );
    lastRestrictedUpdate = now;
    return cachedRestrictedIds;
  } catch (e) {
    logger.error({ err: e }, "Failed to fetch restricted IDs");
    return cachedRestrictedIds || [];
  }
}

interface AccessCheckContext {
  allowedTokens: string[];
  userEmail: string | null | undefined;
  accessCache: Map<string, boolean>;
}

interface RestrictionTraversalState extends AccessCheckContext {
  depth: number;
  maxDepth: number;
  allRestrictedIds: string[];
  visited: Set<string>;
}

function markTraversalVisited(
  fileId: string,
  depth: number,
  maxDepth: number,
  visited: Set<string>,
): boolean {
  if (depth >= maxDepth) {
    logger.error({ fileId, depth }, "Max depth reached for security check");
    return true;
  }

  if (visited.has(fileId)) {
    return true;
  }

  visited.add(fileId);
  return false;
}

async function resolveUserAccess(
  id: string,
  context: AccessCheckContext,
): Promise<boolean> {
  if (context.accessCache.has(id)) {
    return context.accessCache.get(id)!;
  }

  if (context.allowedTokens.includes(id)) {
    return true;
  }

  if (context.userEmail) {
    const hasAccess = await hasUserAccess(context.userEmail, id);
    context.accessCache.set(id, hasAccess);
    if (hasAccess) {
      return true;
    }
  }

  context.accessCache.set(id, false);
  return false;
}

async function isRestrictedWithoutAccess(
  id: string,
  restrictedIds: string[],
  context: AccessCheckContext,
): Promise<boolean> {
  if (!restrictedIds.includes(id)) {
    return false;
  }

  return !(await resolveUserAccess(id, context));
}

async function resolveIsLocalRestricted(
  allRestrictedIds: string[],
): Promise<boolean> {
  const { getAppConfig } = await import("@/lib/app-config");
  const config = await getAppConfig();

  return (
    config.localStorageAuthEnabled ||
    allRestrictedIds.includes("local-storage:")
  );
}

async function checkLocalStorageRestriction(
  fileId: string,
  allRestrictedIds: string[],
  isLocalRestricted: boolean,
  context: AccessCheckContext,
): Promise<boolean> {
  if (await isRestrictedWithoutAccess(fileId, allRestrictedIds, context)) {
    return true;
  }

  if (
    isLocalRestricted &&
    !(await resolveUserAccess("local-storage:", context))
  ) {
    return true;
  }

  const parts = fileId.split("/");
  for (let i = parts.length - 1; i >= 1; i--) {
    const parentId = parts.slice(0, i).join("/");
    if (await isRestrictedWithoutAccess(parentId, allRestrictedIds, context)) {
      return true;
    }
  }

  return false;
}

async function checkDriveParentRestriction(
  parentId: string,
  state: RestrictionTraversalState,
): Promise<boolean> {
  const context: AccessCheckContext = {
    allowedTokens: state.allowedTokens,
    userEmail: state.userEmail,
    accessCache: state.accessCache,
  };

  if (
    await isRestrictedWithoutAccess(parentId, state.allRestrictedIds, context)
  ) {
    return true;
  }

  if (parentId === process.env.NEXT_PUBLIC_ROOT_FOLDER_ID) {
    return false;
  }

  return isAccessRestricted(parentId, state.allowedTokens, state.userEmail, {
    depth: state.depth + 1,
    maxDepth: state.maxDepth,
    preFetchedRestrictedIds: state.allRestrictedIds,
    visited: state.visited,
    accessCache: state.accessCache,
  });
}

async function checkDriveFileRestriction(
  fileId: string,
  state: RestrictionTraversalState,
): Promise<boolean> {
  const context: AccessCheckContext = {
    allowedTokens: state.allowedTokens,
    userEmail: state.userEmail,
    accessCache: state.accessCache,
  };

  if (
    await isRestrictedWithoutAccess(fileId, state.allRestrictedIds, context)
  ) {
    return true;
  }

  try {
    const file = await getFileDetailsFromDrive(fileId);
    if (!file?.parents?.length) {
      return false;
    }

    for (const parentId of file.parents) {
      if (await checkDriveParentRestriction(parentId, state)) {
        return true;
      }
    }

    return false;
  } catch (error) {
    logger.error({ err: error, fileId }, "Error checking access restriction");
    return true;
  }
}

export async function isAccessRestricted(
  fileId: string,
  allowedTokens: string[] = [],
  userEmail: string | null | undefined = null,
  options: {
    depth?: number;
    maxDepth?: number;
    preFetchedRestrictedIds?: string[] | null;
    visited?: Set<string>;
    accessCache?: Map<string, boolean>;
  } = {},
): Promise<boolean> {
  const depth = options.depth ?? 0;
  const maxDepth = options.maxDepth ?? 20;
  const preFetchedRestrictedIds = options.preFetchedRestrictedIds ?? null;
  const visited = options.visited ?? new Set<string>();
  const accessCache = options.accessCache ?? new Map<string, boolean>();

  if (markTraversalVisited(fileId, depth, maxDepth, visited)) {
    return true;
  }

  const allRestrictedIds =
    preFetchedRestrictedIds ?? (await getRestrictedIds());
  const isLocalRestricted = await resolveIsLocalRestricted(allRestrictedIds);

  if (allRestrictedIds.length === 0 && !isLocalRestricted) {
    return false;
  }

  const context: AccessCheckContext = {
    allowedTokens,
    userEmail,
    accessCache,
  };

  if (fileId.startsWith("local-storage:")) {
    return checkLocalStorageRestriction(
      fileId,
      allRestrictedIds,
      isLocalRestricted,
      context,
    );
  }

  return checkDriveFileRestriction(fileId, {
    allowedTokens,
    userEmail,
    accessCache,
    depth,
    maxDepth,
    allRestrictedIds,
    visited,
  });
}
