"use client";

import dynamic from "next/dynamic";
import type { DriveFile } from "@/lib/drive";
import type { SubtitleTrack } from "@/lib/subtitles";
import type { SharePolicy } from "@/lib/store/types";
import {
  ImagePreview,
  EbookPreview,
  CodePreview,
  DefaultPreview,
} from "../file-details/PreviewRenderers";

const VideoPlayer = dynamic(() => import("../file-details/VideoPlayer"));
const MarkdownViewer = dynamic(() => import("../file-details/MarkdownViewer"));
const AudioPlayer = dynamic(() => import("../file-details/AudioPlayer"));

const WATERMARK_TILE_KEYS = [
  "watermark-tile-1",
  "watermark-tile-2",
  "watermark-tile-3",
  "watermark-tile-4",
  "watermark-tile-5",
  "watermark-tile-6",
  "watermark-tile-7",
  "watermark-tile-8",
  "watermark-tile-9",
  "watermark-tile-10",
  "watermark-tile-11",
  "watermark-tile-12",
  "watermark-tile-13",
  "watermark-tile-14",
  "watermark-tile-15",
] as const;

interface FileDetailModalPreviewProps {
  file: DriveFile;
  fileType: string;
  directLink: string;
  onVideoEnded: () => void;
  showTextPreview: boolean;
  textContent: string | null;
  subtitleTracks: SubtitleTrack[];
  sharePolicy?: SharePolicy | null;
  watermarkFallback?: string | null;
}

function renderPreviewByType({
  file,
  fileType,
  directLink,
  onVideoEnded,
  showTextPreview,
  textContent,
  subtitleTracks,
}: Pick<
  FileDetailModalPreviewProps,
  | "file"
  | "fileType"
  | "directLink"
  | "onVideoEnded"
  | "showTextPreview"
  | "textContent"
  | "subtitleTracks"
>) {
  switch (fileType) {
    case "video":
      return (
        <VideoPlayer
          src={directLink}
          title={file.name}
          type="video"
          poster={file.thumbnailLink}
          webViewLink={file.webViewLink}
          subtitleTracks={subtitleTracks}
          onEnded={onVideoEnded}
        />
      );
    case "audio":
      return (
        <AudioPlayer
          src={directLink}
          title={file.name}
          mimeType={file.mimeType}
          poster={file.thumbnailLink}
        />
      );
    case "image":
      return <ImagePreview src={directLink} />;
    case "ebook":
      return <EbookPreview src={directLink} />;
    case "markdown":
      if (showTextPreview && textContent) {
        return (
          <div className="w-full h-full overflow-y-auto">
            <MarkdownViewer content={textContent} />
          </div>
        );
      }
      break;
    case "text":
    case "code":
      if (showTextPreview) {
        return <CodePreview src={directLink} fileName={file.name} />;
      }
      break;
  }

  return (
    <DefaultPreview
      mimeType={file.mimeType}
      fileName={file.name}
      downloadUrl={directLink}
    />
  );
}

export default function FileDetailModalPreview({
  file,
  fileType,
  directLink,
  onVideoEnded,
  showTextPreview,
  textContent,
  subtitleTracks,
  sharePolicy,
  watermarkFallback,
}: Readonly<FileDetailModalPreviewProps>) {
  const showWatermark =
    sharePolicy?.hasWatermark && fileType !== "video" && fileType !== "pdf";

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      {renderPreviewByType({
        file,
        fileType,
        directLink,
        onVideoEnded,
        showTextPreview,
        textContent,
        subtitleTracks,
      })}

      {showWatermark && (
        <div className="absolute inset-0 pointer-events-none z-[90] overflow-hidden flex flex-wrap justify-around items-center opacity-[0.25] mix-blend-difference w-full h-full select-none text-white/80">
          {WATERMARK_TILE_KEYS.map((tileKey) => (
            <div
              key={tileKey}
              className="text-xl sm:text-3xl font-black -rotate-[30deg] p-6 sm:p-10 whitespace-nowrap drop-shadow-md"
            >
              {sharePolicy?.watermarkText ||
                watermarkFallback ||
                "Confidential View"}
              <br />
              <span className="text-sm sm:text-lg opacity-80">
                {new Date().toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
