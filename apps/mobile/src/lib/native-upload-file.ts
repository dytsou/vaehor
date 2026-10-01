import * as DocumentPicker from "expo-document-picker";
import {
  Directory as ExpoDirectory,
  File as ExpoFile,
  FileMode,
  Paths,
} from "expo-file-system";
import type { NativeUploadFile } from "./upload-bridge";

export type NativeScheduledUploadFile = NativeUploadFile & {
  body?: Blob;
};

export type NativeScheduledUploadEntry = Readonly<{
  path: string;
  kind: "file" | "folder";
  size: number;
  contentType?: string;
  file?: NativeScheduledUploadFile;
}>;

export type NativeScheduledUploadSelection = Readonly<{
  entries: readonly NativeScheduledUploadEntry[];
  release: () => void;
}>;

export class NativeFolderPickerError extends Error {
  readonly recoverable = true;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NativeFolderPickerError";
  }
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  csv: "text/csv",
  css: "text/css",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  epub: "application/epub+zip",
  gif: "image/gif",
  heic: "image/heic",
  html: "text/html",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "text/javascript",
  json: "application/json",
  md: "text/markdown",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  pdf: "application/pdf",
  png: "image/png",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  svg: "image/svg+xml",
  txt: "text/plain",
  wav: "audio/wav",
  webm: "video/webm",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xml: "application/xml",
  zip: "application/zip",
};

function mimeTypeForName(name: string): string {
  const extension = name.split(".").at(-1)?.toLowerCase();
  return (
    (extension && MIME_BY_EXTENSION[extension]) || "application/octet-stream"
  );
}

function isPickerCancellation(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const error = cause as { code?: unknown; message?: unknown };
  const code = typeof error.code === "string" ? error.code.toLowerCase() : "";
  const message =
    typeof error.message === "string" ? error.message.toLowerCase() : "";
  return (
    code.includes("cancel") ||
    code === "e_canceled" ||
    message.includes("cancelled") ||
    message.includes("canceled")
  );
}

function createSelection(
  entries: NativeScheduledUploadEntry[],
): NativeScheduledUploadSelection {
  let released = false;
  return {
    entries,
    release: () => {
      if (released) return;
      released = true;
      for (const entry of entries) entry.file?.close?.();
    },
  };
}

function openExpoFileUploadFile(
  source: ExpoFile,
  name: string,
  fallbackSize?: number,
  fallbackMimeType?: string | null,
): NativeScheduledUploadFile {
  const handle = source.open(FileMode.ReadOnly);
  const size = handle.size ?? fallbackSize ?? source.size;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
    handle.close();
    throw new Error("This device could not read the selected file size.");
  }

  let closed = false;
  return {
    name,
    mimeType: fallbackMimeType || source.type || mimeTypeForName(name),
    size,
    body: source,
    readChunk: async (start, end, signal) => {
      if (signal?.aborted) throw new Error("Upload cancelled");
      if (closed) throw new Error("The selected file is no longer available.");
      handle.offset = start;
      return handle.readBytes(end - start);
    },
    close: () => {
      if (closed) return;
      closed = true;
      handle.close();
    },
  };
}

export function deletePickedCacheFile(uri: string) {
  if (!uri.startsWith(Paths.cache.uri)) return;
  try {
    new ExpoFile(uri).delete();
  } catch {
    // The operating system may already have removed a temporary picker copy.
  }
}

export function openDocumentPickerUploadFile(
  asset: DocumentPicker.DocumentPickerAsset,
  fileName = asset.name,
): NativeUploadFile {
  const source = new ExpoFile(asset.uri);
  return openExpoFileUploadFile(source, fileName, asset.size, asset.mimeType);
}

export async function pickScheduledUploadFiles(): Promise<NativeScheduledUploadSelection | null> {
  let result: DocumentPicker.DocumentPickerResult;
  try {
    result = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      multiple: true,
      copyToCacheDirectory: false,
    });
  } catch (cause) {
    if (isPickerCancellation(cause)) return null;
    throw new NativeFolderPickerError(
      "The selected files could not be opened. Select them again and keep this screen open while they stage.",
      { cause },
    );
  }

  if (result.canceled || result.assets.length === 0) return null;

  const entries: NativeScheduledUploadEntry[] = [];
  try {
    for (const asset of result.assets) {
      const file = openExpoFileUploadFile(
        new ExpoFile(asset.uri),
        asset.name,
        asset.size,
        asset.mimeType,
      );
      entries.push({
        path: asset.name,
        kind: "file",
        size: file.size,
        contentType: file.mimeType,
        file,
      });
    }
  } catch (cause) {
    createSelection(entries).release();
    throw cause;
  }

  return createSelection(entries);
}

export async function pickScheduledUploadDirectory(): Promise<NativeScheduledUploadSelection | null> {
  let root: ExpoDirectory;
  try {
    root = await ExpoDirectory.pickDirectoryAsync();
  } catch (cause) {
    if (isPickerCancellation(cause)) return null;
    throw new NativeFolderPickerError(
      "The selected folder could not be opened. Select it again and keep this screen open while its files stage.",
      { cause },
    );
  }

  const entries: NativeScheduledUploadEntry[] = [];
  const visitedDirectories = new Set<string>();
  const visit = (directory: ExpoDirectory, parentPath: string) => {
    if (visitedDirectories.has(directory.uri)) return;
    visitedDirectories.add(directory.uri);

    const children = directory
      .list()
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const path = parentPath ? `${parentPath}/${child.name}` : child.name;
      if (child instanceof ExpoDirectory) {
        entries.push({ path, kind: "folder", size: 0 });
        visit(child, path);
        continue;
      }

      if (!(child instanceof ExpoFile)) {
        throw new NativeFolderPickerError(
          "This folder contains an item the device cannot read.",
        );
      }

      const file = openExpoFileUploadFile(child, child.name);
      entries.push({
        path,
        kind: "file",
        size: file.size,
        contentType: file.mimeType,
        file,
      });
    }
  };

  try {
    visit(root, root.name);
    if (entries.length === 0) {
      entries.push({ path: root.name, kind: "folder", size: 0 });
    }
  } catch (cause) {
    createSelection(entries).release();
    if (cause instanceof NativeFolderPickerError) throw cause;
    throw new NativeFolderPickerError(
      "The selected folder is no longer available. Select it again and keep this screen open while its files stage.",
      { cause },
    );
  }

  return createSelection(entries);
}
