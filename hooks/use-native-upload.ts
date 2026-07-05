"use client";

import { useCallback, useEffect } from "react";
import {
  getZeeMobileBridge,
  isZeeMobileBridgeAvailable,
  subscribeZeeMobileUploadComplete,
} from "@/lib/mobile-bridge";

export function useNativeUpload(options: {
  currentFolderId: string | null;
  triggerRefresh: () => void;
  onError?: (message: string) => void;
}) {
  const { currentFolderId, triggerRefresh, onError } = options;

  useEffect(() => {
    if (!isZeeMobileBridgeAvailable()) return;
    return subscribeZeeMobileUploadComplete(triggerRefresh);
  }, [triggerRefresh]);

  const pickAndUpload = useCallback(async (): Promise<boolean> => {
    const bridge = getZeeMobileBridge();
    if (!bridge || !currentFolderId) return false;

    try {
      await bridge.pickAndUpload({ parentId: currentFolderId });
      return true;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Native upload failed";
      onError?.(message);
      return true;
    }
  }, [currentFolderId, onError]);

  return {
    isAvailable: isZeeMobileBridgeAvailable(),
    pickAndUpload,
  };
}

export async function pickAndUploadViaNativeBridge(
  parentId: string,
): Promise<boolean> {
  const bridge = getZeeMobileBridge();
  if (!bridge) return false;
  await bridge.pickAndUpload({ parentId });
  return true;
}
