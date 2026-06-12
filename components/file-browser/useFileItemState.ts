"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/lib/store";
import { getIcon } from "@/lib/utils";
import type { DriveFile } from "@/lib/drive";
import { getFileItemThumbnailSrc } from "@/components/file-browser/file-item-utils";

interface UseFileItemStateOptions {
  file: DriveFile;
  density: "comfortable" | "compact";
  isAdmin: boolean;
  uploadStatus?: "uploading" | "error" | "success";
  onPrefetchItem?: (file: DriveFile) => void;
}

export function useFileItemState({
  file,
  density,
  isAdmin,
  uploadStatus,
  onPrefetchItem,
}: UseFileItemStateOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { view, toggleSelection } = useAppStore();
  const Icon = getIcon(file.mimeType);
  const [isDragOver, setIsDragOver] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [isImageLoading, setIsImageLoading] = useState(true);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    if (!onPrefetchItem || uploadStatus || !file.isFolder) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          onPrefetchItem(file);
        }
      },
      { rootMargin: "200px" },
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [file, uploadStatus, onPrefetchItem]);

  useEffect(() => {
    const checkMatch = () => {
      setIsDesktop(window.matchMedia("(pointer: fine)").matches);
    };

    checkMatch();
    window.addEventListener("resize", checkMatch);
    return () => window.removeEventListener("resize", checkMatch);
  }, []);

  const thumbnailSrc = useMemo(
    () => getFileItemThumbnailSrc(file.thumbnailLink, view),
    [file.thumbnailLink, view],
  );

  const isGallery = view === "gallery";
  const hasImage = Boolean(thumbnailSrc && !file.isFolder && !imageError);
  const compactClass = density === "compact" && view === "list";
  const isUploading = uploadStatus === "uploading";
  const isError = uploadStatus === "error";
  const canDrag = isAdmin && !isUploading && isDesktop;

  return {
    containerRef,
    view,
    toggleSelection,
    Icon,
    isDragOver,
    setIsDragOver,
    imageError,
    setImageError,
    isImageLoading,
    setIsImageLoading,
    isDesktop,
    thumbnailSrc,
    isGallery,
    hasImage,
    compactClass,
    isUploading,
    isError,
    canDrag,
  };
}
