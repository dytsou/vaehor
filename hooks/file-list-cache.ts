import type { InfiniteData } from "@tanstack/react-query";
import type { DriveFile } from "@/lib/drive";

export interface FileListPage {
  files: DriveFile[];
  nextPageToken?: string | null;
}

export type FileListQueryData = InfiniteData<FileListPage>;

export function buildFolderFilesQueryKey(
  currentFolderId: string,
  shareToken: string | null,
  folderToken: string | undefined,
  refreshKey: number,
) {
  return [
    "files",
    currentFolderId,
    shareToken,
    folderToken,
    refreshKey,
  ] as const;
}

function renameFileOnPage(
  page: FileListPage,
  fileId: string,
  newName: string,
): FileListPage {
  return {
    ...page,
    files: page.files.map((file) =>
      file.id === fileId ? { ...file, name: newName } : file,
    ),
  };
}

export function applyRenameToFileListCache(
  old: FileListQueryData | undefined,
  fileId: string,
  newName: string,
): FileListQueryData | undefined {
  if (!old) {
    return old;
  }

  return {
    ...old,
    pages: old.pages.map((page) => renameFileOnPage(page, fileId, newName)),
  };
}

function removeFileFromPage(page: FileListPage, fileId: string): FileListPage {
  return {
    ...page,
    files: page.files.filter((file) => file.id !== fileId),
  };
}

export function applyRemoveFromFileListCache(
  old: FileListQueryData | undefined,
  fileId: string,
): FileListQueryData | undefined {
  if (!old) {
    return old;
  }

  return {
    ...old,
    pages: old.pages.map((page) => removeFileFromPage(page, fileId)),
  };
}
