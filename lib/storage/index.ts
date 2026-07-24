import {
  listFilesFromDrive,
  getFileDetailsFromDrive,
} from "@/lib/drive/fetchers";
import { listLocalFiles, getLocalFileDetails } from "./local";
import { ZeeFile, ListFilesResponse, ListFilesOptions } from "@/types/storage";

export async function listAllFiles(
  options: ListFilesOptions,
): Promise<ListFilesResponse> {
  const { folderId: rawFolderId, pageToken, pageSize, useCache } = options;
  const folderId = decodeURIComponent(rawFolderId);

  if (folderId === "virtual-root") {
    const driveRoot = process.env.NEXT_PUBLIC_ROOT_FOLDER_ID || "";
    const localEnabled =
      process.env.NEXT_PUBLIC_ENABLE_LOCAL_STORAGE === "true" &&
      !!process.env.LOCAL_STORAGE_PATH;

    const files: ZeeFile[] = [];

    if (driveRoot) {
      files.push({
        id: driveRoot,
        name: "Google Drive",
        mimeType: "application/vnd.google-apps.folder",
        isFolder: true,
        source: "google-drive",
        hasThumbnail: false,
        modifiedTime: new Date().toISOString(),
      });
    }

    if (localEnabled) {
      files.push({
        id: "local-storage:",
        name: process.env.NEXT_PUBLIC_LOCAL_STORAGE_NAME || "Local Storage",
        mimeType: "application/vnd.google-apps.folder",
        isFolder: true,
        source: "local",
        hasThumbnail: false,
        modifiedTime: new Date().toISOString(),
      });
    }

    return { files, nextPageToken: null };
  }

  if (folderId.startsWith("local-storage:")) {
    if (process.env.NEXT_PUBLIC_ENABLE_LOCAL_STORAGE !== "true") {
      return { files: [], nextPageToken: null };
    }
    const localPath = folderId.replace("local-storage:", "");
    return listLocalFiles(localPath);
  }

  const driveResult = await listFilesFromDrive(
    folderId,
    pageToken,
    pageSize || 50,
    useCache,
  );

  return {
    files: driveResult.files.map((file) => ({
      ...file,
      source: "google-drive" as const,
      isFolder: file.mimeType === "application/vnd.google-apps.folder",
    })),
    nextPageToken: driveResult.nextPageToken || null,
  };
}

export async function getAnyFileDetails(
  fileId: string,
): Promise<ZeeFile | null> {
  const cleanId = decodeURIComponent(fileId);
  console.log(
    `[Storage] getAnyFileDetails called with: ${fileId} (cleaned: ${cleanId})`,
  );
  if (cleanId.startsWith("local-storage:")) {
    if (process.env.NEXT_PUBLIC_ENABLE_LOCAL_STORAGE !== "true") {
      return null;
    }
    const localPath = cleanId.replace("local-storage:", "");
    console.log(`[Storage] Fetching local file: ${localPath} (ID: ${cleanId})`);
    return getLocalFileDetails(localPath);
  }

  const driveFile = await getFileDetailsFromDrive(fileId);
  if (!driveFile) return null;

  return {
    ...driveFile,
    source: "google-drive" as const,
    isFolder: driveFile.mimeType === "application/vnd.google-apps.folder",
  };
}
