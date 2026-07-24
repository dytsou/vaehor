"use client";

import { Lock, Star } from "lucide-react";
import { formatBytes, cn } from "@/lib/utils";
import type { ViewMode } from "@/lib/store/types";
import type { BrowserFile } from "@/components/file-browser/views/types";
import {
  fileItemDetailsClassName,
  fileItemTitleClassName,
} from "@/components/file-browser/file-item-classes";

interface FileItemDetailsProps {
  file: BrowserFile;
  view: ViewMode;
  isGallery: boolean;
  isBulkMode: boolean;
  compactClass: boolean;
  isUploading: boolean;
  isError: boolean;
  uploadProgress?: number;
  formatDate: (value: Date) => string;
}

function FileItemUploadProgress({
  isError,
  uploadProgress = 0,
}: Readonly<Pick<FileItemDetailsProps, "isError" | "uploadProgress">>) {
  return (
    <div className="w-full mt-2">
      <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full", isError ? "bg-red-500" : "bg-primary")}
          style={{ width: `${uploadProgress}%` }}
        />
      </div>
    </div>
  );
}

function FileItemListMetadata({
  file,
  formatDate,
}: Readonly<Pick<FileItemDetailsProps, "file" | "formatDate">>) {
  return (
    <p className="text-xs text-muted-foreground mt-1 text-left truncate select-none">
      {file.size ? formatBytes(Number.parseInt(file.size)) : "-"} •{" "}
      {file.modifiedTime ? formatDate(new Date(file.modifiedTime)) : "-"}
    </p>
  );
}

export default function FileItemDetails({
  file,
  view,
  isGallery,
  isBulkMode,
  compactClass,
  isUploading,
  isError,
  uploadProgress,
  formatDate,
}: FileItemDetailsProps) {
  const showListMetadata =
    view === "list" && !file.isFolder && !compactClass && !isUploading;

  return (
    <div className={fileItemDetailsClassName(view, isGallery)}>
      <div className={fileItemTitleClassName(view)}>
        {file.isFavorite && (
          <Star
            size={12}
            className="text-yellow-400 fill-yellow-400 shrink-0"
          />
        )}
        {view === "list" && file.isProtected && (
          <Lock size={12} className="text-muted-foreground shrink-0" />
        )}

        {view === "list" ? (
          <div
            className={cn(
              "flex-1 min-w-0 overflow-hidden",
              isBulkMode && "pr-10",
            )}
          >
            <p className="truncate block select-none">{file.name}</p>
          </div>
        ) : (
          <p className="line-clamp-2 break-words w-full leading-tight select-none">
            {file.name}
          </p>
        )}
      </div>

      {showListMetadata && (
        <FileItemListMetadata file={file} formatDate={formatDate} />
      )}

      {(isUploading || isError) && (
        <FileItemUploadProgress
          isError={isError}
          uploadProgress={uploadProgress}
        />
      )}
    </div>
  );
}
