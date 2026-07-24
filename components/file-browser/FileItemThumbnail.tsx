"use client";

import React from "react";
import Image from "next/image";
import { Lock, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ViewMode } from "@/lib/store/types";
import type { DriveFile } from "@/lib/drive";
import { cn } from "@/lib/utils";
import { getFileItemIconSize } from "@/components/file-browser/file-item-utils";

interface FileItemThumbnailProps {
  file: DriveFile;
  view: ViewMode;
  isGallery: boolean;
  hasImage: boolean;
  thumbnailSrc?: string;
  Icon: LucideIcon;
  compactClass: boolean;
  isNavigating?: boolean;
  isImageLoading: boolean;
  onImageLoad: () => void;
  onImageError: () => void;
}

function GalleryThumbnail({
  file,
  thumbnailSrc,
  Icon,
  isImageLoading,
  onImageLoad,
  onImageError,
}: Readonly<
  Pick<
    FileItemThumbnailProps,
    | "file"
    | "thumbnailSrc"
    | "Icon"
    | "isImageLoading"
    | "onImageLoad"
    | "onImageError"
  >
>) {
  return (
    <div className="relative w-full bg-muted/20">
      {isImageLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/30 z-10">
          <Icon size={32} className="opacity-20" />
        </div>
      )}
      <Image
        src={thumbnailSrc!}
        alt={file.name}
        width={0}
        height={0}
        sizes="100vw"
        style={{ width: "100%", height: "auto" }}
        className={cn(
          "object-cover block transition-opacity duration-200 select-none",
          isImageLoading ? "opacity-0" : "opacity-100",
        )}
        loading="lazy"
        decoding="async"
        onLoad={onImageLoad}
        onError={onImageError}
        unoptimized
      />
    </div>
  );
}

function GridThumbnail({
  file,
  thumbnailSrc,
  onImageError,
}: Readonly<
  Pick<FileItemThumbnailProps, "file" | "thumbnailSrc" | "onImageError">
>) {
  return (
    <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-md overflow-hidden flex items-center justify-center bg-muted/20">
      <Image
        src={thumbnailSrc!}
        alt={file.name}
        fill
        className="object-cover select-none"
        sizes="(max-width: 640px) 80px, 150px"
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        unoptimized={true}
        onError={onImageError}
      />
    </div>
  );
}

function FileItemIconPreview({
  view,
  isGallery,
  compactClass,
  isNavigating,
  Icon,
}: Pick<
  FileItemThumbnailProps,
  "view" | "isGallery" | "compactClass" | "isNavigating" | "Icon"
>) {
  const iconSize = getFileItemIconSize(view, isGallery, compactClass);

  return (
    <div
      className={cn(
        "text-3xl text-primary shrink-0 flex items-center justify-center select-none",
        view === "grid" && "text-4xl mb-2",
        isGallery && "py-8 text-6xl bg-accent/10 w-full flex flex-col gap-2",
      )}
    >
      {isNavigating ? (
        <Loader2 size={iconSize} className="animate-spin text-primary" />
      ) : (
        React.createElement(Icon, { size: iconSize })
      )}
    </div>
  );
}

export default function FileItemThumbnail(props: FileItemThumbnailProps) {
  const { file, view, isGallery, hasImage } = props;

  let preview: React.ReactNode;
  if (isGallery && hasImage) {
    preview = <GalleryThumbnail {...props} />;
  } else if (view === "grid" && hasImage) {
    preview = <GridThumbnail {...props} />;
  } else {
    preview = <FileItemIconPreview {...props} />;
  }

  return (
    <>
      {preview}
      {view !== "list" && file.isProtected && !isGallery && (
        <div className="absolute -bottom-1 -right-1 flex items-center justify-center p-1.5 bg-background/60 rounded-full ring-2 ring-background/20 z-20">
          <Lock size={12} className="text-primary" />
        </div>
      )}
    </>
  );
}
