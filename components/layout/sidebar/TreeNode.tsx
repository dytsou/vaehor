"use client";

import React, { memo } from "react";
import { useTreeNodeData } from "./useTreeNodeData";
import TreeNodeChevron from "./TreeNodeChevron";
import TreeNodeIcon from "./TreeNodeIcon";
import TreeNodeChildren from "./TreeNodeChildren";
import {
  handleTreeNodeDragOver,
  handleTreeNodeDrop,
  handleTreeNodeKeyDown,
  treeNodeRowClassName,
} from "./tree-node-utils";

function TreeNodeDepthGuide({ depth }: Readonly<{ depth: number }>) {
  if (depth <= 0) {
    return null;
  }

  return (
    <div
      className="absolute left-0 top-0 bottom-0 border-l border-border/40 w-px"
      style={{ left: `${depth * 16 - 4}px` }}
    />
  );
}

export const TreeNode = memo(
  ({ id, depth = 0 }: { id: string; depth?: number }) => {
    const data = useTreeNodeData(id);
    if (!data) {
      return null;
    }

    const { node, context, navigatingId, isActuallyActive, isDragOver } = data;
    const { onToggle, onNavigate, onDrop, setDragOverFolderId, canEdit } =
      context;

    return (
      <div className="relative">
        <div
          className={treeNodeRowClassName(
            isActuallyActive,
            isDragOver,
            node.isLoading,
          )}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onDragOver={(event) =>
            handleTreeNodeDragOver(event, node.id, canEdit, setDragOverFolderId)
          }
          onDragLeave={() => setDragOverFolderId(null)}
          onDrop={(event) =>
            handleTreeNodeDrop(event, node.id, canEdit, onDrop)
          }
          onClick={() => onNavigate(node.id)}
          onKeyDown={(event) =>
            handleTreeNodeKeyDown(event, node, onNavigate, onToggle)
          }
          role="treeitem"
          aria-expanded={node.isFolder ? node.isExpanded : undefined}
          aria-selected={isActuallyActive}
          tabIndex={0}
        >
          <TreeNodeDepthGuide depth={depth} />
          <TreeNodeChevron node={node} onToggle={onToggle} />
          <TreeNodeIcon
            node={node}
            isActuallyActive={isActuallyActive}
            navigatingId={navigatingId}
          />
          <span className="truncate text-[13px] leading-none pt-0.5 font-medium transition-colors">
            {node.name}
          </span>
        </div>

        <TreeNodeChildren node={node} depth={depth} />
      </div>
    );
  },
);

TreeNode.displayName = "TreeNode";
