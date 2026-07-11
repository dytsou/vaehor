"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter, usePathname } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useAppStore } from "@/lib/store";
import { useScrollLock } from "@/hooks/useScrollLock";
import type { DriveFile } from "@/lib/drive";
import { getErrorMessage } from "@/lib/errors";
import type {
  FlatTree,
  FolderNode,
  ManualDrive,
  TreeContextType,
} from "./types";
import {
  applyToggleLoadResultToTree,
  collectLoadedFolderIdsToResync,
  fetchChildrenForFolders,
  mergeResyncResultsIntoTree,
  runSidebarTreeExpandPath,
} from "./sidebar-tree-utils";

interface FolderContentsResponse {
  files?: DriveFile[];
}

interface DropPayload {
  type?: string;
  files?: Array<Pick<DriveFile, "id">>;
  sourceFolderId?: string;
}

function parseEnvManualDrives(envValue: string): ManualDrive[] {
  return envValue.split(",").reduce<ManualDrive[]>((accumulator, entry) => {
    const [id, name] = entry.split(":");
    if (!id || !id.trim()) {
      return accumulator;
    }

    accumulator.push({
      id: id.trim(),
      name: name?.trim() || id.trim(),
      isProtected: false,
    });

    return accumulator;
  }, []);
}

/** Walk from folderId toward root; return first bearer in folderTokens on the path. */
function resolveFolderBearer(
  folderId: string,
  tree: FlatTree,
  folderTokens: Record<string, string>,
): string | undefined {
  let id: string | null = folderId;
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const direct = folderTokens[id];
    if (direct) return direct;
    id = tree[id]?.parentId ?? null;
  }
  return undefined;
}

