import { FilePicker } from "@capawesome/capacitor-file-picker";
import {
  ZEE_MOBILE_MESSAGE,
  type ZeeMobileMessage,
  type ZeeMobilePickUploadRequest,
} from "../lib/mobile-bridge-protocol";
import { createServerFetch } from "../lib/api-client";
import {
  decodeBase64File,
  runNativeChunkedUpload,
  UploadAuthError,
  type NativeUploadFile,
  type NativeUploadProgress,
} from "../lib/upload-bridge";

export type UploadBridgeHandlers = {
  origin: string;
  sessionToken: string;
  iframe: HTMLIFrameElement;
  onProgress: (progress: NativeUploadProgress) => void;
  onLogout?: () => void;
};

function postToFrame(
  iframe: HTMLIFrameElement,
  message: ZeeMobileMessage,
): void {
  iframe.contentWindow?.postMessage(message, "*");
}

async function pickNativeFiles(): Promise<NativeUploadFile[]> {
  const result = await FilePicker.pickFiles({ readData: true, limit: 0 });
  return result.files
    .filter((file) => file.name && file.data)
    .map((file) => ({
      name: file.name,
      mimeType: file.mimeType ?? "application/octet-stream",
      bytes: decodeBase64File(file.data!),
    }));
}

async function handlePickAndUpload(
  request: ZeeMobilePickUploadRequest,
  handlers: UploadBridgeHandlers,
): Promise<void> {
  const fetchImpl = createServerFetch(handlers.origin, handlers.sessionToken);
  const files = await pickNativeFiles();

  for (const file of files) {
    handlers.onProgress({
      fileName: file.name,
      percent: 0,
      status: "uploading",
    });

    try {
      await runNativeChunkedUpload({
        fetchImpl,
        file,
        parentId: request.parentId,
        onProgress: (percent) => {
          handlers.onProgress({
            fileName: file.name,
            percent,
            status: "uploading",
          });
          postToFrame(handlers.iframe, {
            type: ZEE_MOBILE_MESSAGE,
            action: "upload/progress",
            requestId: request.requestId,
            fileName: file.name,
            percent,
          });
        },
      });

      handlers.onProgress({
        fileName: file.name,
        percent: 100,
        status: "success",
      });
    } catch (error) {
      const errorMessage =
        error instanceof UploadAuthError
          ? "Session expired"
          : error instanceof Error
            ? error.message
            : "Upload failed";
      handlers.onProgress({
        fileName: file.name,
        percent: 0,
        status: "error",
        errorMessage,
      });
      throw error;
    }
  }
}

export function attachUploadBridge(handlers: UploadBridgeHandlers): () => void {
  const onMessage = (event: MessageEvent) => {
    if (event.source !== handlers.iframe.contentWindow) return;
    const data = event.data as ZeeMobileMessage | undefined;
    if (!data || data.type !== ZEE_MOBILE_MESSAGE) return;

    if (data.action === "upload/pick") {
      void handlePickAndUpload(data, handlers)
        .then(() => {
          postToFrame(handlers.iframe, {
            type: ZEE_MOBILE_MESSAGE,
            action: "upload/pick-done",
            requestId: data.requestId,
          });
        })
        .catch((error: unknown) => {
          postToFrame(handlers.iframe, {
            type: ZEE_MOBILE_MESSAGE,
            action: "upload/pick-error",
            requestId: data.requestId,
            error:
              error instanceof Error ? error.message : "Native upload failed",
          });
        });
    }
  };

  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
