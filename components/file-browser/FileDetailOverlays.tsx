"use client";

import dynamic from "next/dynamic";
import type { DriveFile } from "@/lib/drive";
import type { SubtitleTrack } from "@/lib/subtitles";

const FileDetail = dynamic(() => import("./FileDetail"));
const ArchivePreviewModal = dynamic(
  () => import("@/components/modals/ArchivePreviewModal"),
);
const ImageEditorModal = dynamic(
  () => import("@/components/modals/ImageEditorModal"),
);
const FileRevisionsModal = dynamic(
  () => import("@/components/modals/FileRevisionsModal"),
);

interface FileDetailOverlaysProps {
  file: DriveFile;
  internalPreviewOpen: boolean;
  onCloseInternalPreview: () => void;
  prevFileUrl?: string;
  nextFileUrl?: string;
  subtitleTracks: SubtitleTrack[];
  currentFolderId?: string;
  showArchivePreview: boolean;
  isArchivePreviewable: boolean;
  onCloseArchivePreview: () => void;
  showImageEditor: boolean;
  onCloseImageEditor: () => void;
  showHistory: boolean;
  onCloseHistory: () => void;
}

export default function FileDetailOverlays({
  file,
  internalPreviewOpen,
  onCloseInternalPreview,
  prevFileUrl,
  nextFileUrl,
  subtitleTracks,
  currentFolderId,
  showArchivePreview,
  isArchivePreviewable,
  onCloseArchivePreview,
  showImageEditor,
  onCloseImageEditor,
  showHistory,
  onCloseHistory,
}: FileDetailOverlaysProps) {
  return (
    <>
      {internalPreviewOpen && (
        <FileDetail
          file={file}
          isModal={true}
          onCloseModal={onCloseInternalPreview}
          prevFileUrl={prevFileUrl}
          nextFileUrl={nextFileUrl}
          subtitleTracks={subtitleTracks}
          currentFolderId={currentFolderId}
        />
      )}
      {showArchivePreview && isArchivePreviewable && (
        <ArchivePreviewModal file={file} onClose={onCloseArchivePreview} />
      )}
      {showImageEditor && (
        <ImageEditorModal file={file} onClose={onCloseImageEditor} />
      )}
      {showHistory && (
        <FileRevisionsModal
          fileId={file.id}
          fileName={file.name}
          onClose={onCloseHistory}
        />
      )}
    </>
  );
}
