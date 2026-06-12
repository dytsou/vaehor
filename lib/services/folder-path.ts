import { NextResponse, type NextRequest } from "next/server";
import type { Session } from "next-auth";
import { getAccessToken } from "@/lib/drive";
import {
  authenticateShareRequest,
  shareGrantsAccessToFolder,
} from "@/lib/share-scope";
import { kv } from "@/lib/kv";
import {
  MANUAL_DRIVES_KEY,
  parseManualDriveRecords,
  parseManualDrivesFromEnv,
} from "@/lib/manual-drives";

export type DrivePathNode = {
  id: string;
  name: string;
};

type DrivePathResponse = DrivePathNode & {
  parents?: string[];
};

export type FolderPathParams = {
  rawFolderId: string | null;
  folderId: string | null;
  locale: string;
  hasShareToken: boolean;
};

function cleanFolderId(rawFolderId: string): string {
  return decodeURIComponent(rawFolderId).split("&")[0].split("?")[0].trim();
}

export function parseFolderPathParams(
  searchParams: URLSearchParams,
): FolderPathParams {
  const rawFolderId = searchParams.get("folderId");
  return {
    rawFolderId,
    folderId: rawFolderId ? cleanFolderId(rawFolderId) : null,
    locale: searchParams.get("locale") || "en",
    hasShareToken: searchParams.has("share_token"),
  };
}

export function missingFolderIdResponse(locale: string) {
  return NextResponse.json(
    {
      error:
        locale === "id"
          ? "Parameter folderId tidak ditemukan."
          : "Parameter folderId not found.",
    },
    { status: 400 },
  );
}

export async function resolveFolderPathShareAccess(
  request: NextRequest,
  hasShareToken: boolean,
  folderId: string | null,
  locale: string,
): Promise<{ shareScoped: boolean; error?: NextResponse }> {
  if (!hasShareToken) {
    return { shareScoped: false };
  }

  if (!folderId) {
    return { shareScoped: false, error: missingFolderIdResponse(locale) };
  }

  const shareRes = await authenticateShareRequest(request);
  if (!shareRes || "error" in shareRes) {
    return {
      shareScoped: false,
      error: NextResponse.json(
        {
          error:
            (shareRes && "error" in shareRes && shareRes.error) ||
            "Invalid share token.",
        },
        {
          status: shareRes && "error" in shareRes ? shareRes.status : 401,
        },
      ),
    };
  }

  const allowed = await shareGrantsAccessToFolder(shareRes, folderId);
  if (!allowed) {
    return {
      shareScoped: false,
      error: NextResponse.json(
        { error: "This share link does not allow access to this path." },
        { status: 403 },
      ),
    };
  }

  return { shareScoped: true };
}

export function isPrivateFolderId(rawFolderId: string): boolean {
  return (process.env.PRIVATE_FOLDER_IDS || "")
    .split(",")
    .includes(rawFolderId.trim());
}

export function ensurePrivateFolderAccess(
  rawFolderId: string,
  session: Session | null,
  shareScoped: boolean,
): NextResponse | null {
  if (isPrivateFolderId(rawFolderId) && !session && !shareScoped) {
    return NextResponse.json(
      { error: "Authentication required.", protected: true },
      { status: 401 },
    );
  }
  return null;
}

function buildVirtualRootPath(locale: string): DrivePathNode[] {
  return [{ id: "virtual-root", name: locale === "id" ? "Beranda" : "Home" }];
}

function buildLocalStoragePathNodes(
  folderId: string,
  locale: string,
): DrivePathNode[] {
  const localPath = folderId.replace("local-storage:", "");
  const segments = localPath.split("/").filter(Boolean);
  const pathNodes: DrivePathNode[] = [
    {
      id: "local-storage:",
      name: locale === "id" ? "Penyimpanan Lokal" : "Local Storage",
    },
  ];

  let currentPath = "";
  for (const segment of segments) {
    currentPath += `${segment}/`;
    pathNodes.push({ id: `local-storage:${currentPath}`, name: segment });
  }

  return pathNodes;
}

