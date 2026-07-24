"use client";

import { motion } from "framer-motion";
import type { FolderNode } from "./types";
import { TreeNode } from "./TreeNode";

interface TreeNodeChildrenProps {
  node: FolderNode;
  depth: number;
}

export default function TreeNodeChildren({
  node,
  depth,
}: Readonly<TreeNodeChildrenProps>) {
  if (!node.isExpanded) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      transition={{ duration: 0.1, ease: "easeOut" }}
      className="overflow-hidden relative"
    >
      <div
        className="absolute top-0 bottom-2 border-l border-border/40"
        style={{ left: `${depth * 16 + 12 + 8}px` }}
      />
      {node.childIds.map((childId) => (
        <TreeNode key={childId} id={childId} depth={depth + 1} />
      ))}
    </motion.div>
  );
}
