"use client";

import dynamic from "next/dynamic";
import { Maximize2, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DriveFile } from "@/lib/drive";
import type { SubtitleTrack } from "@/lib/subtitles";
import {
  ImagePreview,
  LoadingPreview,
  FileIconPlaceholder,
} from "../file-details/PreviewRenderers";

const VideoPlayer = dynamic(() => import("../file-details/VideoPlayer"), {
  loading: () => <LoadingPreview />,
});

interface FileDetailInlinePreviewProps {
  file: DriveFile;
  fileType: string;
  directLink: string;
  isEditing: boolean;
  isFetchingEditableContent: boolean;
  editableContent: string | null;
  onEditableContentChange: (value: string) => void;
  internalPreviewOpen: boolean;
  onOpenPreview: () => void;
  isPreviewable: boolean;
  subtitleTracks: SubtitleTrack[];
  onVideoEnded: () => void;
  isEditable: boolean;
  isTheaterMode: boolean;
  isSaving: boolean;
  onSave: () => void;
  onToggleEditing: () => void;
  labels: {
    saving: string;
    save: string;
    cancel: string;
    editFile: string;
  };
}

function FileDetailEditorToolbar({
  isEditing,
  isSaving,
  onSave,
  onToggleEditing,
  labels,
}: Pick<
  FileDetailInlinePreviewProps,
  "isEditing" | "isSaving" | "onSave" | "onToggleEditing" | "labels"
>) {
  return (
    <div className="mb-2 flex justify-end gap-2">
      {isEditing && (
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="px-3 py-1 bg-primary text-primary-foreground rounded flex items-center gap-2"
        >
          <Save size={16} /> {isSaving ? labels.saving : labels.save}
        </button>
      )}
      <button
        type="button"
        onClick={onToggleEditing}
        className="px-3 py-1 bg-secondary rounded"
      >
        {isEditing ? labels.cancel : labels.editFile}
      </button>
    </div>
  );
}

function FileDetailEditPreview({
  isFetchingEditableContent,
  editableContent,
  onEditableContentChange,
}: Readonly<
  Pick<
    FileDetailInlinePreviewProps,
    "isFetchingEditableContent" | "editableContent" | "onEditableContentChange"
  >
>) {
  if (isFetchingEditableContent) {
    return <LoadingPreview />;
  }

  return (
    <textarea
      value={editableContent || ""}
      onChange={(event) => onEditableContentChange(event.target.value)}
      className="w-full h-full p-4 bg-background font-mono text-sm resize-none focus:outline-none border rounded-lg"
      spellCheck="false"
    />
  );
}

function FileDetailViewPreview({
  file,
  fileType,
  directLink,
  internalPreviewOpen,
  onOpenPreview,
  isPreviewable,
  subtitleTracks,
  onVideoEnded,
}: Pick<
  FileDetailInlinePreviewProps,
  | "file"
  | "fileType"
  | "directLink"
  | "internalPreviewOpen"
  | "onOpenPreview"
  | "isPreviewable"
  | "subtitleTracks"
  | "onVideoEnded"
>) {
  if (fileType === "video") {
    return (
      <div className="w-full h-full bg-black rounded-xl overflow-hidden flex items-center justify-center shadow-2xl ring-1 ring-white/10">
        {!internalPreviewOpen && (
          <VideoPlayer
            src={directLink}
            title={file.name}
            type="video"
            poster={file.thumbnailLink}
            webViewLink={file.webViewLink}
            subtitleTracks={subtitleTracks}
            onEnded={onVideoEnded}
          />
        )}
      </div>
    );
  }

  if (fileType === "image") {
    return (
      <button
        type="button"
        className="w-full h-full min-h-[320px] sm:min-h-[420px] lg:min-h-0 relative cursor-zoom-in group/image flex items-center justify-center border-0 bg-transparent p-0"
        onClick={onOpenPreview}
        aria-label={`Open ${file.name} preview`}
      >
        <ImagePreview src={directLink} />
        <div
          className="absolute top-2 right-2 p-2 bg-black/50 text-white rounded-full opacity-0 group-hover/image:opacity-100 transition-opacity pointer-events-none"
          aria-hidden="true"
        >
          <Maximize2 size={20} />
        </div>
      </button>
    );
  }

  return (
    <FileIconPlaceholder
      mimeType={file.mimeType}
      onPreview={onOpenPreview}
      isPreviewable={isPreviewable}
    />
  );
}

export default function FileDetailInlinePreview(
  props: FileDetailInlinePreviewProps,
) {
  const { fileType, isEditing, isEditable, isTheaterMode } = props;

  return (
    <>
      {isEditable && !isTheaterMode && <FileDetailEditorToolbar {...props} />}

      <div
        className={cn(
          "w-full flex-1 flex items-start justify-center overflow-hidden",
          !isEditing && fileType !== "image" && "bg-background rounded-lg",
        )}
      >
        {isEditing ? (
          <FileDetailEditPreview {...props} />
        ) : (
          <FileDetailViewPreview {...props} />
        )}
      </div>
    </>
  );
}