export async function tryCachedOrStaticPath(
  folderId: string,
  locale: string,
  cacheKey: string,
): Promise<NextResponse | null> {
  if (folderId === "virtual-root") {
    return NextResponse.json(buildVirtualRootPath(locale));
  }

  if (folderId.startsWith("local-storage:")) {
    return NextResponse.json(buildLocalStoragePathNodes(folderId, locale));
  }

  try {
    const cachedPath = await kv.get<DrivePathNode[]>(cacheKey);
    if (cachedPath) {
      return NextResponse.json(cachedPath);
    }
  } catch (error) {
    console.error("Cache fetch error", error);
  }

  return null;
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 3,
  delay = 1000,
): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      if (response.status === 404 || response.status === 401) return response;
      if (response.status >= 500) {
        await new Promise((resolve) => setTimeout(resolve, delay * 2 ** i));
        continue;
      }
      return response;
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay * 2 ** i));
    }
  }
  throw new Error("Fetch failed after retries");
}

async function buildShortcutMap(locale: string): Promise<Map<string, string>> {
  const dbDrivesRaw = await kv.get(MANUAL_DRIVES_KEY);
  const dbDrives = parseManualDriveRecords(dbDrivesRaw);
  const envDrives = parseManualDrivesFromEnv(
    process.env.NEXT_PUBLIC_MANUAL_DRIVES || "",
  );
  const shortcutMap = new Map<string, string>();

  if (process.env.NEXT_PUBLIC_ROOT_FOLDER_ID) {
    shortcutMap.set(
      process.env.NEXT_PUBLIC_ROOT_FOLDER_ID.trim(),
      process.env.NEXT_PUBLIC_ROOT_FOLDER_NAME ||
        (locale === "id" ? "Beranda" : "Home"),
    );
  }

  for (const drive of envDrives) {
    shortcutMap.set(drive.id.trim(), drive.name || "");
  }

  for (const drive of dbDrives) {
    shortcutMap.set(drive.id.trim(), drive.name || "");
  }

  return shortcutMap;
}

async function fetchShortcutNode(
  currentId: string,
  accessToken: string,
  shortcutMap: Map<string, string>,
  driveFallback: string,
): Promise<DrivePathNode> {
  const driveUrl = `https://www.googleapis.com/drive/v3/files/${currentId}?fields=id,name&supportsAllDrives=true`;

  try {
    const response = await fetchWithRetry(driveUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (response.ok) {
      const data = (await response.json()) as DrivePathNode;
      return { id: data.id, name: shortcutMap.get(currentId) || data.name };
    }
  } catch (error) {
    console.error("Error fetching shortcut metadata", error);
  }

  return { id: currentId, name: shortcutMap.get(currentId) || driveFallback };
}

async function buildDriveAncestorPath(
  folderId: string,
  shortcutMap: Map<string, string>,
  accessToken: string,
  driveFallback: string,
): Promise<DrivePathNode[]> {
  const path: DrivePathNode[] = [];
  let currentId: string | undefined = folderId;
  let iterations = 0;

  while (currentId && iterations < 20) {
    iterations++;

    if (shortcutMap.has(currentId)) {
      path.unshift(
        await fetchShortcutNode(
          currentId,
          accessToken,
          shortcutMap,
          driveFallback,
        ),
      );
      break;
    }

    const driveUrl = `https://www.googleapis.com/drive/v3/files/${currentId}?fields=id,name,parents&supportsAllDrives=true`;
    const response = await fetchWithRetry(driveUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });

    if (!response.ok) break;

    const data = (await response.json()) as DrivePathResponse;
    path.unshift({ id: data.id, name: data.name });
    currentId = data.parents?.[0];
  }

  return path;
}

export async function fetchDriveFolderPath(
  folderId: string,
  locale: string,
  cacheKey: string,
): Promise<DrivePathNode[]> {
  const shortcutMap = await buildShortcutMap(locale);
  const accessToken = await getAccessToken();
  const driveFallback = locale === "id" ? "Drive Bersama" : "Shared Drive";

  const path = shortcutMap.has(folderId)
    ? [
        await fetchShortcutNode(
          folderId,
          accessToken,
          shortcutMap,
          driveFallback,
        ),
      ]
    : await buildDriveAncestorPath(
        folderId,
        shortcutMap,
        accessToken,
        driveFallback,
      );

  await kv.set(cacheKey, path, { ex: 3600 });
  return path;
}

export function folderPathErrorResponse(error: unknown) {
  const errorMessage =
    error instanceof Error ? error.message : "Internal error.";
  return NextResponse.json(
    { error: "Failed to fetch path", details: errorMessage },
    { status: 500 },
  );
}
