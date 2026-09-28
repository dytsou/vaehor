import * as DocumentPicker from "expo-document-picker";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
  clearLocalStorageAccessTokenForServer,
  clearSessionForServer,
} from "../../lib/session-store";
import {
  runNativeChunkedUpload,
  UploadAuthError,
  UploadHttpError,
  UploadLocalStorageAuthError,
  type NativeUploadProgress,
  type ServerFetch,
} from "../../lib/upload-bridge";
import {
  deletePickedCacheFile,
  openDocumentPickerUploadFile,
} from "../../lib/native-upload-file";
import { sanitizeFileName } from "../../lib/file-api";

export type UploadApiSession = {
  origin: string;
  token: string;
  fetchImpl: ServerFetch;
};

export type UploadJob = NativeUploadProgress & { id: string };

type UseNativeUploadQueueOptions = {
  apiRef: MutableRefObject<UploadApiSession | null>;
  localStorageAccessTokenRef: MutableRefObject<string | null>;
  activeFolder: string;
  activeQuery: string;
  fetchForFolder: (folderId: string) => ServerFetch | null;
  loadContents: (folderId: string, query: string) => Promise<void>;
  setWorking: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  onLocalAuthRequired: () => void;
  onSessionExpired: () => void;
};

export function useNativeUploadQueue({
  apiRef,
  localStorageAccessTokenRef,
  activeFolder,
  activeQuery,
  fetchForFolder,
  loadContents,
  setWorking,
  setError,
  onLocalAuthRequired,
  onSessionExpired,
}: UseNativeUploadQueueOptions) {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const uploadControllerRef = useRef<AbortController | null>(null);
  const retryAssetsRef = useRef(
    new Map<string, DocumentPicker.DocumentPickerAsset>(),
  );
  const jobSequenceRef = useRef(0);
  const activeJob = jobs.some((job) => job.status === "uploading");

  const uploadAssets = useCallback(
    async (
      items: { id: string; asset: DocumentPicker.DocumentPickerAsset }[],
      destinationId: string,
    ) => {
      const api = apiRef.current;
      if (!api || !destinationId || uploadControllerRef.current) return;
      const controller = new AbortController();
      uploadControllerRef.current = controller;
      setWorking(true);
      setError(null);

      try {
        for (const { id, asset } of items) {
          if (controller.signal.aborted) break;
          retryAssetsRef.current.set(id, asset);
          setJobs((current) => [
            ...current.filter((job) => job.id !== id),
            { id, fileName: asset.name, percent: 0, status: "uploading" },
          ]);

          try {
            await runNativeChunkedUpload({
              fetchImpl: fetchForFolder(destinationId) ?? api.fetchImpl,
              parentId: destinationId,
              file: openDocumentPickerUploadFile(
                asset,
                sanitizeFileName(asset.name),
              ),
              signal: controller.signal,
              onProgress: (percent) => {
                setJobs((current) =>
                  current.map((job) =>
                    job.id === id
                      ? { ...job, percent, status: "uploading" }
                      : job,
                  ),
                );
              },
            });
            retryAssetsRef.current.delete(id);
            deletePickedCacheFile(asset.uri);
            setJobs((current) =>
              current.map((job) =>
                job.id === id
                  ? { ...job, percent: 100, status: "success" }
                  : job,
              ),
            );
          } catch (cause) {
            const message = uploadErrorMessage(
              cause,
              controller.signal.aborted,
            );
            setJobs((current) =>
              current.map((job) =>
                job.id === id
                  ? { ...job, status: "error", errorMessage: message }
                  : job,
              ),
            );
            if (cause instanceof UploadLocalStorageAuthError) {
              localStorageAccessTokenRef.current = null;
              onLocalAuthRequired();
              await clearLocalStorageAccessTokenForServer(api.origin);
              break;
            }
            if (cause instanceof UploadAuthError) {
              await clearSessionForServer(api.origin);
              await clearLocalStorageAccessTokenForServer(api.origin);
              localStorageAccessTokenRef.current = null;
              apiRef.current = null;
              onSessionExpired();
              break;
            }
            if (controller.signal.aborted) break;
          }
        }

        if (!controller.signal.aborted)
          void loadContents(destinationId, activeQuery);
      } finally {
        if (uploadControllerRef.current === controller) {
          uploadControllerRef.current = null;
          setWorking(false);
        }
      }
    },
    [
      activeQuery,
      apiRef,
      fetchForFolder,
      loadContents,
      localStorageAccessTokenRef,
      onLocalAuthRequired,
      onSessionExpired,
      setError,
      setWorking,
    ],
  );

  const handlePickFiles = useCallback(async () => {
    if (!apiRef.current || !activeFolder) return;
    if (
      activeFolder.startsWith("local-storage:") &&
      !localStorageAccessTokenRef.current
    ) {
      onLocalAuthRequired();
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const items = result.assets.map((asset) => ({
        id: `upload-${Date.now()}-${jobSequenceRef.current++}`,
        asset,
      }));
      await uploadAssets(items, activeFolder);
    } catch {
      setError(
        "The file picker could not open. Check the device's file access and retry.",
      );
    }
  }, [
    activeFolder,
    apiRef,
    localStorageAccessTokenRef,
    onLocalAuthRequired,
    setError,
    uploadAssets,
  ]);

  const retryUpload = useCallback(
    (id: string) => {
      const asset = retryAssetsRef.current.get(id);
      if (!asset) {
        setError("Choose the file again to retry this upload.");
        return;
      }
      void uploadAssets([{ id, asset }], activeFolder);
    },
    [activeFolder, setError, uploadAssets],
  );

  const cancelUpload = useCallback(() => {
    uploadControllerRef.current?.abort();
  }, []);

  useEffect(
    () => () => {
      uploadControllerRef.current?.abort();
      uploadControllerRef.current = null;
    },
    [],
  );

  return { jobs, activeJob, handlePickFiles, retryUpload, cancelUpload };
}

function uploadErrorMessage(cause: unknown, cancelled: boolean): string {
  if (
    cancelled ||
    (cause instanceof Error && cause.message === "Upload cancelled")
  ) {
    return "Upload cancelled. Choose the file again to retry.";
  }
  if (cause instanceof UploadAuthError)
    return "Sign-in expired or upload permission was denied.";
  if (cause instanceof UploadHttpError) {
    if (cause.status === 413)
      return "This file is larger than the server allows.";
    if (cause.status === 409)
      return "A file with this name may already exist in the destination.";
    if (cause.status === 403)
      return "You do not have permission to upload here.";
  }
  return "Upload failed. Check your connection and retry.";
}
