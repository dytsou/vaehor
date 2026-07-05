import { useState, useCallback, useRef } from "react";
import { useAppStore } from "@/lib/store";
import { parseDroppedItems, FileEntry } from "@/lib/fileParser";
import { useTranslations } from "next-intl";
import { runChunkedFileUpload } from "@/hooks/chunked-file-upload";
import { useNativeUpload } from "@/hooks/use-native-upload";

interface UseUploadProps {
  currentFolderId: string;
  isAdmin: boolean;
  triggerRefresh: () => void;
}

const MAX_CONCURRENT_UPLOADS = 3;

export function useUpload({
  currentFolderId,
  isAdmin,
  triggerRefresh,
}: UseUploadProps) {
  const { uploads, updateUploadProgress, removeUpload, addToast } =
    useAppStore();
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const folderIdCache = useRef<Record<string, string>>({});
  const activeUploadsCount = useRef(0);
  const uploadQueue = useRef<(() => Promise<void>)[]>([]);
  const t = useTranslations("UploadModal");

  const nativeUpload = useNativeUpload({
    currentFolderId,
    triggerRefresh,
    onError: (message) => addToast({ message, type: "error" }),
  });

  const requestUpload = useCallback(() => {
    if (nativeUpload.isAvailable) {
      void nativeUpload.pickAndUpload();
      return;
    }
    setIsUploadModalOpen(true);
  }, [nativeUpload]);

  const processNextInQueue = useCallback(async () => {
    if (
      uploadQueue.current.length === 0 ||
      activeUploadsCount.current >= MAX_CONCURRENT_UPLOADS
    )
      return;

    const nextTask = uploadQueue.current.shift();
    if (nextTask) {
      activeUploadsCount.current++;
      try {
        await nextTask();
      } finally {
        activeUploadsCount.current--;
        processNextInQueue();
      }
    }
  }, []);

  const addToQueue = useCallback(
    (task: () => Promise<void>) => {
      uploadQueue.current.push(task);
      processNextInQueue();
    },
    [processNextInQueue],
  );

  const ensureFolderStructure = useCallback(
    async (path: string, rootId: string): Promise<string> => {
      const parts = path.split("/").filter(Boolean);
      parts.pop();
      if (parts.length === 0) return rootId;

      let currentParentId = rootId;
      let currentPath = "";

      for (const folderName of parts) {
        currentPath += (currentPath ? "/" : "") + folderName;

        if (folderIdCache.current[currentPath]) {
          currentParentId = folderIdCache.current[currentPath];
          continue;
        }

        try {
          const response = await fetch("/api/folder/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              folderName: folderName,
              parentId: currentParentId,
            }),
          });

          if (!response.ok) throw new Error(t("folderCreationFailed"));

          const data = await response.json();
          currentParentId = data.id;
          folderIdCache.current[currentPath] = data.id;
        } catch (error) {
          console.error(`Gagal membuat folder ${folderName}:`, error);
          throw error;
        }
      }

      return currentParentId;
    },
    [t],
  );

  const uploadFileChunked = useCallback(
    async (file: File, targetParentId: string) => {
      try {
        await runChunkedFileUpload(
          file,
          targetParentId,
          {
            initFailed: t("initFailed"),
            chunkFailed: t("chunkFailed"),
          },
          {
            onProgress: (percent, status, error) =>
              updateUploadProgress(file.name, percent, status, error),
            onComplete: triggerRefresh,
            onRemoveLater: () => removeUpload(file.name),
          },
        );
      } catch (error: unknown) {
        console.error(error);
        const errorMessage =
          error instanceof Error ? error.message : "Upload failed";
        updateUploadProgress(file.name, 0, "error", errorMessage);
        addToast({
          message: t("uploadError", { fileName: file.name }),
          type: "error",
        });
      }
    },
    [updateUploadProgress, removeUpload, addToast, t, triggerRefresh],
  );

  const processUploadQueue = useCallback(
    async (items: FileList | FileEntry[]) => {
      if (!currentFolderId) {
        addToast({
          message: t("destNotFound"),
          type: "error",
        });
        return;
      }
      if (!isAdmin) {
        addToast({
          message: t("accessDenied"),
          type: "error",
        });
        return;
      }

      folderIdCache.current = {};

      const fileList = Array.isArray(items)
        ? items
        : Array.from(items).map((f) => ({
            file: f,
            path: f.webkitRelativePath || f.name,
          }));

      for (const entry of fileList) {
        addToQueue(async () => {
          try {
            const targetId = await ensureFolderStructure(
              entry.path,
              currentFolderId,
            );
            await uploadFileChunked(entry.file, targetId);
          } catch (e) {
            console.error(
              "Skip file karena gagal create folder:",
              entry.path,
              e,
            );
          }
        });
      }
    },
    [
      currentFolderId,
      isAdmin,
      addToast,
      ensureFolderStructure,
      uploadFileChunked,
      addToQueue,
      t,
    ],
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processUploadQueue(e.target.files);
      e.target.value = "";
      setIsUploadModalOpen(false);
    }
  };

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isAdmin) setIsDragging(true);
    },
    [isAdmin],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDropUpload = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      if (isAdmin && e.dataTransfer) {
        const entries = await parseDroppedItems(e.dataTransfer);
        if (entries.length > 0) {
          processUploadQueue(entries);
        }
      }
    },
    [isAdmin, processUploadQueue],
  );

  return {
    uploads,
    isUploadModalOpen,
    isDragging,
    setIsUploadModalOpen,
    requestUpload,
    handleDragOver,
    handleDragLeave,
    handleDropUpload,
    handleFileSelect,
    droppedFiles: null,
  };
}
