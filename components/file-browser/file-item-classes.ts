import { cn } from "@/lib/utils";
import type { ViewMode } from "@/lib/store/types";

interface FileItemShellState {
  view: ViewMode;
  isGallery: boolean;
  isSelected: boolean;
  isActive: boolean;
  isBulkMode: boolean;
  compactClass: boolean;
  isDragOver: boolean;
  isError: boolean;
}

function fileItemShellPaddingClassName(view: ViewMode, compactClass: boolean) {
  if (view !== "list") {
    return "w-full";
  }

  return compactClass ? "p-1.5 min-h-[40px]" : "p-3 min-h-[68px]";
}

export function fileItemMotionClassName(
  isGallery: boolean,
  isUploading: boolean,
) {
  return cn(
    isGallery && "mb-4",
    isUploading && "opacity-80",
    "w-full max-w-full will-change-transform",
  );
}

export function fileItemShellClassName(state: FileItemShellState) {
  return cn(
    "group relative rounded-lg transition-all duration-200 ease-in-out cursor-pointer overflow-hidden w-full border",
    "select-none touch-pan-y touch-action-manipulation",
    state.isSelected
      ? "bg-primary/10 border-primary shadow-sm"
      : "bg-card border-border hover:shadow-lg hover:border-primary/30",
    state.isActive && !state.isBulkMode && "ring-1 ring-primary",
    fileItemShellPaddingClassName(state.view, state.compactClass),
    state.view === "grid" &&
      "flex flex-col items-center justify-center text-center p-2 sm:p-4",
    state.isGallery && "p-0 border-none",
    state.isDragOver &&
      "ring-4 ring-primary/30 bg-primary/20 scale-[1.05] z-50 shadow-2xl border-primary",
    state.isError && "ring-2 ring-destructive/50 bg-destructive/5",
  );
}

function fileItemFlexLayoutClassName(view: ViewMode) {
  if (view === "list") {
    return "items-center gap-3";
  }

  if (view === "grid") {
    return "flex-col items-center justify-center gap-2";
  }

  return "flex-col";
}

export function fileItemFlexClassName(view: ViewMode) {
  return cn(
    "flex w-full min-w-0 pointer-events-none",
    fileItemFlexLayoutClassName(view),
  );
}

export function fileItemThumbnailWrapperClassName(isGallery: boolean) {
  return cn(
    "relative shrink-0 pointer-events-none",
    isGallery && "w-full min-h-[150px]",
  );
}

export function fileItemDetailsClassName(view: ViewMode, isGallery: boolean) {
  return cn(
    "flex-1 min-w-0 max-w-full",
    view === "grid" && "mt-2 w-full text-center",
    isGallery && "p-3",
  );
}

function fileItemTitleLayoutClassName(view: ViewMode) {
  if (view === "list") {
    return "text-sm justify-start";
  }

  if (view === "grid") {
    return "text-xs sm:text-sm justify-center";
  }

  return "text-sm";
}

export function fileItemTitleClassName(view: ViewMode) {
  return cn(
    "font-medium flex items-center gap-1.5 min-w-0",
    fileItemTitleLayoutClassName(view),
  );
}

export function fileItemMobileMenuClassName(view: ViewMode) {
  return cn(
    "md:hidden p-2.5 -m-1 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0 z-30 active:bg-accent active:text-primary pointer-events-auto select-none",
    view === "grid" || view === "gallery"
      ? "absolute top-1 right-1 bg-background/70 backdrop-blur-sm shadow-sm border border-black/5"
      : "ml-auto",
  );
}

export function fileItemBulkCheckboxClassName(view: ViewMode) {
  return cn(
    "absolute h-5 w-5 pointer-events-auto z-10",
    view === "list" ? "right-4 top-1/2 -translate-y-1/2" : "top-2 right-2",
    "rounded border-primary text-primary focus:ring-primary accent-primary",
  );
}
