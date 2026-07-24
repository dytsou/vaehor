import React, { useEffect, useRef, useState } from "react";
import { motion, Variants } from "framer-motion";
import { cn, getIcon } from "@/lib/utils";
import type { DriveFile } from "@/lib/drive";
import { useAppStore } from "@/lib/store";
import { useTranslations } from "next-intl";
import type {
  BrowserFile,
  FileBrowserActionEvent,
} from "@/components/file-browser/views/types";
import FileCardPreview from "@/components/file-browser/FileCardPreview";
import FileCardFooter from "@/components/file-browser/FileCardFooter";
import {
  canAcceptFolderDrop,
  createFileCardActionEvent,
  handleFileCardClick,
} from "@/components/file-browser/file-card-handlers";

interface FileCardProps {
  file: BrowserFile;
  onNavigate?: (folderId: string) => void;
  onClick?: (file: BrowserFile) => void;
  onContextMenu?: (
    event: { clientX: number; clientY: number },
    file: BrowserFile,
  ) => void;
  onShare?: (e: FileBrowserActionEvent, file: BrowserFile) => void;
  onDetails?: (e: FileBrowserActionEvent, file: BrowserFile) => void;
  onDownload?: (e: FileBrowserActionEvent, file: BrowserFile) => void;
  thumbnailSrc?: string;
  onMouseEnter?: () => void;
  isNavigating?: boolean;
  onPrefetchItem?: (file: DriveFile) => void;
  isAdmin?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onFileDrop?: (e: React.DragEvent, targetFolder: DriveFile) => void;
}

const cardVariants: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.2, ease: "easeOut" },
  },
  hover: {
    scale: 1.05,
    y: -5,
    transition: { duration: 0.2, ease: "easeInOut" },
  },
  tap: { scale: 0.98, transition: { duration: 0.1 } },
};

export default function FileCard({
  file,
  onNavigate,
  onClick,
  onContextMenu,
  onShare,
  onDetails,
  onDownload,
  thumbnailSrc,
  onMouseEnter,
  isNavigating,
  onPrefetchItem,
  isAdmin,
  onDragStart,
  onFileDrop,
}: Readonly<FileCardProps>) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const t = useTranslations("FileCard");
  const isFolder = file.mimeType === "application/vnd.google-apps.folder";
  const IconComponent = getIcon(file.mimeType);
  const isUploading = file.uploadStatus === "uploading";
  const displayThumbnail = Boolean(
    thumbnailSrc && !isFolder && file.hasThumbnail,
  );

  const {
    isBulkMode,
    selectedFiles,
    toggleSelection,
    enableBulkMode,
    sharePolicy,
  } = useAppStore();
  const isSelected = selectedFiles.some((f) => f.id === file.id);

  useEffect(() => {
    setIsDesktop(window.matchMedia("(pointer: fine)").matches);
  }, []);

  useEffect(() => {
    if (!onPrefetchItem || file.uploadStatus || !file.isFolder) return;

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
  }, [file, onPrefetchItem]);

  const onCardClick = (e: React.MouseEvent) => {
    handleFileCardClick(e, {
      file,
      isBulkMode,
      isFolder,
      onNavigate,
      onClick,
      toggleSelection,
      enableBulkMode,
    });
  };

  const onCardContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu?.({ clientX: e.clientX, clientY: e.clientY }, file);
  };

  const onCardDragOver = (e: React.DragEvent) => {
    if (!canAcceptFolderDrop(isFolder, isAdmin, isUploading)) return;

    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
    e.dataTransfer.dropEffect = "move";
  };

  const onCardDrop = (e: React.DragEvent) => {
    if (!canAcceptFolderDrop(isFolder, isAdmin, isUploading) || !onFileDrop) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    onFileDrop(e, file);
  };

  const onCheckboxChange = () => {
    toggleSelection(file);
    if (!isBulkMode) {
      enableBulkMode();
    }
  };

  return (
    <motion.div
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      whileHover={!isUploading && isDesktop ? "hover" : undefined}
      whileTap={!isUploading ? "tap" : undefined}
      className={cn(
        "group relative border rounded-lg transition-all bg-card p-3 flex flex-col gap-3 h-[200px] cursor-pointer select-none",
        isSelected
          ? "border-primary bg-primary/5 shadow-md ring-1 ring-primary"
          : "hover:shadow-xl hover:border-primary/30",
        isDragOver &&
          "ring-4 ring-primary/30 bg-primary/20 scale-[1.1] z-50 shadow-2xl border-primary",
      )}
      onClick={onCardClick}
      onContextMenu={onCardContextMenu}
      onMouseEnter={onMouseEnter}
      draggable={isAdmin && !isUploading && isDesktop}
      onDragStartCapture={onDragStart}
      onDragOver={onCardDragOver}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
      }}
      onDrop={onCardDrop}
      ref={containerRef}
    >
      <label
        className={cn(
          "absolute top-3 left-3 z-20 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer",
          isSelected && "opacity-100",
        )}
      >
        <span className="sr-only">{t("select", { name: file.name })}</span>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onCheckboxChange}
          className="w-5 h-5 accent-primary rounded cursor-pointer"
        />
      </label>

      <div className="flex-1 w-full bg-muted/20 rounded flex items-center justify-center overflow-hidden relative">
        <FileCardPreview
          isNavigating={isNavigating}
          isUploading={isUploading}
          displayThumbnail={displayThumbnail}
          thumbnailSrc={thumbnailSrc}
          fileName={file.name}
          isFolder={isFolder}
          IconComponent={IconComponent}
          uploadProgress={file.uploadProgress}
        />
      </div>

      <FileCardFooter
        file={file}
        isFolder={isFolder}
        folderLabel={t("folder")}
        onNavigate={onNavigate}
        onDetails={onDetails}
        onDownload={onDownload}
        onShare={onShare}
        preventDownload={sharePolicy?.preventDownload}
        createActionEvent={createFileCardActionEvent}
        labels={{
          info: t("info"),
          download: t("download"),
          share: t("share"),
          delete: t("delete"),
        }}
      />
    </motion.div>
  );
}
