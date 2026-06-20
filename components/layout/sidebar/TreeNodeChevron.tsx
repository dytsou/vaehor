"use client";

import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import type { FolderNode } from "./types";

interface TreeNodeChevronProps {
  node: FolderNode;
  onToggle: (id: string) => void;
}

function TreeNodeChevronIcon({ node }: { node: FolderNode }) {
  if (node.isLoading) {
    return <Loader2 size={12} className="animate-spin" />;
  }

  if (node.isExpanded) {
    return <ChevronDown size={12} />;
  }

  return <ChevronRight size={12} />;
}

export default function TreeNodeChevron({
  node,
  onToggle,
}: TreeNodeChevronProps) {
  if (!node.isFolder) {
    return <div className="w-3 shrink-0 opacity-0" aria-hidden="true" />;
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onToggle(node.id);
      }}
      aria-expanded={node.isExpanded}
      aria-label={node.isExpanded ? "Collapse folder" : "Expand folder"}
      className="p-1.5 -ml-1.5 rounded-sm transition-colors flex items-center justify-center shrink-0 border-0 bg-transparent hover:bg-muted text-muted-foreground cursor-pointer group/chevron z-10"
    >
      <TreeNodeChevronIcon node={node} />
    </button>
  );
}
