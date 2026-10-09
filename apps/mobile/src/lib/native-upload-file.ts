import * as DocumentPicker from "expo-document-picker";
import { File as ExpoFile, FileMode, Paths } from "expo-file-system";
import type { NativeUploadFile } from "./upload-bridge";

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
  const handle = new ExpoFile(asset.uri).open(FileMode.ReadOnly);
  const size = handle.size ?? asset.size;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
    handle.close();
    throw new Error("This device could not read the selected file size.");
  }

  let closed = false;
  return {
    name: fileName,
    mimeType: asset.mimeType ?? "application/octet-stream",
    size,
    readChunk: async (start, end, signal) => {
      if (signal?.aborted) throw new Error("Upload cancelled");
      if (closed) throw new Error("The selected file is no longer available.");
      handle.offset = start;
      const bytes = await handle.readBytes(end - start);
      return bytes;
    },
    close: () => {
      if (closed) return;
      closed = true;
      handle.close();
    },
  };
}
