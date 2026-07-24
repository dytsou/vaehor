import { NextRequest, NextResponse } from "next/server";
import {
  getAccessToken,
  invalidateAccessToken,
  type DriveFile,
} from "@/lib/drive";
import { isValidGoogleDriveFileId } from "@/lib/utils";

export const runtime = "nodejs";

async function fetchFileMetadata(
  fileId: string,
  currentToken: string,
  retryCount = 0,
): Promise<DriveFile | null> {
  const cleanId = fileId.split("&")[0].split("?")[0].trim();
  if (!isValidGoogleDriveFileId(cleanId)) {
    return null;
  }

  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${cleanId}?fields=id,name,mimeType,parents,trashed,shortcutDetails&supportsAllDrives=true`,
    {
      headers: {
        Authorization: `Bearer ${currentToken}`,
      },
      cache: "no-store",
    },
  );

  if (response.status === 401 && retryCount < 2) {
    await invalidateAccessToken();
    const newToken = await getAccessToken();
    return fetchFileMetadata(cleanId, newToken, retryCount + 1);
  }

  if ((response.status === 429 || response.status >= 500) && retryCount < 3) {
    await new Promise((resolve) =>
      setTimeout(resolve, 1000 * (retryCount + 1)),
    );
    return fetchFileMetadata(cleanId, currentToken, retryCount + 1);
  }

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as DriveFile;
}

async function resolveShortcutTarget(file: DriveFile): Promise<DriveFile> {
  const targetId = file.shortcutDetails?.targetId;
  if (file.mimeType !== "application/vnd.google-apps.shortcut" || !targetId) {
    return file;
  }

  const targetFile = await fetchFileMetadata(targetId, await getAccessToken());
  return targetFile ?? file;
}

function buildDestinationPath(file: DriveFile): string {
  if (file.mimeType === "application/vnd.google-apps.folder") {
    return `/folder/${file.id}`;
  }

  const rootFolderId = process.env.NEXT_PUBLIC_ROOT_FOLDER_ID || "root";
  const parentId = file.parents?.[0] ?? rootFolderId;
  const slug = encodeURIComponent(
    (file.name || "view").replace(/\s+/g, "-").toLowerCase(),
  );
  return `/folder/${parentId}/file/${file.id}/${slug}`;
}

function parseFindPathQuery(request: NextRequest): {
  fileId: string;
  shouldView: boolean;
} | null {
  const searchParams = new URL(request.url).searchParams;
  let fileId = searchParams.get("id");
  let shouldView = searchParams.get("view") === "true";

  if (!fileId) return null;

  if (fileId.includes("view=true")) {
    shouldView = true;
    fileId = fileId.replace(/[?&]view=true/g, "").trim();
  }

  fileId = fileId.split("&")[0].split("?")[0].trim();
  if (!isValidGoogleDriveFileId(fileId)) return null;

  return { fileId, shouldView };
}

export async function GET(request: NextRequest) {
  const redirectHome = () => NextResponse.redirect(new URL("/", request.url));
  const query = parseFindPathQuery(request);
  if (!query) return redirectHome();

  try {
    const accessToken = await getAccessToken();
    const metadata = await fetchFileMetadata(query.fileId, accessToken);
    if (!metadata) return redirectHome();

    const file = await resolveShortcutTarget(metadata);
    if (file.trashed) return redirectHome();

    const destinationUrl = new URL(buildDestinationPath(file), request.url);
    if (query.shouldView) {
      destinationUrl.searchParams.set("view", "true");
    }
    return NextResponse.redirect(destinationUrl);
  } catch (error) {
    console.error(error);
    return redirectHome();
  }
}
