export const ZEE_MOBILE_MESSAGE = "zee-mobile";

export type ZeeMobilePickUploadRequest = {
  type: typeof ZEE_MOBILE_MESSAGE;
  action: "upload/pick";
  requestId: string;
  parentId: string;
};

export type ZeeMobileUploadProgressMessage = {
  type: typeof ZEE_MOBILE_MESSAGE;
  action: "upload/progress";
  requestId: string;
  fileName: string;
  percent: number;
};

export type ZeeMobilePickDoneMessage = {
  type: typeof ZEE_MOBILE_MESSAGE;
  action: "upload/pick-done";
  requestId: string;
};

export type ZeeMobilePickErrorMessage = {
  type: typeof ZEE_MOBILE_MESSAGE;
  action: "upload/pick-error";
  requestId: string;
  error: string;
};

export type ZeeMobileLogoutMessage = {
  type: typeof ZEE_MOBILE_MESSAGE;
  action: "logout";
};

export type ZeeMobileMessage =
  | ZeeMobilePickUploadRequest
  | ZeeMobileUploadProgressMessage
  | ZeeMobilePickDoneMessage
  | ZeeMobilePickErrorMessage
  | ZeeMobileLogoutMessage;

export interface ZeeMobileBridge {
  isAvailable(): boolean;
  pickAndUpload(options: { parentId: string }): Promise<void>;
}

declare global {
  interface Window {
    ZeeMobile?: ZeeMobileBridge;
  }
}

function isEmbeddedInNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.parent !== window && window.parent != null;
  } catch {
    return false;
  }
}

export function isZeeMobileBridgeAvailable(): boolean {
  if (typeof window === "undefined") return false;
  if (window.ZeeMobile?.isAvailable()) return true;
  return isEmbeddedInNativeShell();
}

/**
 * Origin of the native shell that embeds this page, so messages aren't
 * broadcast to arbitrary frames. ancestorOrigins is available on the mobile
 * WebViews we target (Android Blink, iOS WebKit); referrer is the fallback.
 * ponytail: last-resort "*" only when the embedder origin is undiscoverable
 * (very old engines) — the shell still validates message source and type.
 */
function parentOrigin(): string {
  const ancestor = window.location.ancestorOrigins?.[0];
  if (ancestor) return ancestor;
  if (document.referrer) {
    try {
      return new URL(document.referrer).origin;
    } catch {
      /* fall through */
    }
  }
  return "*";
}

function postToParent(message: ZeeMobileMessage): void {
  window.parent.postMessage(message, parentOrigin());
}

/** Notify the native shell to wipe stored session (WebView sign-out). */
export function notifyZeeMobileLogout(): void {
  if (!isEmbeddedInNativeShell()) return;
  postToParent({ type: ZEE_MOBILE_MESSAGE, action: "logout" });
}

export function createZeeMobileBridge(): ZeeMobileBridge {
  return {
    isAvailable: () => isZeeMobileBridgeAvailable(),
    pickAndUpload({ parentId }) {
      const requestId = crypto.randomUUID();
      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error("Native upload timed out"));
        }, 600_000);

        const handler = (event: MessageEvent) => {
          const data = event.data as ZeeMobileMessage | undefined;
          if (data?.type !== ZEE_MOBILE_MESSAGE) return;
          if (data.requestId !== requestId) return;

          if (data.action === "upload/pick-done") {
            cleanup();
            resolve();
          }
          if (data.action === "upload/pick-error") {
            cleanup();
            reject(new Error(data.error || "Native upload failed"));
          }
        };

        const cleanup = () => {
          clearTimeout(timeout);
          window.removeEventListener("message", handler);
        };

        window.addEventListener("message", handler);
        postToParent({
          type: ZEE_MOBILE_MESSAGE,
          action: "upload/pick",
          requestId,
          parentId,
        });
      });
    },
  };
}

export function installZeeMobileBridge(): void {
  if (typeof window === "undefined") return;
  if (window.ZeeMobile) return;
  if (!isEmbeddedInNativeShell()) return;
  window.ZeeMobile = createZeeMobileBridge();
}

export function getZeeMobileBridge(): ZeeMobileBridge | null {
  if (typeof window === "undefined") return null;
  if (window.ZeeMobile) return window.ZeeMobile;
  if (!isEmbeddedInNativeShell()) return null;
  installZeeMobileBridge();
  return window.ZeeMobile ?? null;
}

export function subscribeZeeMobileUploadComplete(
  onComplete: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const handler = (event: MessageEvent) => {
    const data = event.data as ZeeMobileMessage | undefined;
    if (data?.type !== ZEE_MOBILE_MESSAGE) return;
    if (data.action === "upload/pick-done") onComplete();
  };

  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}

if (typeof window !== "undefined") {
  installZeeMobileBridge();
}
