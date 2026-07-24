import type {
  BrowserFile,
  FileBrowserActionEvent,
} from "@/components/file-browser/views/types";

export function isInteractiveClickTarget(target: HTMLElement): boolean {
  return Boolean(
    target.closest("button") ||
      target.closest("input") ||
      target.closest("label"),
  );
}

export function handleFileCardClick(
  e: React.MouseEvent,
  options: {
    file: BrowserFile;
    isBulkMode: boolean;
    isFolder: boolean;
    onNavigate?: (folderId: string) => void;
    onClick?: (file: BrowserFile) => void;
    toggleSelection: (file: BrowserFile) => void;
    enableBulkMode: () => void;
  },
) {
  const target = e.target as HTMLElement;
  if (isInteractiveClickTarget(target)) {
    return;
  }

  if (options.isBulkMode || e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();
    options.toggleSelection(options.file);
    if (!options.isBulkMode) {
      options.enableBulkMode();
    }
    return;
  }

  if (options.isFolder && options.onNavigate) {
    e.preventDefault();
    options.onNavigate(options.file.id);
    return;
  }

  options.onClick?.(options.file);
}

export function canAcceptFolderDrop(
  isFolder: boolean,
  isAdmin?: boolean,
  isUploading?: boolean,
): boolean {
  return Boolean(isFolder && isAdmin && !isUploading);
}

export function createFileCardActionEvent(
  event: React.MouseEvent,
): FileBrowserActionEvent {
  return {
    preventDefault: () => event.preventDefault(),
    stopPropagation: () => event.stopPropagation(),
    shiftKey: event.shiftKey,
  };
}
