import { cn } from "@/lib/utils";
import type { FolderNode } from "./types";

export function isTreeNodeActive(
  id: string,
  navigatingId: string | null,
  currentFileId: string | null,
  currentFolderId: string | null,
): boolean {
  return (
    navigatingId === id ||
    (currentFileId ? currentFileId === id : currentFolderId === id)
  );
}

export function treeNodeRowClassName(
  isActuallyActive: boolean,
  isDragOver: boolean,
  isLoading: boolean,
) {
  return cn(
    "flex items-center gap-1.5 py-1.5 px-2 cursor-pointer hover:bg-accent/50 text-sm rounded-md transition-all select-none relative group my-0.5",
    isActuallyActive && "bg-accent text-accent-foreground font-medium",
    isDragOver && "bg-primary/20 scale-[1.02] ring-2 ring-primary/50",
    isLoading && "opacity-70",
  );
}

export function handleTreeNodeKeyDown(
  event: React.KeyboardEvent,
  node: FolderNode,
  onNavigate: (id: string) => void,
  onToggle: (id: string) => void,
) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onNavigate(node.id);
    return;
  }

  if (event.key === "ArrowRight" && node.isFolder && !node.isExpanded) {
    event.preventDefault();
    onToggle(node.id);
    return;
  }

  if (event.key === "ArrowLeft" && node.isFolder && node.isExpanded) {
    event.preventDefault();
    onToggle(node.id);
  }
}

export function handleTreeNodeDragOver(
  event: React.DragEvent,
  nodeId: string,
  canEdit: boolean,
  setDragOverFolderId: (id: string | null) => void,
) {
  if (!canEdit) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  setDragOverFolderId(nodeId);
}

export function handleTreeNodeDrop(
  event: React.DragEvent,
  nodeId: string,
  canEdit: boolean,
  onDrop: (e: React.DragEvent, targetId: string) => void,
) {
  if (!canEdit) {
    return;
  }

  onDrop(event, nodeId);
}
