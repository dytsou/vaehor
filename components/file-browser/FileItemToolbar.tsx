"use client";

import { Share2, Download, Info, MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ViewMode } from "@/lib/store/types";
import type { DriveFile } from "@/lib/drive";
import type { FileBrowserActionEvent } from "@/components/file-browser/views/types";
import {
  createFileItemActionEvent,
  openFileItemMenuFromButton,
} from "@/components/file-browser/file-item-handlers";
import {
  fileItemBulkCheckboxClassName,
  fileItemMobileMenuClassName,
} from "@/components/file-browser/file-item-classes";

interface FileItemToolbarProps {
  file: DriveFile;
  view: ViewMode;
  isAdmin: boolean;
  isBulkMode: boolean;
  isSelected: boolean;
  isUploading: boolean;
  compactClass: boolean;
  onShare: (e: FileBrowserActionEvent) => void;
  onShowDetails: (e: FileBrowserActionEvent) => void;
  onDownload: (e: FileBrowserActionEvent) => void;
  onContextMenu: (
    position: { clientX: number; clientY: number },
    file: DriveFile,
  ) => void;
  onToggleSelection: (file: DriveFile) => void;
  labels: {
    share: string;
    download: string;
    viewDetails: string;
    moreOptions: string;
  };
}

function FileItemDesktopActions({
  file,
  isAdmin,
  compactClass,
  onShare,
  onShowDetails,
  onDownload,
  labels,
}: Readonly<
  Pick<
    FileItemToolbarProps,
    | "file"
    | "isAdmin"
    | "compactClass"
    | "onShare"
    | "onShowDetails"
    | "onDownload"
    | "labels"
  >
>) {
  const runAction = (
    event: React.MouseEvent,
    action: (e: FileBrowserActionEvent) => void,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    action(createFileItemActionEvent(event));
  };

  return (
    <div
      className={cn(
        "hidden md:flex items-center gap-1 ml-auto opacity-0 group-hover:opacity-100 focus-within:opacity-100 shrink-0 pointer-events-auto",
        compactClass && "scale-90 origin-right",
      )}
    >
      {isAdmin && (
        <button
          type="button"
          onClick={(event) => runAction(event, onShare)}
          title={labels.share}
          className="p-2 rounded-full hover:bg-muted select-none"
        >
          <Share2 size={16} />
        </button>
      )}
      {!file.isFolder && (
        <button
          type="button"
          onClick={(event) => runAction(event, onDownload)}
          title={labels.download}
          className="p-2 rounded-full hover:bg-muted select-none"
        >
          <Download size={16} />
        </button>
      )}
      <button
        type="button"
        onClick={(event) => runAction(event, onShowDetails)}
        title={labels.viewDetails}
        className="p-2 rounded-full hover:bg-muted select-none"
      >
        <Info size={16} />
      </button>
    </div>
  );
}

export default function FileItemToolbar({
  file,
  view,
  isAdmin,
  isBulkMode,
  isSelected,
  isUploading,
  compactClass,
  onShare,
  onShowDetails,
  onDownload,
  onContextMenu,
  onToggleSelection,
  labels,
}: Readonly<FileItemToolbarProps>) {
  return (
    <>
      {!isBulkMode && !isUploading && (
        <FileItemDesktopActions
          file={file}
          isAdmin={isAdmin}
          compactClass={compactClass}
          onShare={onShare}
          onShowDetails={onShowDetails}
          onDownload={onDownload}
          labels={labels}
        />
      )}

      {!isUploading && !isBulkMode && (
        <button
          type="button"
          onClick={(event) =>
            openFileItemMenuFromButton(event, file, onContextMenu)
          }
          className={fileItemMobileMenuClassName(view)}
          aria-label={labels.moreOptions}
        >
          <MoreVertical size={18} />
        </button>
      )}

      {isBulkMode && !isUploading && (
        <input
          type="checkbox"
          checked={isSelected}
          readOnly
          className={fileItemBulkCheckboxClassName(view)}
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelection(file);
          }}
        />
      )}
    </>
  );
}
