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

type UploadFailureOptions = Readonly<{
  id: string;
  cause: unknown;
  signal: AbortSignal;
  api: UploadApiSession;
  localStorageAccessTokenRef: MutableRefObject<string | null>;
  apiRef: MutableRefObject<UploadApiSession | null>;
  setJobs: Dispatch<SetStateAction<UploadJob[]>>;
  onLocalAuthRequired: () => void;
  onSessionExpired: () => void;
}>;

async function handleUploadFailure({
  id,
  cause,
  signal,
  api,
  localStorageAccessTokenRef,
  apiRef,
  setJobs,
  onLocalAuthRequired,
  onSessionExpired,
}: UploadFailureOptions): Promise<boolean> {
  const message = uploadErrorMessage(cause, signal.aborted);
  setJobs((current) =>
    current.map((job) =>
      job.id === id ? { ...job, status: "error", errorMessage: message } : job,
    ),
  );
  if (cause instanceof UploadLocalStorageAuthError) {
    localStorageAccessTokenRef.current = null;
    onLocalAuthRequired();
    await clearLocalStorageAccessTokenForServer(api.origin);
    return true;
  }
  if (cause instanceof UploadAuthError) {
    await clearSessionForServer(api.origin);
    await clearLocalStorageAccessTokenForServer(api.origin);
    localStorageAccessTokenRef.current = null;
    apiRef.current = null;
    onSessionExpired();
    return true;
  }
  return signal.aborted;
}

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

type UploadAssetsOptions = Readonly<{
  api: UploadApiSession;
  apiRef: MutableRefObject<UploadApiSession | null>;
  localStorageAccessTokenRef: MutableRefObject<string | null>;
  items: { id: string; asset: DocumentPicker.DocumentPickerAsset }[];
  destinationId: string;
  signal: AbortSignal;
  retryAssets: Map<string, DocumentPicker.DocumentPickerAsset>;
  fetchForFolder: (folderId: string) => ServerFetch | null;
  setJobs: Dispatch<SetStateAction<UploadJob[]>>;
  onLocalAuthRequired: () => void;
  onSessionExpired: () => void;
}>;

function updateUploadJob(
  setJobs: Dispatch<SetStateAction<UploadJob[]>>,
  id: string,
  update: (job: UploadJob) => UploadJob,
): void {
  setJobs((current) =>
    current.map((job) => (job.id === id ? update(job) : job)),
  );
}

async function uploadQueueItem(
  options: UploadAssetsOptions,
  item: { id: string; asset: DocumentPicker.DocumentPickerAsset },
): Promise<boolean> {
  const { id, asset } = item;
  try {
    await runNativeChunkedUpload({
      fetchImpl:
        options.fetchForFolder(options.destinationId) ?? options.api.fetchImpl,
      parentId: options.destinationId,
      file: openDocumentPickerUploadFile(asset, sanitizeFileName(asset.name)),
      signal: options.signal,
      onProgress: (percent) =>
        updateUploadJob(options.setJobs, id, (job) => ({
          ...job,
          percent,
          status: "uploading",
        })),
    });
    options.retryAssets.delete(id);
    deletePickedCacheFile(asset.uri);
    updateUploadJob(options.setJobs, id, (job) => ({
      ...job,
      percent: 100,
      status: "success",
    }));
    return false;
  } catch (cause) {
    return handleUploadFailure({
      id,
      cause,
      signal: options.signal,
      api: options.api,
      localStorageAccessTokenRef: options.localStorageAccessTokenRef,
      apiRef: options.apiRef,
      setJobs: options.setJobs,
      onLocalAuthRequired: options.onLocalAuthRequired,
      onSessionExpired: options.onSessionExpired,
    });
  }
}

async function processUploadAssets(
  options: UploadAssetsOptions,
): Promise<void> {
  for (const item of options.items) {
    if (options.signal.aborted) break;
    options.retryAssets.set(item.id, item.asset);
    options.setJobs((current) => [
      ...current.filter((job) => job.id !== item.id),
      {
        id: item.id,
        fileName: item.asset.name,
        percent: 0,
        status: "uploading",
      },
    ]);
    if (await uploadQueueItem(options, item)) break;
  }
}

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
        await processUploadAssets({
          api,
          apiRef,
          localStorageAccessTokenRef,
          items,
          destinationId,
          signal: controller.signal,
          retryAssets: retryAssetsRef.current,
          fetchForFolder,
          setJobs,
          onLocalAuthRequired,
          onSessionExpired,
        });

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