export function useSidebarController() {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const t = useTranslations("Sidebar");
  const locale = useLocale();

  const isSidebarOpen = useAppStore((state) => state.isSidebarOpen);
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen);
  const currentFolderId = useAppStore((state) => state.currentFolderId);
  const refreshKey = useAppStore((state) => state.refreshKey);
  const user = useAppStore((state) => state.user);
  const shareToken = useAppStore((state) => state.shareToken);
  const folderTokens = useAppStore((state) => state.folderTokens);
  const setNavigatingId = useAppStore((state) => state.setNavigatingId);
  const isAuthHealthy = useAppStore((state) => state.isGoogleAuthHealthy);
  const setAuthHealth = useAppStore((state) => state.setGoogleAuthHealth);

  const [mounted, setMounted] = useState(false);
  const [dbDrives, setDbDrives] = useState<ManualDrive[]>([]);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const touchStartRef = useRef<number | null>(null);

  const canEdit = user?.role === "ADMIN" || user?.role === "EDITOR";
  const rootFolderId = process.env.NEXT_PUBLIC_ROOT_FOLDER_ID!;
  const rootFolderName = process.env.NEXT_PUBLIC_ROOT_FOLDER_NAME || t("home");

  const [tree, setTree] = useState<FlatTree>({
    [rootFolderId]: {
      id: rootFolderId,
      name: rootFolderName,
      parentId: null,
      childIds: [],
      isExpanded: true,
      isFolder: true,
      hasLoaded: false,
      isProtected: false,
      isLoading: false,
    },
  });

  const treeRef = useRef(tree);

  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

  useEffect(() => {
    setTree((prev) => ({
      ...prev,
      [rootFolderId]: {
        ...prev[rootFolderId],
        name: rootFolderName,
      },
    }));
  }, [rootFolderId, rootFolderName]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setNavigatingId(null);
  }, [pathname, setNavigatingId]);

  useEffect(() => {
    const fetchAuthAndDrives = async () => {
      try {
        const [drivesRes, authRes] = await Promise.all([
          fetch("/api/manual-drives"),
          fetch("/api/auth/status"),
        ]);

        const authData = await authRes.json();

        if (authData.status !== "healthy") {
          setAuthHealth(false, authData.error || t("googleAuthError"));
          setTree({});
          setDbDrives([]);

          if (
            authData.status === "unhealthy" ||
            authData.status === "not_configured"
          ) {
            useAppStore.getState().addToast({
              message: authData.error || t("googleAuthError"),
              type: "error",
            });
          }
          return;
        }

        setAuthHealth(true);
        if (drivesRes.ok) {
          const data: ManualDrive[] = await drivesRes.json();
          setDbDrives(data);
        }
      } catch (error) {
        console.error("Error checking auth or drives:", error);
      }
    };

    if (mounted) {
      fetchAuthAndDrives();
    }
  }, [mounted, t, setAuthHealth]);

  const allManualDrives = useMemo<ManualDrive[]>(() => {
    if (!isAuthHealthy) return [];

    const envDrives = parseEnvManualDrives(
      process.env.NEXT_PUBLIC_MANUAL_DRIVES || "",
    );
    const dbIds = new Set(dbDrives.map((drive) => drive.id));
    const filteredEnvDrives = envDrives.filter((drive) => !dbIds.has(drive.id));
    return [...filteredEnvDrives, ...dbDrives];
  }, [dbDrives, isAuthHealthy]);

  useEffect(() => {
    const checkMobile = () => {
      const isMobileDevice = window.innerWidth < 1024;
      setIsMobile(isMobileDevice);
      if (isMobileDevice) {
        setSidebarOpen(false);
      }
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, [setSidebarOpen]);

  useScrollLock(isSidebarOpen && isMobile && !shareToken);

  const fetchSubfolders = useCallback(
    async (
      parentId: string,
      treeForBearer?: FlatTree,
    ): Promise<FolderNode[]> => {
      try {
        const treeSnapshot = treeForBearer ?? treeRef.current;
        const bearer = resolveFolderBearer(
          parentId,
          treeSnapshot,
          folderTokens,
        );

        const data = await queryClient.fetchQuery<FolderContentsResponse>({
          queryKey: ["folder-contents", parentId, shareToken, bearer],
          queryFn: async () => {
            const url = new URL(`${window.location.origin}/api/files`);
            url.searchParams.append("folderId", parentId);
            if (shareToken) {
              url.searchParams.append("share_token", shareToken);
            }

            const headers = new Headers();
            if (bearer) {
              headers.append("Authorization", `Bearer ${bearer}`);
            }

            const response = await fetch(url.toString(), { headers });
            if (response.status === 401 || response.status === 403) {
              return { files: [] };
            }
            if (!response.ok) {
              throw new Error("Failed to fetch");
            }
            return response.json();
          },
          staleTime: 60 * 1000,
        });

        return (data.files || []).map((file) => ({
          id: file.id,
          name: file.name,
          parentId,
          childIds: [],
          isExpanded: false,
          isLoading: false,
          isProtected: file.isProtected ?? false,
          isFolder: file.isFolder,
          hasLoaded: false,
        }));
      } catch (error) {
        console.error(error);
        return [];
      }
    },
    [queryClient, shareToken, folderTokens],
  );

  const toggleNode = useCallback(
    async (nodeId: string) => {
      const node = treeRef.current[nodeId];
      if (!node || !node.isFolder) {
        return;
      }

      const needsToLoad = node.childIds.length === 0 && !node.hasLoaded;
      if (!needsToLoad) {
        setTree((prev) => ({
          ...prev,
          [nodeId]: { ...prev[nodeId], isExpanded: !prev[nodeId].isExpanded },
        }));
        return;
      }

      setTree((prev) => ({
        ...prev,
        [nodeId]: { ...prev[nodeId], isLoading: true },
      }));

      const children = await fetchSubfolders(nodeId);
      setTree((prev) => applyToggleLoadResultToTree(prev, nodeId, children));
    },
    [fetchSubfolders],
  );

  useEffect(() => {
    if (refreshKey === 0 || !mounted || !isAuthHealthy) {
      return;
    }

    let cancelled = false;

    const resyncLoadedFolderNodes = async () => {
      const folderIds = collectLoadedFolderIdsToResync(
        treeRef.current,
        currentFolderId,
        rootFolderId,
      );
      const results = await fetchChildrenForFolders(folderIds, fetchSubfolders);

      if (cancelled) {
        return;
      }

      setTree((prev) => mergeResyncResultsIntoTree(prev, results));
    };

    resyncLoadedFolderNodes().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    refreshKey,
    mounted,
    isAuthHealthy,
    currentFolderId,
    rootFolderId,
    fetchSubfolders,
  ]);

  useEffect(() => {
    if (!mounted || !isAuthHealthy) {
      return;
    }

    runSidebarTreeExpandPath({
      currentFolderId,
      rootFolderId,
      shareToken,
      locale,
      queryClient,
      treeSnapshot: treeRef.current,
      fetchSubfolders,
      onExpand: setTree,
    }).catch(() => {});
  }, [
    currentFolderId,
    mounted,
    rootFolderId,
    fetchSubfolders,
    queryClient,
    shareToken,
    locale,
    isAuthHealthy,
  ]);

  const handleTouchStart = (event: React.TouchEvent) => {
    touchStartRef.current = event.targetTouches[0].clientX;
  };

  const handleTouchEnd = (event: React.TouchEvent) => {
    if (!touchStartRef.current) {
      return;
    }

    const touchEnd = event.changedTouches[0].clientX;
    if (touchStartRef.current - touchEnd > 50) {
      setSidebarOpen(false);
    }
    touchStartRef.current = null;
  };

  const onNavigate = useCallback(
    (nodeId: string) => {
      const node = treeRef.current[nodeId];
      if (!node) {
        return;
      }

      let url = "";
      if (node.isFolder) {
        url = node.id === rootFolderId ? "/" : `/folder/${node.id}`;
        if (!node.isExpanded) {
          toggleNode(node.id);
        }
      } else {
        url = `/findpath?id=${node.id}`;
      }

      setNavigatingId(node.id);
      router.push(url);
      if (window.innerWidth < 1024) {
        setSidebarOpen(false);
      }
    },
    [router, rootFolderId, setNavigatingId, setSidebarOpen, toggleNode],
  );

  const onDrop = useCallback(
    (event: React.DragEvent, targetFolderId: string) => {
      event.preventDefault();
      event.stopPropagation();
      setDragOverFolderId(null);

      let data: DropPayload;
      try {
        data = JSON.parse(
          event.dataTransfer.getData("application/json"),
        ) as DropPayload;
      } catch {
        return;
      }

      const handleDropMove = async (
        filesToMove: Array<Pick<DriveFile, "id">>,
        newParentId: string,
      ) => {
        try {
          const response = await fetch("/api/files/bulk-move", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fileIds: filesToMove.map((file) => file.id),
              newParentId,
            }),
          });
          const result = await response.json();
          if (!response.ok) {
            throw new Error(result.error || "Gagal memindahkan item.");
          }

          useAppStore.getState().addToast({
            message: result.message || "Item berhasil dipindahkan",
            type: "success",
          });
          useAppStore.getState().triggerRefresh();
        } catch (error: unknown) {
          useAppStore.getState().addToast({
            message: getErrorMessage(error, "Gagal memindahkan item."),
            type: "error",
          });
        }
      };

      if (data.type !== "files" || !data.files) {
        return;
      }
      if (data.sourceFolderId === targetFolderId) {
        return;
      }

      handleDropMove(data.files, targetFolderId);
    },
    [],
  );

  const treeContextValue = useMemo<TreeContextType>(
    () => ({
      tree: isAuthHealthy ? tree : {},
      onToggle: toggleNode,
      onNavigate,
      onDrop,
      setDragOverFolderId,
      dragOverFolderId,
      canEdit,
      rootFolderId,
    }),
    [
      tree,
      toggleNode,
      onNavigate,
      onDrop,
      dragOverFolderId,
      canEdit,
      rootFolderId,
      isAuthHealthy,
    ],
  );

  return {
    mounted,
    shareToken,
    isSidebarOpen,
    setSidebarOpen,
    isMobile,
    allManualDrives,
    rootFolderId,
    treeContextValue,
    handleTouchStart,
    handleTouchEnd,
  };
}
