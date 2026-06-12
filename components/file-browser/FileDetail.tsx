"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import ShareButton from "@/components/file-browser/ShareButton";
import InfoPanel from "../file-details/InfoPanel";
import RichMediaMetadata from "../file-details/RichMediaMetadata";
import FileDetailModalView from "./FileDetailModalView";
import FileDetailModalPreview from "./FileDetailModalPreview";
import FileDetailInlinePreview from "./FileDetailInlinePreview";
import FileDetailOverlays from "./FileDetailOverlays";
import {
  useFileDetailController,
  type FileDetailProps,
} from "./useFileDetailController";

export default function FileDetail(props: FileDetailProps) {
  const {
    file,
    isModal = false,
    prevFileUrl,
    nextFileUrl,
    currentFolderId,
    onCloseModal,
  } = props;

  const controller = useFileDetailController(props);

  const commonInfoPanelProps = {
    file,
    isAdmin: controller.isAdmin,
    canShowAuthor: controller.canShowAuthor,
    tags: controller.fileTags[file.id] || [],
    directLink: controller.directLink,
    onAddTag: (tag: string) => controller.addTag(file.id, tag),
    onRemoveTag: (tag: string) => controller.removeTag(file.id, tag),
    onCopyLink: controller.handleCopyLink,
    isImage: controller.fileType === "image",
    subtitleTracks: controller.authenticatedSubtitleTracks,
    onAddSubtitle: controller.handleAddSubtitle,
    onRemoveSubtitle: controller.handleRemoveSubtitle,
    tmdbGenres: controller.tmdbGenres,
  };

  const previewContent = (
    <FileDetailModalPreview
      file={file}
      fileType={controller.fileType}
      directLink={controller.directLink}
      onVideoEnded={() => {
        if (nextFileUrl) {
          controller.router.push(nextFileUrl);
        }
      }}
      showTextPreview={controller.showTextPreview}
      textContent={controller.textContent}
      subtitleTracks={controller.authenticatedSubtitleTracks}
      sharePolicy={controller.sharePolicy}
      watermarkFallback={controller.user?.email || controller.user?.name}
    />
  );

  if (isModal) {
    return (
      <FileDetailModalView
        previewContent={previewContent}
        prevFileUrl={prevFileUrl}
        nextFileUrl={nextFileUrl}
        onClose={onCloseModal}
        isTextPreviewable={controller.isTextPreviewable}
        showTextPreview={controller.showTextPreview}
        onShowTextPreview={() => controller.setShowTextPreview(true)}
        isDocPreviewable={controller.isDocPreviewable}
        showDocPreview={controller.showDocPreview}
        onShowDocPreview={() => controller.setShowDocPreview(true)}
        showMobileInfo={controller.showMobileInfo}
        onShowMobileInfo={() => controller.setShowMobileInfo(true)}
        onHideMobileInfo={() => controller.setShowMobileInfo(false)}
        mobileInfoPanel={<InfoPanel {...commonInfoPanelProps} />}
      />
    );
  }

  const showShareButton = !controller.shareToken && controller.isAdmin;

  return (
    <div
      className={cn(
        "container mx-auto px-4 py-6 flex flex-col h-full",
        controller.isTheaterMode ? "max-w-none" : "overflow-hidden",
      )}
    >
      {!controller.isTheaterMode && (
        <header className="flex items-center justify-between gap-4 mb-4 animate-in fade-in slide-in-from-top-4">
          <button
            onClick={() => controller.router.back()}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={20} /> {controller.t("back")}
          </button>
          {showShareButton && (
            <ShareButton
              path={`/folder/${file.parents?.[0]}/file/${file.id}/${encodeURIComponent(file.name)}`}
              itemName={file.name}
            />
          )}
        </header>
      )}

      <div
        className={cn(
          "grid grid-cols-1 lg:gap-12 flex-1 min-h-0",
          controller.isTheaterMode
            ? "lg:grid-cols-1"
            : "lg:grid-cols-3 overflow-hidden",
        )}
      >
        <div
          className={cn(
            "flex flex-col flex-1 min-h-0 relative group transition-all duration-500",
            controller.isTheaterMode
              ? "lg:col-span-1 h-[70vh] md:h-[85vh]"
              : "lg:col-span-2",
          )}
        >
          <FileDetailInlinePreview
            file={file}
            fileType={controller.fileType}
            directLink={controller.directLink}
            isEditing={controller.isEditing}
            isFetchingEditableContent={controller.isFetchingEditableContent}
            editableContent={controller.editableContent}
            onEditableContentChange={controller.setEditableContent}
            internalPreviewOpen={controller.internalPreviewOpen}
            onOpenPreview={() => controller.setInternalPreviewOpen(true)}
            isPreviewable={controller.isPreviewable}
            subtitleTracks={controller.authenticatedSubtitleTracks}
            onVideoEnded={() => {
              if (nextFileUrl) {
                controller.router.push(nextFileUrl);
              }
            }}
            isEditable={controller.isEditable}
            isTheaterMode={controller.isTheaterMode}
            isSaving={controller.isSaving}
            onSave={controller.handleSaveChanges}
            onToggleEditing={() =>
              controller.setIsEditing(!controller.isEditing)
            }
            labels={{
              saving: controller.t("saving"),
              save: controller.t("save"),
              cancel: controller.t("cancel"),
              editFile: controller.t("editFile"),
            }}
          />

          {!controller.isEditing && (
            <>
              {prevFileUrl && (
                <Link
                  href={prevFileUrl}
                  className="absolute left-0 top-1/2 p-2 bg-background/50 rounded-full opacity-0 group-hover:opacity-100 transition"
                >
                  <ChevronLeft size={28} />
                </Link>
              )}
              {nextFileUrl && (
                <Link
                  href={nextFileUrl}
                  className="absolute right-0 top-1/2 p-2 bg-background/50 rounded-full opacity-0 group-hover:opacity-100 transition"
                >
                  <ChevronRight size={28} />
                </Link>
              )}
            </>
          )}
        </div>

        {!controller.isTheaterMode && (
          <InfoPanel
            {...commonInfoPanelProps}
            onEditImage={() => controller.setShowImageEditor(true)}
            onShowHistory={() => controller.setShowHistory(true)}
          />
        )}
      </div>

      {controller.fileType === "video" && !controller.isTheaterMode && (
        <div className="mt-8 animate-in fade-in slide-in-from-bottom-4">
          <RichMediaMetadata
            filename={file.name}
            onMetadataLoaded={controller.handleMetadataLoaded}
          />
        </div>
      )}

      <FileDetailOverlays
        file={file}
        internalPreviewOpen={controller.internalPreviewOpen}
        onCloseInternalPreview={() => controller.setInternalPreviewOpen(false)}
        prevFileUrl={prevFileUrl}
        nextFileUrl={nextFileUrl}
        subtitleTracks={controller.authenticatedSubtitleTracks}
        currentFolderId={currentFolderId}
        showArchivePreview={controller.showArchivePreview}
        isArchivePreviewable={controller.isArchivePreviewable}
        onCloseArchivePreview={() => controller.setShowArchivePreview(false)}
        showImageEditor={controller.showImageEditor}
        onCloseImageEditor={() => controller.setShowImageEditor(false)}
        showHistory={controller.showHistory}
        onCloseHistory={() => controller.setShowHistory(false)}
      />
    </div>
  );
}
