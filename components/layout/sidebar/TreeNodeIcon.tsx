"use client";

import { File, Folder, Loader2, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FolderNode } from "./types";

interface TreeNodeIconProps {
  node: FolderNode;
  isActuallyActive: boolean;
  navigatingId: string | null;
}

export default function TreeNodeIcon({
  node,
  isActuallyActive,
  navigatingId,
}: TreeNodeIconProps) {
  if (navigatingId === node.id) {
    return (
      <div className="relative shrink-0 flex items-center justify-center w-3.5 h-3.5">
        <Loader2 size={14} className="animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="relative shrink-0 flex items-center justify-center w-3.5 h-3.5">
      {node.isFolder ? (
        <Folder
          size={14}
          className={cn(
            "shrink-0 transition-colors",
            isActuallyActive
              ? "text-primary fill-primary/20"
              : "text-muted-foreground group-hover:text-primary",
          )}
        />
      ) : (
        <File
          size={14}
          className={cn(
            "shrink-0 transition-colors",
            isActuallyActive
              ? "text-primary"
              : "text-muted-foreground group-hover:text-primary",
          )}
        />
      )}
      {node.isProtected && (
        <div className="absolute -bottom-0.5 -right-0.5 bg-background rounded-full p-0.5">
          <Lock size={8} className="text-primary fill-primary/20" />
        </div>
      )}
    </div>
  );
}
