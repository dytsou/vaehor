"use client";

import React from "react";
import { useAppStore } from "@/lib/store";
import { TreeContext } from "./tree-context";
import { isTreeNodeActive } from "./tree-node-utils";

export function useTreeNodeData(id: string) {
  const currentFolderId = useAppStore((state) => state.currentFolderId);
  const currentFileId = useAppStore((state) => state.currentFileId);
  const navigatingId = useAppStore((state) => state.navigatingId);
  const context = React.useContext(TreeContext);
  const node = context?.tree[id];

  if (!context || !node) {
    return null;
  }

  return {
    node,
    context,
    navigatingId,
    isActuallyActive: isTreeNodeActive(
      id,
      navigatingId,
      currentFileId,
      currentFolderId,
    ),
    isDragOver: context.dragOverFolderId === id,
  };
}
