"use client";

import Link from "next/link";
import { MoreVertical } from "lucide-react";
import { formatBytes } from "@/lib/utils";
import type {
  BrowserFile,
  FileBrowserActionEvent,
} from "@/components/file-browser/views/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface FileCardFooterProps {
  file: BrowserFile;
  isFolder: boolean;
  folderLabel: string;
  onNavigate?: (folderId: string) => void;
  onDetails?: (e: FileBrowserActionEvent, file: BrowserFile) => void;
  onDownload?: (e: FileBrowserActionEvent, file: BrowserFile) => void;
  onShare?: (e: FileBrowserActionEvent, file: BrowserFile) => void;
  preventDownload?: boolean;
  createActionEvent: (event: React.MouseEvent) => FileBrowserActionEvent;
  labels: {
    info: string;
    download: string;
    share: string;
    delete: string;
  };
}

export default function FileCardFooter({
  file,
  isFolder,
  folderLabel,
  onNavigate,
  onDetails,
  onDownload,
  onShare,
  preventDownload,
  createActionEvent,
  labels,
}: FileCardFooterProps) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm truncate" title={file.name}>
          {isFolder ? (
            <Link
              href={`/folder/${file.id}`}
              className="hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                onNavigate?.(file.id);
              }}
            >
              {file.name}
            </Link>
          ) : (
            file.name
          )}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {isFolder
            ? folderLabel
            : formatBytes(Number.parseInt(file.size || "0"))}
        </p>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          className="opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreVertical className="w-4 h-4 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          {onDetails && (
            <DropdownMenuItem
              onClick={(event) => onDetails(createActionEvent(event), file)}
            >
              {labels.info}
            </DropdownMenuItem>
          )}
          {onDownload && !isFolder && !preventDownload && (
            <DropdownMenuItem
              onClick={(event) => onDownload(createActionEvent(event), file)}
            >
              {labels.download}
            </DropdownMenuItem>
          )}
          {onShare && (
            <DropdownMenuItem
              onClick={(event) => onShare(createActionEvent(event), file)}
            >
              {labels.share}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem className="text-red-600">
            {labels.delete}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
