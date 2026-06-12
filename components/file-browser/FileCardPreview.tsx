"use client";

import Image from "next/image";
import { Folder, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface FileCardPreviewProps {
  isNavigating?: boolean;
  isUploading: boolean;
  displayThumbnail: boolean;
  thumbnailSrc?: string;
  fileName: string;
  isFolder: boolean;
  IconComponent: LucideIcon;
  uploadProgress?: number;
}

export default function FileCardPreview({
  isNavigating,
  isUploading,
  displayThumbnail,
  thumbnailSrc,
  fileName,
  isFolder,
  IconComponent,
  uploadProgress,
}: FileCardPreviewProps) {
  if (isNavigating) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 text-primary">
        <Loader2 className="w-12 h-12 animate-spin" />
      </div>
    );
  }

  if (isUploading) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
        <div className="w-12 h-12 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-xs">{uploadProgress || 0}%</span>
      </div>
    );
  }

  if (displayThumbnail && thumbnailSrc) {
    return (
      <Image
        src={thumbnailSrc}
        alt={fileName}
        fill
        className="object-cover transition-transform group-hover:scale-105"
        unoptimized
        onError={() => {}}
      />
    );
  }

  if (isFolder) {
    return <Folder className="w-16 h-16 text-blue-500/80" />;
  }

  return <IconComponent className="w-16 h-16 text-muted-foreground" />;
}
