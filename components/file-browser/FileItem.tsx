import type { DriveFile } from "@/lib/drive";
import { memo } from "react";
import { motion, type Variants } from "framer-motion";
import { useTranslations, useFormatter } from "next-intl";
import type {
  BrowserFile,
  FileBrowserActionEvent,
} from "@/components/file-browser/views/types";
import { useFileItemState } from "@/components/file-browser/useFileItemState";
import FileItemThumbnail from "@/components/file-browser/FileItemThumbnail";
import FileItemDetails from "@/components/file-browser/FileItemDetails";
import FileItemToolbar from "@/components/file-browser/FileItemToolbar";
import {
  fileItemFlexClassName,
  fileItemMotionClassName,
  fileItemShellClassName,
  fileItemThumbnailWrapperClassName,
} from "@/components/file-browser/file-item-classes";
import {
  handleFileItemActivate,
  handleFileItemDragOver,
  handleFileItemDrop,
  handleFileItemKeyDown,
  openFileItemContextMenu,
  preventTextSelectionOnDoubleClick,
} from "@/components/file-browser/file-item-handlers";

interface FileItemProps {
  file: BrowserFile;
  onClick: (e: FileBrowserActionEvent) => void;
  onContextMenu: (
    event: { clientX: number; clientY: number },
    file: DriveFile,
  ) => void;
  isSelected: boolean;
  isActive: boolean;
  isBulkMode: boolean;
  onShare: (e: FileBrowserActionEvent) => void;
  onShowDetails: (e: FileBrowserActionEvent) => void;
  onDownload: (e: FileBrowserActionEvent) => void;
  onToggleFavorite?: (e: FileBrowserActionEvent) => void;
  isAdmin: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onFileDrop: (e: React.DragEvent, targetFolder: DriveFile) => void;
  onMouseEnter?: () => void;
  density?: "comfortable" | "compact";
  isShared?: boolean;
  uploadProgress?: number;
  uploadStatus?: "uploading" | "error" | "success";
  uploadError?: string;
  isNavigating?: boolean;
  onPrefetchItem?: (file: DriveFile) => void;
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.2, ease: "easeOut" },
  },
  hover: {
    scale: 1.02,
    y: -2,
    transition: { duration: 0.2, ease: "easeInOut" },
  },
  tap: { scale: 0.98, transition: { duration: 0.1 } },
};

function FileItem({
  file,
  onClick,
  onContextMenu,
  isSelected,
  isActive,
  isBulkMode,
  onShare,
  onShowDetails,
  onDownload,
  isAdmin,
  onDragStart,
  onFileDrop,
  onMouseEnter,
  density = "comfortable",
  uploadProgress,
  uploadStatus,
  isNavigating,
  onPrefetchItem,
}: FileItemProps) {
  const t = useTranslations("FileItem");
  const format = useFormatter();
  const {
    containerRef,
    view,
    toggleSelection,
    Icon,
    isDragOver,
    setIsDragOver,
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
  } = useFileItemState({
    file,
    density,
    isAdmin,
    uploadStatus,
    onPrefetchItem,
  });

  const onActivate = (event: React.MouseEvent | React.KeyboardEvent) => {
    handleFileItemActivate(event, { isUploading, onClick });
  };

  return (
    <motion.div
      variants={itemVariants}
      initial="hidden"
      animate="visible"
      whileHover={!isUploading && isDesktop ? "hover" : undefined}
      whileTap={!isUploading ? "tap" : undefined}
      className={fileItemMotionClassName(isGallery, isUploading)}
      onMouseEnter={onMouseEnter}
      ref={containerRef}
    >
      <div
        className={fileItemShellClassName({
          view,
          isGallery,
          isSelected,
          isActive,
          isBulkMode,
          compactClass,
          isDragOver,
          isError,
        })}
        style={{ WebkitTapHighlightColor: "transparent" }}
        onClick={onActivate}
        onKeyDown={(event) => handleFileItemKeyDown(event, onActivate)}
        onMouseDown={preventTextSelectionOnDoubleClick}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onContextMenu={
          isUploading
            ? undefined
            : (event) => openFileItemContextMenu(event, file, onContextMenu)
        }
        draggable={canDrag}
        onDragStart={onDragStart}
        onDragOver={(event) =>
          handleFileItemDragOver(event, {
            isFolder: Boolean(file.isFolder),
            isAdmin,
            isUploading,
            onDragOver: () => setIsDragOver(true),
          })
        }
        onDragLeave={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setIsDragOver(false);
        }}
        onDrop={(event) =>
          handleFileItemDrop(event, file, {
            isFolder: Boolean(file.isFolder),
            isAdmin,
            isUploading,
            onFileDrop,
            onDragLeave: () => setIsDragOver(false),
          })
        }
        role="button"
        tabIndex={0}
      >
        <div className={fileItemFlexClassName(view)}>
          <div className={fileItemThumbnailWrapperClassName(isGallery)}>
            <FileItemThumbnail
              file={file}
              view={view}
              isGallery={isGallery}
              hasImage={hasImage}
              thumbnailSrc={thumbnailSrc}
              Icon={Icon}
              compactClass={compactClass}
              isNavigating={isNavigating}
              isImageLoading={isImageLoading}
              onImageLoad={() => setIsImageLoading(false)}
              onImageError={() => {
                setIsImageLoading(false);
                setImageError(true);
              }}
            />
          </div>

          <FileItemDetails
            file={file}
            view={view}
            isGallery={isGallery}
            isBulkMode={isBulkMode}
            compactClass={compactClass}
            isUploading={isUploading}
            isError={isError}
            uploadProgress={uploadProgress}
            formatDate={(value) =>
              format.dateTime(value, {
                day: "numeric",
                month: "short",
                year: "numeric",
              })
            }
          />

          <FileItemToolbar
            file={file}
            view={view}
            isAdmin={isAdmin}
            isBulkMode={isBulkMode}
            isSelected={isSelected}
            isUploading={isUploading}
            compactClass={compactClass}
            onShare={onShare}
            onShowDetails={onShowDetails}
            onDownload={onDownload}
            onContextMenu={onContextMenu}
            onToggleSelection={toggleSelection}
            labels={{
              share: t("share"),
              download: t("download"),
              viewDetails: t("viewDetails"),
              moreOptions: t("moreOptions"),
            }}
          />
        </div>
      </div>
    </motion.div>
  );
}

const arePropsEqual = (prevProps: FileItemProps, nextProps: FileItemProps) => {
  return (
    prevProps.file.id === nextProps.file.id &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isActive === nextProps.isActive &&
    prevProps.isBulkMode === nextProps.isBulkMode &&
    prevProps.density === nextProps.density &&
    prevProps.isShared === nextProps.isShared &&
    prevProps.uploadProgress === nextProps.uploadProgress &&
    prevProps.uploadStatus === nextProps.uploadStatus &&
    prevProps.file.name === nextProps.file.name &&
    prevProps.file.isFavorite === nextProps.file.isFavorite &&
    prevProps.isAdmin === nextProps.isAdmin
  );
};

export default memo(FileItem, arePropsEqual);
