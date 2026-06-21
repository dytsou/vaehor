"use client";

import React from "react";
import { useAppStore } from "@/lib/store";
import { motion } from "framer-motion";
import FileItemSkeleton from "@/components/file-browser/FileItemSkeleton";
import type { ViewMode } from "@/lib/store";

const SKELETON_PLACEHOLDER_KEYS = Array.from(
  { length: 12 },
  (_, slot) => `skeleton-${slot}`,
);

const FileBrowserLoading = () => {
  const { view, density } = useAppStore();

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.05 },
    },
  };

  let containerClass: string;
  if (view === "gallery") {
    containerClass = "flex flex-col gap-4";
  } else if (view === "list") {
    containerClass = "flex flex-col gap-2";
  } else {
    containerClass =
      "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 sm:gap-4";
  }

  return (
    <motion.div
      className={containerClass}
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {SKELETON_PLACEHOLDER_KEYS.map((slotKey) => (
        <FileItemSkeleton
          key={slotKey}
          viewMode={view as ViewMode}
          density={density}
        />
      ))}
    </motion.div>
  );
};

export default FileBrowserLoading;
