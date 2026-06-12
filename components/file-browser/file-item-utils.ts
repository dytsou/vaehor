import type { ViewMode } from "@/lib/store/types";

export function getFileItemThumbnailSrc(
  thumbnailLink: string | undefined,
  view: ViewMode,
): string | undefined {
  if (!thumbnailLink) {
    return undefined;
  }

  let size = "s800";
  if (view === "list") {
    size = "s64";
  } else if (view === "grid") {
    size = "s320";
  } else if (view === "gallery") {
    size = "s1280";
  }

  return thumbnailLink.replace(/=s\d+/, `=${size}`);
}

export function getFileItemIconSize(
  view: ViewMode,
  isGallery: boolean,
  compactClass: boolean,
): number {
  if (view === "grid") {
    return 48;
  }
  if (isGallery) {
    return 64;
  }
  if (compactClass) {
    return 20;
  }
  return 28;
}
