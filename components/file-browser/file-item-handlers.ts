import type { DriveFile } from "@/lib/drive";
import type { FileBrowserActionEvent } from "@/components/file-browser/views/types";
import {
  canAcceptFolderDrop,
  isInteractiveClickTarget,
} from "@/components/file-browser/file-card-handlers";

export function createFileItemActionEvent(
  event: React.MouseEvent | React.KeyboardEvent,
): FileBrowserActionEvent {
  return {
    preventDefault: () => event.preventDefault(),
    stopPropagation: () => event.stopPropagation(),
    shiftKey: event.shiftKey,
  };
}

export function handleFileItemActivate(
  event: React.MouseEvent | React.KeyboardEvent,
  options: {
    isUploading: boolean;
    onClick: (e: FileBrowserActionEvent) => void;
  },
) {
  if (options.isUploading) {
    return;
  }

  const target = event.target as HTMLElement;
  if (isInteractiveClickTarget(target)) {
    return;
  }

  options.onClick(createFileItemActionEvent(event));
}

export function handleFileItemKeyDown(
  event: React.KeyboardEvent,
  onActivate: (event: React.KeyboardEvent) => void,
) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  event.preventDefault();
  onActivate(event);
}

export function preventTextSelectionOnDoubleClick(event: React.MouseEvent) {
  if (event.detail > 1) {
    event.preventDefault();
  }
}

export function handleFileItemDragOver(
  event: React.DragEvent,
  options: {
    isFolder: boolean;
    isAdmin: boolean;
    isUploading: boolean;
    onDragOver: () => void;
  },
) {
  if (
    !canAcceptFolderDrop(options.isFolder, options.isAdmin, options.isUploading)
  ) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  options.onDragOver();
  event.dataTransfer.dropEffect = "move";
}

export function handleFileItemDrop(
  event: React.DragEvent,
  file: DriveFile,
  options: {
    isFolder: boolean;
    isAdmin: boolean;
    isUploading: boolean;
    onFileDrop: (e: React.DragEvent, targetFolder: DriveFile) => void;
    onDragLeave: () => void;
  },
) {
  if (
    !canAcceptFolderDrop(options.isFolder, options.isAdmin, options.isUploading)
  ) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  options.onDragLeave();
  options.onFileDrop(event, file);
}

export function openFileItemContextMenu(
  event: React.MouseEvent,
  file: DriveFile,
  onContextMenu: (
    position: { clientX: number; clientY: number },
    file: DriveFile,
  ) => void,
) {
  event.preventDefault();
  event.stopPropagation();
  onContextMenu({ clientX: event.clientX, clientY: event.clientY }, file);
}

export function openFileItemMenuFromButton(
  event: React.MouseEvent,
  file: DriveFile,
  onContextMenu: (
    position: { clientX: number; clientY: number },
    file: DriveFile,
  ) => void,
) {
  event.preventDefault();
  event.stopPropagation();
  const rect = (event.currentTarget as Element).getBoundingClientRect();
  onContextMenu({ clientX: rect.left, clientY: rect.bottom + 5 }, file);
}
