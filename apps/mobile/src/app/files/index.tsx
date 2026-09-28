import { useFocusEffect, useRouter } from "expo-router";
import { File as ExpoFile } from "expo-file-system";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  clearSessionForServer,
  clearLocalStorageAccessTokenForServer,
  loadLocalStorageAccessTokenForServer,
  saveLocalStorageAccessTokenForServer,
} from "../../lib/session-store";
import {
  getActiveServer,
  preferencesStore,
  type ServerBookmark,
} from "../../lib/servers";
import { loadBiometricServerSession } from "../../lib/biometric-session";
import { createServerFetch } from "../../lib/api-client";
import { FileDetailsPanel } from "./file-details-panel";
import { styles } from "./styles";
import { createAsyncRequestEpoch } from "../../lib/async-request-epoch";
import {
  addMobileTag,
  downloadMobileArchive,
  downloadMobileFile,
  deleteManagedMobileFile,
  deleteMobileFiles,
  getMobileFavoriteIds,
  getMobileFileDetails,
  listMobilePinnedFolders,
  listMobileTags,
  listMobileFavorites,
  listMobileDrives,
  listMobileFiles,
  MobileApiError,
  searchMobileFiles,
  moveMobileFiles,
  removeMobileTag,
  setMobileFolderPinned,
  setMobileFavorite,
  unlockMobileLocalStorage,
  type MobileFile,
} from "../../lib/file-api";
import { type ServerFetch } from "../../lib/upload-bridge";
import type { MobilePinnedFolder } from "@vaehor/sdk";
import { getNativePreviewKind } from "../../lib/preview";
import { useMobilePreferences } from "../../lib/mobile-preferences";
import {
  findExternalSubtitleFiles,
  type SubtitleFile,
} from "../../lib/subtitles";
import {
  useNativeUploadQueue,
  type UploadApiSession,
} from "./use-native-upload-queue";
import { UploadJobsPanel } from "./upload-jobs-panel";

type Crumb = { id: string; name: string };
type FolderAuthTarget = { id: string; name: string };

const MAX_TEXT_PREVIEW_BYTES = 512 * 1024;

export default function FilesRoute() {
  const router = useRouter();
  const { theme } = useMobilePreferences();
  const colors = themeColors(theme === "dark");
  const [server, setServer] = useState<ServerBookmark | null>(null);
  const [drives, setDrives] = useState<
    { id: string; name: string; isProtected: boolean }[]
  >([]);
  const [rootFolderId, setRootFolderId] = useState("");
  const [folderId, setFolderId] = useState("");
  const [breadcrumbs, setBreadcrumbs] = useState<Crumb[]>([]);
  const [files, setFiles] = useState<MobileFile[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set());
  const [pinnedFolders, setPinnedFolders] = useState<MobilePinnedFolder[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [favoritesLoaded, setFavoritesLoaded] = useState(false);
  const [showingFavorites, setShowingFavorites] = useState(false);
  const [userRole, setUserRole] = useState("user");
  const [moveTarget, setMoveTarget] = useState<MobileFile | null>(null);
  const [moveFileIds, setMoveFileIds] = useState<string[]>([]);
  const [moveFolderId, setMoveFolderId] = useState("");
  const [moveBreadcrumbs, setMoveBreadcrumbs] = useState<Crumb[]>([]);
  const [moveFolders, setMoveFolders] = useState<MobileFile[]>([]);
  const [moveLoading, setMoveLoading] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [searchInput, setSearchInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [selectedFile, setSelectedFile] = useState<MobileFile | null>(null);
  const [fileDetails, setFileDetails] = useState<MobileFile | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [tagsLoading, setTagsLoading] = useState(false);
  const [downloadedUri, setDownloadedUri] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [subtitleFiles, setSubtitleFiles] = useState<SubtitleFile[]>([]);
  const [downloadPercent, setDownloadPercent] = useState<number | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [apiReady, setApiReady] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [folderTokens, setFolderTokens] = useState<Record<string, string>>({});
  const [localAuthNeeded, setLocalAuthNeeded] = useState(false);
  const [localPassword, setLocalPassword] = useState("");
  const [localAuthWorking, setLocalAuthWorking] = useState(false);
  const [folderAuthTarget, setFolderAuthTarget] =
    useState<FolderAuthTarget | null>(null);
  const [folderAuthId, setFolderAuthId] = useState("");
  const [folderPassword, setFolderPassword] = useState("");
  const [folderAuthWorking, setFolderAuthWorking] = useState(false);
  const apiRef = useRef<UploadApiSession | null>(null);
  const folderTokensRef = useRef<Record<string, string>>({});
  const localStorageAccessTokenRef = useRef<string | null>(null);
  const listControllerRef = useRef<AbortController | null>(null);
  const downloadControllerRef = useRef<AbortController | null>(null);
  const moveFolderControllerRef = useRef<AbortController | null>(null);
  const listRequestEpochRef = useRef(createAsyncRequestEpoch());
  const downloadRequestEpochRef = useRef(createAsyncRequestEpoch());
  const moveFolderRequestEpochRef = useRef(createAsyncRequestEpoch());
  const selectedFileIdRef = useRef<string | null>(null);

  const currentFolderName = breadcrumbs.at(-1)?.name ?? "Files";
  const activeFolder = folderId || rootFolderId;
  const selectedDetails = fileDetails ?? selectedFile;
  const previewKind = selectedDetails
    ? getNativePreviewKind(selectedDetails.mimeType, selectedDetails.name ?? "")
    : "unsupported";
  const currentServerName = server?.label ?? "Server";
  const currentFolderIsPinned = pinnedFolders.some(
    (folder) => folder.id === activeFolder,
  );
  const currentFolderAccessToken = [...breadcrumbs]
    .reverse()
    .map((crumb) => folderTokens[crumb.id])
    .find(Boolean);

  const cancelPendingListRequest = useCallback(() => {
    listRequestEpochRef.current.invalidate();
    listControllerRef.current?.abort();
    listControllerRef.current = null;
    setLoadingFiles(false);
    setLoadingMore(false);
  }, []);

  const invalidateDownload = useCallback(() => {
    downloadRequestEpochRef.current.invalidate();
    downloadControllerRef.current?.abort();
  }, []);

  const cancelPendingMoveFolderRequest = useCallback(() => {
    moveFolderRequestEpochRef.current.invalidate();
    moveFolderControllerRef.current?.abort();
    moveFolderControllerRef.current = null;
    setMoveLoading(false);
  }, []);

  const showAuthFailure = useCallback(
    async (cause: unknown) => {
      if (
        cause instanceof MobileApiError &&
        cause.status === 401 &&
        !cause.access.protected &&
        !cause.access.isLocalAuthNeeded &&
        server
      ) {
        apiRef.current = null;
        setApiReady(false);
        await clearSessionForServer(server.url);
        await clearLocalStorageAccessTokenForServer(server.url);
        localStorageAccessTokenRef.current = null;
        setLocalAuthNeeded(false);
        setError(
          "Your sign-in has expired. Return to the server screen to sign in again.",
        );
        router.replace("/");
        return true;
      }
      return false;
    },
    [router, server],
  );

  const fetchForFolder = useCallback(
    (targetFolderId: string): ServerFetch | null => {
      const api = apiRef.current;
      if (!api) return null;
      const folderToken =
        folderTokensRef.current[targetFolderId] ??
        [...breadcrumbs]
          .reverse()
          .map((crumb) => folderTokensRef.current[crumb.id])
          .find(Boolean);
      const localToken = targetFolderId.startsWith("local-storage:")
        ? localStorageAccessTokenRef.current
        : null;
      if (!folderToken && !localToken) return api.fetchImpl;
      return (path, init = {}) => {
        const headers = new Headers(init.headers);
        if (folderToken) headers.set("X-Folder-Access-Token", folderToken);
        if (localToken) headers.set("X-Local-Storage-Token", localToken);
        return api.fetchImpl(path, { ...init, headers });
      };
    },
    [breadcrumbs],
  );

  const loadContents = useCallback(
    async (targetFolderId: string, query: string, pageToken?: string) => {
      const api = apiRef.current;
      if (!api || !targetFolderId) return;
      const folderFetch = fetchForFolder(targetFolderId) ?? api.fetchImpl;

      cancelPendingListRequest();
      const requestEpoch = listRequestEpochRef.current.begin();
      const controller = new AbortController();
      listControllerRef.current = controller;
      setError(null);
      if (pageToken) setLoadingMore(true);
      else {
        setFiles([]);
        setNextPageToken(undefined);
        setLoadingFiles(true);
      }

      try {
        const response = query.trim()
          ? await searchMobileFiles(
              folderFetch,
              { q: query.trim(), folderId: targetFolderId },
              controller.signal,
            )
          : await listMobileFiles(
              folderFetch,
              { folderId: targetFolderId, pageToken },
              controller.signal,
            );
        if (
          controller.signal.aborted ||
          !listRequestEpochRef.current.isCurrent(requestEpoch)
        )
          return;
        setFiles((current) =>
          pageToken
            ? [...current, ...(response.files ?? [])]
            : (response.files ?? []),
        );
        setNextPageToken(response.nextPageToken);
        setSelectedFile(null);
        setFileDetails(null);
        setDownloadedUri(null);
        setFileError(null);
      } catch (cause) {
        if (
          controller.signal.aborted ||
          !listRequestEpochRef.current.isCurrent(requestEpoch)
        )
          return;
        if (cause instanceof MobileApiError && cause.access.isLocalAuthNeeded) {
          localStorageAccessTokenRef.current = null;
          setLocalAuthNeeded(true);
          setLocalPassword("");
          setFiles([]);
          setError(null);
          if (api) await clearLocalStorageAccessTokenForServer(api.origin);
          return;
        }
        if (cause instanceof MobileApiError && cause.access.protected) {
          setFiles([]);
          setFolderAuthTarget({
            id: cause.access.folderId ?? targetFolderId,
            name: breadcrumbs.at(-1)?.name ?? "Protected folder",
          });
          setFolderPassword("");
          return;
        }
        if (!(await showAuthFailure(cause))) {
          if (
            controller.signal.aborted ||
            !listRequestEpochRef.current.isCurrent(requestEpoch)
          )
            return;
          setError(
            cause instanceof MobileApiError
              ? cause.message
              : "Could not load this folder. Check your connection and retry.",
          );
        }
      } finally {
        if (
          listControllerRef.current === controller &&
          listRequestEpochRef.current.isCurrent(requestEpoch)
        ) {
          listControllerRef.current = null;
          setLoadingFiles(false);
          setLoadingMore(false);
        }
      }
    },
    [breadcrumbs, cancelPendingListRequest, fetchForFolder, showAuthFailure],
  );

  const handleLocalUploadAuthRequired = useCallback(() => {
    setLocalAuthNeeded(true);
    setLocalPassword("");
  }, []);
  const handleUploadSessionExpired = useCallback(() => {
    setApiReady(false);
    router.replace("/");
  }, [router]);
  const uploadQueue = useNativeUploadQueue({
    apiRef,
    localStorageAccessTokenRef,
    activeFolder,
    activeQuery,
    fetchForFolder,
    loadContents,
    setWorking,
    setError,
    onLocalAuthRequired: handleLocalUploadAuthRequired,
    onSessionExpired: handleUploadSessionExpired,
  });
  const { jobs, activeJob } = uploadQueue;

  useEffect(() => {
    const fileId = selectedDetails?.id ?? null;
    if (selectedFileIdRef.current === fileId) return;
    selectedFileIdRef.current = fileId;
    invalidateDownload();
  }, [invalidateDownload, selectedDetails?.id]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const controller = new AbortController();
      apiRef.current = null;
      setApiReady(false);
      folderTokensRef.current = {};
      localStorageAccessTokenRef.current = null;
      setFolderTokens({});
      setFavoriteIds(new Set());
      setPinnedFolders([]);
      setTags([]);
      setTagDraft("");
      setFavoritesLoaded(false);
      setFolderAuthTarget(null);
      setLocalAuthNeeded(false);
      setLocalPassword("");
      setLoadingAuth(true);
      setError(null);

      void (async () => {
        let activeOrigin: string | null = null;
        try {
          const activeServer = await getActiveServer(preferencesStore);
          if (!active) return;
          if (!activeServer) {
            router.replace("/");
            return;
          }
          activeOrigin = activeServer.url;

          const access = await loadBiometricServerSession(activeServer);
          if (!active) return;
          if (access.status === "biometrics-unavailable") {
            setError(
              "Biometric unlock is unavailable. Return to the server screen to sign in again.",
            );
            return;
          }
          if (access.status === "biometrics-denied") {
            setError(
              "Biometric unlock did not succeed. Return to the server screen and try again.",
            );
            return;
          }
          if (access.status !== "authenticated") {
            setError("Sign in to this server before browsing files.");
            router.replace("/");
            return;
          }

          const fetchImpl = createServerFetch(activeServer.url, access.token);
          apiRef.current = {
            origin: activeServer.url,
            token: access.token,
            fetchImpl,
          };
          setApiReady(true);
          const localToken = await loadLocalStorageAccessTokenForServer(
            activeServer.url,
          );
          if (!active) return;
          localStorageAccessTokenRef.current = localToken;
          const [driveResponse, favoriteIdsResponse] = await Promise.all([
            listMobileDrives(fetchImpl, controller.signal),
            getMobileFavoriteIds(fetchImpl, controller.signal).catch(
              () => null,
            ),
          ]);
          if (!active) return;
          if (favoriteIdsResponse) {
            setFavoriteIds(new Set(favoriteIdsResponse.favoriteIds));
            setFavoritesLoaded(true);
          }
          const root = driveResponse.drives.find(
            (drive) => drive.id === driveResponse.rootFolderId,
          );
          const rootCrumb = {
            id: driveResponse.rootFolderId,
            name: root?.name ?? "Home",
          };
          setServer(activeServer);
          setDrives(driveResponse.drives);
          setUserRole(driveResponse.role);
          setRootFolderId(driveResponse.rootFolderId);
          setFolderId(driveResponse.rootFolderId);
          setBreadcrumbs([rootCrumb]);
          setActiveQuery("");
          setSearchInput("");
          void listMobilePinnedFolders(fetchImpl, controller.signal)
            .then((response) => {
              if (active) setPinnedFolders(response.folders);
            })
            .catch(() => undefined);
        } catch (cause) {
          if (!active) return;
          if (
            cause instanceof MobileApiError &&
            cause.status === 401 &&
            !cause.access.protected &&
            !cause.access.isLocalAuthNeeded
          ) {
            if (activeOrigin) {
              await clearSessionForServer(activeOrigin);
              await clearLocalStorageAccessTokenForServer(activeOrigin);
            }
            apiRef.current = null;
            setApiReady(false);
            router.replace("/");
            return;
          }
          setError(
            cause instanceof MobileApiError
              ? cause.message
              : "Could not unlock this server. Return to the server screen and retry.",
          );
        } finally {
          if (active) setLoadingAuth(false);
        }
      })();

      return () => {
        active = false;
        controller.abort();
        listRequestEpochRef.current.invalidate();
        listControllerRef.current?.abort();
        listControllerRef.current = null;
        invalidateDownload();
        moveFolderRequestEpochRef.current.invalidate();
        moveFolderControllerRef.current?.abort();
        moveFolderControllerRef.current = null;
      };
    }, [invalidateDownload, router]),
  );

  useEffect(() => {
    if (folderId && !showingFavorites) void loadContents(folderId, activeQuery);
  }, [activeQuery, folderId, loadContents, showingFavorites]);

  useEffect(() => {
    const fileId = selectedDetails?.id;
    const fetchImpl = apiRef.current?.fetchImpl;
    if (!fileId || fileId.startsWith("local-storage:") || !fetchImpl) {
      setTags([]);
      setTagsLoading(false);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setTags([]);
    setTagsLoading(true);
    void listMobileTags(fetchImpl, fileId, controller.signal)
      .then((response) => {
        if (active) setTags(response.tags);
      })
      .catch((cause: unknown) => {
        if (!active || controller.signal.aborted) return;
        if (!(cause instanceof MobileApiError && cause.status === 404)) {
          setFileError(
            cause instanceof MobileApiError
              ? cause.message
              : "Could not load tags for this file.",
          );
        }
      })
      .finally(() => {
        if (active) setTagsLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [selectedDetails?.id]);

  useEffect(() => {
    const file = selectedDetails;
    if (previewKind !== "video" || !file?.id || !file.name) {
      setSubtitleFiles([]);
      return;
    }

    const video = { id: file.id, name: file.name };
    const currentFiles = files.flatMap((candidate) =>
      candidate.id && candidate.name
        ? [
            {
              id: candidate.id,
              name: candidate.name,
              isFolder: candidate.isFolder,
            },
          ]
        : [],
    );
    setSubtitleFiles(findExternalSubtitleFiles(video, currentFiles));

    const api = apiRef.current;
    const parentId = file.parents?.[0] ?? activeFolder;
    if (!api || !parentId) return;

    const controller = new AbortController();
    void listMobileFiles(
      fetchForFolder(parentId) ?? api.fetchImpl,
      { folderId: parentId },
      controller.signal,
    )
      .then((response) => {
        if (controller.signal.aborted) return;
        const siblings = (response.files ?? []).flatMap((candidate) =>
          candidate.id && candidate.name
            ? [
                {
                  id: candidate.id,
                  name: candidate.name,
                  isFolder: candidate.isFolder,
                },
              ]
            : [],
        );
        setSubtitleFiles(findExternalSubtitleFiles(video, siblings));
      })
      .catch(() => {
        // Embedded tracks and the current folder's candidates remain available.
      });

    return () => controller.abort();
  }, [activeFolder, fetchForFolder, files, previewKind, selectedDetails]);

  const loadFavorites = async () => {
    const api = apiRef.current;
    if (!api) return;
    selectedFileIdRef.current = null;
    invalidateDownload();
    cancelPendingListRequest();
    const requestEpoch = listRequestEpochRef.current.begin();
    const controller = new AbortController();
    listControllerRef.current = controller;
    setSelectionMode(false);
    setSelectedIds(new Set());
    setSelectedFile(null);
    setFileDetails(null);
    setDownloadedUri(null);
    setPreviewText(null);
    setLoadingFiles(true);
    setError(null);
    setNextPageToken(undefined);
    try {
      const [response, favoriteIdsResponse] = await Promise.all([
        listMobileFavorites(api.fetchImpl, undefined, controller.signal),
        getMobileFavoriteIds(api.fetchImpl, controller.signal).catch(
          () => null,
        ),
      ]);
      if (
        controller.signal.aborted ||
        !listRequestEpochRef.current.isCurrent(requestEpoch)
      )
        return;
      setFiles(response.files);
      setNextPageToken(response.nextPageToken);
      if (favoriteIdsResponse) {
        setFavoriteIds(new Set(favoriteIdsResponse.favoriteIds));
        setFavoritesLoaded(true);
      } else {
        setFavoritesLoaded(false);
      }
      setShowingFavorites(true);
      setActiveQuery("");
      setSearchInput("");
      setSelectedFile(null);
      setFileDetails(null);
      setDownloadedUri(null);
      setFileError(null);
    } catch (cause) {
      if (
        controller.signal.aborted ||
        !listRequestEpochRef.current.isCurrent(requestEpoch)
      )
        return;
      if (!(await showAuthFailure(cause))) {
        if (
          controller.signal.aborted ||
          !listRequestEpochRef.current.isCurrent(requestEpoch)
        )
          return;
        setError(
          cause instanceof MobileApiError
            ? cause.message
            : "Could not load favorites. Check your connection and retry.",
        );
      }
    } finally {
      if (
        listControllerRef.current === controller &&
        listRequestEpochRef.current.isCurrent(requestEpoch)
      ) {
        listControllerRef.current = null;
        setLoadingFiles(false);
      }
    }
  };

  const toggleSelected = (fileId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  };

  const loadMoreFavorites = async () => {
    const api = apiRef.current;
    if (!api || !nextPageToken || loadingMore) return;
    cancelPendingListRequest();
    const requestEpoch = listRequestEpochRef.current.begin();
    const controller = new AbortController();
    listControllerRef.current = controller;
    setLoadingMore(true);
    setError(null);
    try {
      const response = await listMobileFavorites(
        api.fetchImpl,
        nextPageToken,
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        !listRequestEpochRef.current.isCurrent(requestEpoch)
      )
        return;
      setFiles((current) => [...current, ...response.files]);
      setNextPageToken(response.nextPageToken);
    } catch (cause) {
      if (
        controller.signal.aborted ||
        !listRequestEpochRef.current.isCurrent(requestEpoch)
      )
        return;
      if (!(await showAuthFailure(cause))) {
        if (
          controller.signal.aborted ||
          !listRequestEpochRef.current.isCurrent(requestEpoch)
        )
          return;
        setError(
          cause instanceof MobileApiError
            ? cause.message
            : "Could not load more favorites. Check your connection and retry.",
        );
      }
    } finally {
      if (
        listControllerRef.current === controller &&
        listRequestEpochRef.current.isCurrent(requestEpoch)
      ) {
        listControllerRef.current = null;
        setLoadingMore(false);
      }
    }
  };

  const toggleFavorite = async () => {
    const api = apiRef.current;
    const fileId = selectedDetails?.id;
    if (!api || !fileId) return;
    setWorking(true);
    setFileError(null);
    try {
      let currentFavorites = favoriteIds;
      if (!favoritesLoaded) {
        const response = await getMobileFavoriteIds(api.fetchImpl);
        currentFavorites = new Set(response.favoriteIds);
        setFavoriteIds(currentFavorites);
        setFavoritesLoaded(true);
      }
      const isFavorite = !currentFavorites.has(fileId);
      await setMobileFavorite(api.fetchImpl, { fileId, isFavorite });
      setFavoriteIds((current) => {
        const updated = new Set(current);
        if (isFavorite) updated.add(fileId);
        else updated.delete(fileId);
        return updated;
      });
      if (showingFavorites && !isFavorite) {
        setFiles((current) => current.filter((file) => file.id !== fileId));
      }
    } catch (cause) {
      if (!(await showAuthFailure(cause))) {
        setFileError(
          cause instanceof MobileApiError
            ? cause.message
            : "Could not update this favorite. Check your connection and retry.",
        );
      }
    } finally {
      setWorking(false);
    }
  };

  const toggleCurrentFolderPin = async () => {
    const api = apiRef.current;
    if (
      !api ||
      userRole.toUpperCase() !== "ADMIN" ||
      !activeFolder ||
      activeFolder.startsWith("local-storage:")
    )
      return;

    const isPinned = pinnedFolders.some((folder) => folder.id === activeFolder);
    setWorking(true);
    setFileError(null);
    try {
      await setMobileFolderPinned(api.fetchImpl, activeFolder, !isPinned);
      setPinnedFolders((current) => {
        if (isPinned)
          return current.filter((folder) => folder.id !== activeFolder);
        const parentId = breadcrumbs.at(-2)?.id;
        return [
          ...current,
          {
            id: activeFolder,
            name: currentFolderName,
            mimeType: "application/vnd.google-apps.folder",
            parents: parentId ? [parentId] : [],
          },
        ];
      });
    } catch (cause) {
      if (!(await showAuthFailure(cause))) {
        setFileError(
          cause instanceof MobileApiError
            ? cause.message
            : "Could not update pinned folders. Check your connection and retry.",
        );
      }
    } finally {
      setWorking(false);
    }
  };

  const handleAddTag = async () => {
    const api = apiRef.current;
    const fileId = selectedDetails?.id;
    const tag = tagDraft.trim();
    if (
      !api ||
      !fileId ||
      fileId.startsWith("local-storage:") ||
      userRole.toUpperCase() !== "ADMIN" ||
      !tag ||
      tag.length > 80
    )
      return;

    setWorking(true);
    setFileError(null);
    try {
      await addMobileTag(api.fetchImpl, fileId, tag);
      setTags((current) =>
        current.includes(tag) ? current : [...current, tag],
      );
      setTagDraft("");
    } catch (cause) {
      if (!(await showAuthFailure(cause))) {
        setFileError(
          cause instanceof MobileApiError
            ? cause.message
            : "Could not add this tag. Check your connection and retry.",
        );
      }
    } finally {
      setWorking(false);
    }
  };

  const handleRemoveTag = async (tag: string) => {
    const api = apiRef.current;
    const fileId = selectedDetails?.id;
    if (
      !api ||
      !fileId ||
      fileId.startsWith("local-storage:") ||
      userRole.toUpperCase() !== "ADMIN"
    )
      return;

    setWorking(true);
    setFileError(null);
    try {
      await removeMobileTag(api.fetchImpl, fileId, tag);
      setTags((current) => current.filter((currentTag) => currentTag !== tag));
    } catch (cause) {
      if (!(await showAuthFailure(cause))) {
        setFileError(
          cause instanceof MobileApiError
            ? cause.message
            : "Could not remove this tag. Check your connection and retry.",
        );
      }
    } finally {
      setWorking(false);
    }
  };

  const loadMoveFolder = async (
    targetFolderId: string,
    nextBreadcrumbs: Crumb[],
    excludedIds = moveFileIds,
  ) => {
    const api = apiRef.current;
    if (!api || !targetFolderId) return;
    cancelPendingMoveFolderRequest();
    const requestEpoch = moveFolderRequestEpochRef.current.begin();
    const controller = new AbortController();
    moveFolderControllerRef.current = controller;
    const excludedIdSet = new Set(excludedIds);
    setMoveLoading(true);
    setFileError(null);
    try {
      const response = await listMobileFiles(
        fetchForFolder(targetFolderId) ?? api.fetchImpl,
        { folderId: targetFolderId },
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        !moveFolderRequestEpochRef.current.isCurrent(requestEpoch)
      )
        return;
      setMoveFolderId(targetFolderId);
      setMoveBreadcrumbs(nextBreadcrumbs);
      setMoveFolders(
        (response.files ?? []).filter(
          (file) => file.isFolder && !excludedIdSet.has(file.id ?? ""),
        ),
      );
    } catch (cause) {
      if (
        controller.signal.aborted ||
        !moveFolderRequestEpochRef.current.isCurrent(requestEpoch)
      )
        return;
      if (!(await showAuthFailure(cause))) {
        setFileError(
          cause instanceof MobileApiError
            ? cause.message
            : "Could not load destination folders. Retry or choose another folder.",
        );
      }
    } finally {
      if (
        moveFolderControllerRef.current === controller &&
        moveFolderRequestEpochRef.current.isCurrent(requestEpoch)
      ) {
        moveFolderControllerRef.current = null;
        setMoveLoading(false);
      }
    }
  };

  const openMovePicker = () => {
    const file = selectedDetails;
    if (!file?.id) return;
    const initialFolderId = activeFolder || rootFolderId;
    const initialBreadcrumbs = breadcrumbs.length
      ? breadcrumbs
      : [{ id: initialFolderId, name: "Home" }];
    setMoveFileIds([file.id]);
    setMoveTarget(file);
    void loadMoveFolder(initialFolderId, initialBreadcrumbs, [file.id]);
  };

  const openBulkMovePicker = () => {
    const chosen = files.filter((file) => file.id && selectedIds.has(file.id));
    const ids = chosen.flatMap((file) => (file.id ? [file.id] : []));
    if (
      ids.length !== selectedIds.size ||
      ids.some((id) => id.startsWith("local-storage:"))
    ) {
      setFileError(
        "Only files from the current Drive folder can be moved together.",
      );
      return;
    }
    const initialFolderId = activeFolder || rootFolderId;
    const initialBreadcrumbs = breadcrumbs.length
      ? breadcrumbs
      : [{ id: initialFolderId, name: "Home" }];
    setMoveFileIds(ids);
    setMoveTarget(chosen[0] ?? null);
    void loadMoveFolder(initialFolderId, initialBreadcrumbs, ids);
  };

  const confirmMove = async () => {
    const api = apiRef.current;
    const moveFileIdSet = new Set(moveFileIds);
    const filesToMove = files.filter(
      (file) => file.id && moveFileIdSet.has(file.id),
    );
    if (!api || !moveFileIds.length || !filesToMove.length || !moveFolderId)
      return;
    const currentParentId = filesToMove[0]?.parents?.[0] ?? activeFolder;
    if (
      !currentParentId ||
      filesToMove.length !== moveFileIds.length ||
      filesToMove.some(
        (file) =>
          file.id?.startsWith("local-storage:") ||
          (file.parents?.[0] ?? activeFolder) !== currentParentId,
      )
    ) {
      setFileError(
        "These files cannot be moved together from their current storage location.",
      );
      return;
    }
    if (currentParentId === moveFolderId) {
      cancelPendingMoveFolderRequest();
      setMoveTarget(null);
      setMoveFileIds([]);
      setSelectedIds(new Set());
      setSelectionMode(false);
      return;
    }
    setWorking(true);
    setFileError(null);
    try {
      await moveMobileFiles(api.fetchImpl, {
        fileIds: moveFileIds,
        currentParentId,
        newParentId: moveFolderId,
      });
      setFiles((current) =>
        current.filter((entry) => !moveFileIdSet.has(entry.id ?? "")),
      );
      setSelectedFile(null);
      setFileDetails(null);
      setDownloadedUri(null);
      setPreviewText(null);
      cancelPendingMoveFolderRequest();
      setMoveTarget(null);
      setMoveFileIds([]);
      setSelectedIds(new Set());
      setSelectionMode(false);
    } catch (cause) {
      if (!(await showAuthFailure(cause))) {
        setFileError(
          cause instanceof MobileApiError
            ? cause.message
            : "Could not move this file. Check your access and retry.",
        );
      }
    } finally {
      setWorking(false);
    }
  };

  const performDelete = async () => {
    const api = apiRef.current;
    const fileId = selectedDetails?.id;
    if (!api || !fileId) return;
    setWorking(true);
    setFileError(null);
    try {
      await deleteManagedMobileFile(api.fetchImpl, fileId);
      setFiles((current) => current.filter((entry) => entry.id !== fileId));
      setSelectedFile(null);
      setFileDetails(null);
      setDownloadedUri(null);
      setPreviewText(null);
      setMoveTarget(null);
    } catch (cause) {
      if (!(await showAuthFailure(cause))) {
        setFileError(
          cause instanceof MobileApiError
            ? cause.message
            : "Could not delete this file. Check your access and retry.",
        );
      }
    } finally {
      setWorking(false);
    }
  };

  const performBulkDelete = async () => {
    const api = apiRef.current;
    const fileIds = [...selectedIds];
    const fileIdSet = new Set(fileIds);
    if (!api || !fileIds.length) return;
    setWorking(true);
    setFileError(null);
    try {
      await deleteMobileFiles(api.fetchImpl, {
        fileIds,
        parentId: activeFolder,
      });
      setFiles((current) =>
        current.filter((file) => !fileIdSet.has(file.id ?? "")),
      );
      setSelectedIds(new Set());
      setSelectionMode(false);
      setSelectedFile(null);
      setFileDetails(null);
      setDownloadedUri(null);
      setPreviewText(null);
    } catch (cause) {
      if (!(await showAuthFailure(cause))) {
        setFileError(
          cause instanceof MobileApiError
            ? cause.message
            : "Could not delete the selected items.",
        );
      }
    } finally {
      setWorking(false);
    }
  };

  const requestBulkDelete = () => {
    Alert.alert(
      "Permanently delete selected items?",
      `${selectedIds.size} items will be removed from Drive and cannot be restored.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete permanently",
          style: "destructive",
          onPress: () => void performBulkDelete(),
        },
      ],
    );
  };

  const leaveSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const requestDelete = () => {
    const name = selectedDetails?.name ?? "this file";
    Alert.alert(
      "Delete file?",
      `Delete “${name}”? This action cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void performDelete(),
        },
      ],
    );
  };

  const changeDrive = (drive: (typeof drives)[number]) => {
    cancelPendingListRequest();
    cancelPendingMoveFolderRequest();
    selectedFileIdRef.current = null;
    invalidateDownload();
    leaveSelectionMode();
    setShowingFavorites(false);
    setFolderId(drive.id);
    setBreadcrumbs([{ id: drive.id, name: drive.name }]);
    setActiveQuery("");
    setSearchInput("");
    setSelectedFile(null);
    setFileDetails(null);
    setDownloadedUri(null);
    setPreviewText(null);
    setFiles([]);
    setFolderAuthTarget(null);
    setLocalAuthNeeded(false);
    setLocalPassword("");
  };

  const openFolder = (file: MobileFile) => {
    if (!file.id) return;
    cancelPendingListRequest();
    cancelPendingMoveFolderRequest();
    selectedFileIdRef.current = null;
    invalidateDownload();
    leaveSelectionMode();
    setShowingFavorites(false);
    const crumb = { id: file.id, name: file.name ?? "Folder" };
    setFolderId(file.id);
    setBreadcrumbs((current) => [...current, crumb]);
    setActiveQuery("");
    setSearchInput("");
    setSelectedFile(null);
    setFileDetails(null);
    setDownloadedUri(null);
    setPreviewText(null);
    setFiles([]);
    setFolderAuthTarget(null);
  };

  const openPinnedFolder = async (folder: MobilePinnedFolder) => {
    const api = apiRef.current;
    if (!api || !folder.id) return;

    cancelPendingListRequest();
    cancelPendingMoveFolderRequest();
    selectedFileIdRef.current = null;
    invalidateDownload();
    const requestEpoch = listRequestEpochRef.current.begin();
    leaveSelectionMode();
    setShowingFavorites(false);
    setActiveQuery("");
    setSearchInput("");
    setSelectedFile(null);
    setFileDetails(null);
    setDownloadedUri(null);
    setPreviewText(null);
    setFolderAuthTarget(null);
    setError(null);

    const path: Crumb[] = [{ id: folder.id, name: folder.name ?? "Folder" }];
    const visited = new Set([folder.id]);
    let parentId = folder.parents?.[0];
    let rootDrive: (typeof drives)[number] | undefined;

    try {
      for (let depth = 0; parentId && depth < 32; depth += 1) {
        rootDrive = drives.find((drive) => drive.id === parentId);
        if (rootDrive || visited.has(parentId)) break;
        visited.add(parentId);
        const parent = await getMobileFileDetails(api.fetchImpl, {
          fileId: parentId,
        });
        if (!listRequestEpochRef.current.isCurrent(requestEpoch)) return;
        path.push({ id: parent.id ?? parentId, name: parent.name ?? "Folder" });
        parentId = parent.parents?.[0];
      }
      const drive =
        rootDrive ?? drives.find((candidate) => candidate.id === folder.id);
      const rootCrumb = drive
        ? { id: drive.id, name: drive.name }
        : { id: rootFolderId, name: "Home" };
      if (!listRequestEpochRef.current.isCurrent(requestEpoch)) return;
      setFolderId(folder.id);
      setBreadcrumbs(
        drive?.id === folder.id ? [rootCrumb] : [rootCrumb, ...path.reverse()],
      );
      setFiles([]);
      setNextPageToken(undefined);
    } catch (cause) {
      if (!listRequestEpochRef.current.isCurrent(requestEpoch)) return;
      if (!(await showAuthFailure(cause))) {
        setError(
          cause instanceof MobileApiError
            ? cause.message
            : "Could not open this pinned folder. Check your connection and retry.",
        );
      }
    }
  };

  const openCrumb = (index: number) => {
    const crumb = breadcrumbs[index];
    if (!crumb) return;
    cancelPendingListRequest();
    cancelPendingMoveFolderRequest();
    selectedFileIdRef.current = null;
    invalidateDownload();
    leaveSelectionMode();
    setShowingFavorites(false);
    setFolderId(crumb.id);
    setBreadcrumbs((current) => current.slice(0, index + 1));
    setSelectedFile(null);
    setFileDetails(null);
    setDownloadedUri(null);
    setPreviewText(null);
    setFiles([]);
    setFolderAuthTarget(null);
    if (!crumb.id.startsWith("local-storage:")) {
      setLocalAuthNeeded(false);
      setLocalPassword("");
    }
    setActiveQuery("");
    setSearchInput("");
  };

  const inspectFile = async (file: MobileFile) => {
    const requestFileId = file.id;
    selectedFileIdRef.current = requestFileId ?? null;
    invalidateDownload();
    setSelectedFile(file);
    setFileDetails(null);
    setDownloadedUri(null);
    setPreviewText(null);
    setFileError(null);
    const api = apiRef.current;
    if (!requestFileId || !api) return;
    if (
      file.protectedFolderId &&
      !folderTokensRef.current[file.protectedFolderId]
    ) {
      setFolderAuthTarget({
        id: file.protectedFolderId,
        name: file.name ?? "Protected folder",
      });
      setFolderPassword("");
      return;
    }
    try {
      const fileParentId = file.parents?.[0];
      const accessFolderId =
        file.protectedFolderId ??
        (fileParentId === activeFolder ? activeFolder : undefined);
      const details = await getMobileFileDetails(
        (accessFolderId ? fetchForFolder(accessFolderId) : undefined) ??
          api.fetchImpl,
        { fileId: requestFileId },
      );
      if (selectedFileIdRef.current !== requestFileId) return;
      setFileDetails({
        ...details,
        protectedFolderId: file.protectedFolderId,
      });
    } catch (cause) {
      if (selectedFileIdRef.current !== requestFileId) return;
      if (cause instanceof MobileApiError && cause.access.isLocalAuthNeeded) {
        localStorageAccessTokenRef.current = null;
        setLocalAuthNeeded(true);
        setLocalPassword("");
        if (apiRef.current) {
          await clearLocalStorageAccessTokenForServer(apiRef.current.origin);
        }
        return;
      }
      if (cause instanceof MobileApiError && cause.access.protected) {
        const protectedFolderId =
          cause.access.folderId ?? file.protectedFolderId ?? activeFolder;
        setSelectedFile({ ...file, protectedFolderId });
        setFolderAuthTarget({
          id: protectedFolderId,
          name: file.name ?? "Protected folder",
        });
        setFolderPassword("");
        return;
      }
      if (!(await showAuthFailure(cause))) {
        if (selectedFileIdRef.current !== requestFileId) return;
        setFileError(
          cause instanceof MobileApiError
            ? cause.message
            : "Could not load file details. You can still try downloading the file.",
        );
      }
    }
  };

  const handleUnlockProtectedFolder = async () => {
    const api = apiRef.current;
    if (!api || !folderAuthTarget || !folderAuthId.trim() || !folderPassword)
      return;
    const authTarget = folderAuthTarget;
    const fileToRetry = selectedDetails;
    setFolderAuthWorking(true);
    setError(null);
    try {
      const response = await api.fetchImpl("/api/auth/folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderId: folderAuthTarget.id,
          id: folderAuthId.trim(),
          password: folderPassword,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        token?: unknown;
      } | null;
      if (!response.ok || typeof payload?.token !== "string") {
        setError(
          response.status === 401
            ? "The folder ID or password is incorrect."
            : response.status === 429
              ? "Too many attempts. Wait a moment and retry."
              : "Could not unlock this folder. Check your connection and retry.",
        );
        return;
      }

      const nextTokens = {
        ...folderTokensRef.current,
        [authTarget.id]: payload.token,
      };
      if (!showingFavorites && activeFolder && activeFolder !== authTarget.id) {
        nextTokens[activeFolder] = payload.token;
      }
      folderTokensRef.current = nextTokens;
      setFolderTokens(nextTokens);
      setFolderAuthTarget(null);
      setFolderAuthId("");
      setFolderPassword("");
      if (fileToRetry?.id) {
        void inspectFile({
          ...fileToRetry,
          protectedFolderId: fileToRetry.protectedFolderId ?? authTarget.id,
        });
      } else {
        void loadContents(activeFolder, activeQuery);
      }
    } catch {
      setError(
        "Could not unlock this folder. Check your connection and retry.",
      );
    } finally {
      setFolderAuthWorking(false);
    }
  };

  const handleUnlockLocalStorage = async () => {
    const api = apiRef.current;
    if (!api || !localPassword) return;
    setLocalAuthWorking(true);
    setError(null);
    try {
      const result = await unlockMobileLocalStorage(
        api.fetchImpl,
        localPassword,
      );
      if (!result.success) {
        setError(
          "Could not unlock local storage. Check the password and retry.",
        );
        return;
      }
      if (result.protected && !result.token) {
        setError(
          "The server did not return an access token. Retry the unlock.",
        );
        return;
      }
      if (result.token) {
        await saveLocalStorageAccessTokenForServer(api.origin, result.token);
        localStorageAccessTokenRef.current = result.token;
      }
      setLocalAuthNeeded(false);
      setLocalPassword("");
      void loadContents(activeFolder, activeQuery);
    } catch (cause) {
      if (cause instanceof MobileApiError && cause.status === 403) {
        setError("The local storage password is incorrect.");
      } else if (!(await showAuthFailure(cause))) {
        setError(
          cause instanceof MobileApiError
            ? cause.message
            : "Could not unlock local storage. Check your connection and retry.",
        );
      }
    } finally {
      setLocalAuthWorking(false);
    }
  };

  const handleDownload = async () => {
    const file = selectedDetails;
    const api = apiRef.current;
    if (!file?.id || !file.name || !api) return;
    downloadControllerRef.current?.abort();
    const requestEpoch = downloadRequestEpochRef.current.begin();
    const controller = new AbortController();
    downloadControllerRef.current = controller;
    const isCurrentRequest = () =>
      !controller.signal.aborted &&
      downloadRequestEpochRef.current.isCurrent(requestEpoch) &&
      selectedFileIdRef.current === file.id;
    setWorking(true);
    setDownloadPercent(0);
    setFileError(null);
    setDownloadedUri(null);
    setPreviewText(null);
    try {
      const downloaded = await downloadMobileFile({
        origin: api.origin,
        sessionToken: api.token,
        folderAccessToken:
          (file.protectedFolderId
            ? folderTokensRef.current[file.protectedFolderId]
            : undefined) ??
          (file.parents?.[0] === activeFolder
            ? currentFolderAccessToken
            : undefined),
        localStorageAccessToken: file.id.startsWith("local-storage:")
          ? (localStorageAccessTokenRef.current ?? undefined)
          : undefined,
        params: { fileId: file.id },
        fileName: file.name,
        signal: controller.signal,
        onProgress: ({ bytesWritten, totalBytes }) => {
          if (!isCurrentRequest()) return;
          setDownloadPercent(
            totalBytes > 0
              ? Math.min(100, Math.round((bytesWritten / totalBytes) * 100))
              : null,
          );
        },
      });
      if (!isCurrentRequest()) return;
      if (getNativePreviewKind(file.mimeType, file.name) === "text") {
        try {
          const textFile = new ExpoFile(downloaded.uri);
          const text =
            textFile.size > MAX_TEXT_PREVIEW_BYTES
              ? "This text file is too large to preview here. Use Save or share to open it in another app."
              : await textFile.text();
          if (!isCurrentRequest()) return;
          setPreviewText(text);
        } catch {
          if (!isCurrentRequest()) return;
          setPreviewText(
            "Text preview could not be loaded. Use Save or share to open this file in another app.",
          );
        }
      }
      if (!isCurrentRequest()) return;
      setDownloadedUri(downloaded.uri);
      setDownloadPercent(100);
    } catch (cause) {
      if (isCurrentRequest()) {
        if (cause instanceof MobileApiError && cause.access.isLocalAuthNeeded) {
          localStorageAccessTokenRef.current = null;
          await clearLocalStorageAccessTokenForServer(api.origin);
          if (!isCurrentRequest()) return;
          setLocalAuthNeeded(true);
          setLocalPassword("");
          return;
        }
        if (cause instanceof MobileApiError && (await showAuthFailure(cause)))
          return;
        if (!isCurrentRequest()) return;
        if (cause instanceof MobileApiError && cause.access.protected) {
          const protectedFolderId =
            cause.access.folderId ?? file.protectedFolderId ?? activeFolder;
          const protectedFile = { ...file, protectedFolderId };
          setSelectedFile(protectedFile);
          setFileDetails(protectedFile);
          setFolderAuthTarget({
            id: protectedFolderId,
            name: file.name ?? "Protected folder",
          });
          setFolderPassword("");
          return;
        }
        setFileError(
          cause instanceof MobileApiError
            ? cause.message
            : "The file could not be downloaded. Check your connection and retry.",
        );
      }
    } finally {
      if (downloadControllerRef.current === controller) {
        downloadControllerRef.current = null;
        setWorking(false);
      }
    }
  };

  const loadSubtitle = async (subtitle: SubtitleFile): Promise<string> => {
    const api = apiRef.current;
    const file = selectedDetails;
    if (!api || !file)
      throw new Error("The server session has ended. Select the file again.");
    const parentId = file.parents?.[0] ?? activeFolder;
    const folderAccessToken =
      (file.protectedFolderId
        ? folderTokensRef.current[file.protectedFolderId]
        : undefined) ??
      (parentId ? folderTokensRef.current[parentId] : undefined) ??
      (parentId === activeFolder ? currentFolderAccessToken : undefined);
    const downloaded = await downloadMobileFile({
      origin: api.origin,
      sessionToken: api.token,
      folderAccessToken,
      localStorageAccessToken: subtitle.id.startsWith("local-storage:")
        ? (localStorageAccessTokenRef.current ?? undefined)
        : undefined,
      params: { fileId: subtitle.id },
      fileName: subtitle.name,
    });
    const localFile = new ExpoFile(downloaded.uri);
    if (localFile.size > 1024 * 1024) {
      try {
        localFile.delete();
      } catch {
        // Best-effort cleanup for a subtitle that exceeds the preview limit.
      }
      throw new Error("Subtitle files larger than 1 MB cannot be loaded.");
    }
    try {
      return await localFile.text();
    } finally {
      try {
        localFile.delete();
      } catch {
        // Cleanup must not hide a read or parsing result.
      }
    }
  };

  const handleCreateShare = () => {
    if (!selectedDetails?.id) return;
    router.push({
      pathname: "/shares",
      params: {
        mode: "create",
        itemId: selectedDetails.id,
        parentId: selectedDetails.parents?.[0] ?? activeFolder,
        itemName: selectedDetails.name ?? "",
        isFolder: selectedDetails.isFolder ? "true" : "false",
      },
    });
  };

  const handleCloseDetails = () => {
    selectedFileIdRef.current = null;
    invalidateDownload();
    setSelectedFile(null);
    setFileDetails(null);
    setDownloadedUri(null);
    setPreviewText(null);
    setFileError(null);
  };

  const handleShareDownloaded = async () => {
    if (!downloadedUri) return;
    try {
      const Sharing = await import("expo-sharing");
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(downloadedUri);
      } else {
        setFileError("The downloaded file is saved in Vaehor's app documents.");
      }
    } catch {
      setFileError("The downloaded file is saved in Vaehor's app documents.");
    }
  };

  const handleBulkDownload = async () => {
    const api = apiRef.current;
    const selected = files.filter(
      (file) => file.id && selectedIds.has(file.id),
    );
    if (!api || selected.length !== selectedIds.size || !selected.length)
      return;
    if (selected.length > 20) {
      setError("Choose no more than 20 files for one archive.");
      return;
    }
    if (selected.some((file) => file.isFolder)) {
      setError(
        "Choose files only. Folders cannot be added to a download archive.",
      );
      return;
    }
    if (
      selected.some((file) => file.id?.startsWith("local-storage:")) ||
      currentFolderAccessToken
    ) {
      setError(
        "Bulk download is not available for local or password-protected folders. Download each permitted file separately.",
      );
      return;
    }

    setWorking(true);
    setError(null);
    try {
      const archive = await downloadMobileArchive(
        api.fetchImpl,
        selected.flatMap((file) => (file.id ? [file.id] : [])),
      );
      setSelectedIds(new Set());
      setSelectionMode(false);
      const Sharing = await import("expo-sharing");
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(archive.uri, {
          mimeType: "application/zip",
          dialogTitle: "Save or share selected files",
          UTI: "com.pkware.zip-archive",
        });
      } else {
        setError(
          "The ZIP archive is saved in Vaehor's app documents, but this device has no available share sheet.",
        );
      }
    } catch (cause) {
      if (cause instanceof MobileApiError && (await showAuthFailure(cause)))
        return;
      setError(
        cause instanceof MobileApiError
          ? cause.message
          : "The selected files could not be downloaded. Check your connection and available storage.",
      );
    } finally {
      setWorking(false);
    }
  };

  const shareActions = useMemo(
    () => breadcrumbs.map((crumb, index) => ({ ...crumb, index })),
    [breadcrumbs],
  );
  const canRenderFileList =
    !loadingAuth && apiReady && !localAuthNeeded && !folderAuthTarget;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <FlatList
        data={canRenderFileList ? files : []}
        keyExtractor={(file, index) => file.id ?? `${file.name}-${index}`}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        extraData={{ selectedIds, selectionMode }}
        renderItem={({ item: file }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{
              selected: Boolean(file.id && selectedIds.has(file.id)),
            }}
            onPress={() => {
              if (selectionMode) {
                if (file.id) toggleSelected(file.id);
              } else if (file.isFolder) {
                openFolder(file);
              } else {
                void inspectFile(file);
              }
            }}
            style={[
              styles.fileRow,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={styles.fileIcon}>
              {selectionMode
                ? file.id && selectedIds.has(file.id)
                  ? "☑"
                  : "☐"
                : file.isFolder
                  ? "▰"
                  : "▤"}
            </Text>
            <View style={styles.fileInfo}>
              <Text
                style={[styles.fileName, { color: colors.foreground }]}
                numberOfLines={1}
              >
                {file.name ?? "Unnamed file"}
              </Text>
              <Text
                style={[styles.fileMeta, { color: colors.muted }]}
                numberOfLines={1}
              >
                {file.isFolder ? "Folder" : (file.mimeType ?? "File")}
                {file.size ? ` · ${formatSize(file.size)}` : ""}
              </Text>
            </View>
            <Text style={[styles.fileChevron, { color: colors.muted }]}>›</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          canRenderFileList && !loadingFiles ? (
            <Text style={[styles.empty, { color: colors.muted }]}>
              {activeQuery ? "No matching files." : "This folder is empty."}
            </Text>
          ) : null
        }
        ListHeaderComponent={
          <>
            <View style={styles.header}>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  router.canGoBack() ? router.back() : router.replace("/")
                }
              >
                <Text style={styles.backText}>‹ Servers</Text>
              </Pressable>
              <View style={styles.headerTitle}>
                <Text style={[styles.title, { color: colors.foreground }]}>
                  {showingFavorites ? "Favorites" : "Browse files"}
                </Text>
                <Text style={[styles.subtitle, { color: colors.muted }]}>
                  {currentServerName}
                </Text>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ flexDirection: "row", gap: 12 }}
              >
                <Pressable
                  accessibilityRole="button"
                  disabled={loadingFiles || loadingAuth}
                  onPress={() =>
                    void (showingFavorites
                      ? loadFavorites()
                      : loadContents(activeFolder, activeQuery))
                  }
                >
                  <Text style={styles.actionText}>Refresh</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: showingFavorites }}
                  disabled={loadingFiles || loadingAuth}
                  onPress={() => void loadFavorites()}
                >
                  <Text style={styles.actionText}>Favorites</Text>
                </Pressable>
                {["ADMIN", "EDITOR", "USER"].includes(userRole.toUpperCase()) &&
                !showingFavorites ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: selectionMode }}
                    disabled={loadingFiles || loadingAuth || working}
                    onPress={() =>
                      selectionMode
                        ? leaveSelectionMode()
                        : setSelectionMode(true)
                    }
                  >
                    <Text style={styles.actionText}>
                      {selectionMode ? "Cancel selection" : "Select items"}
                    </Text>
                  </Pressable>
                ) : null}
                {userRole.toUpperCase() === "ADMIN" ? (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => router.push("/admin")}
                    >
                      <Text style={styles.actionText}>Admin</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => router.push("/shares")}
                    >
                      <Text style={styles.actionText}>Shares</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() =>
                        router.push({
                          pathname: "/requests",
                          params: {
                            folderId: activeFolder,
                            folderName: currentFolderName,
                          },
                        })
                      }
                    >
                      <Text style={styles.actionText}>Requests</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => router.push("/trash")}
                    >
                      <Text style={styles.actionText}>Trash</Text>
                    </Pressable>
                  </>
                ) : null}
              </ScrollView>
            </View>

            {error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            ) : null}
            {loadingAuth ? (
              <ActivityIndicator color="#1f6f78" size="large" />
            ) : null}

            {!loadingAuth && apiReady ? (
              <>
                <Text
                  style={[styles.sectionTitle, { color: colors.foreground }]}
                >
                  Drives
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.driveRow}
                >
                  {drives.map((drive) => (
                    <Pressable
                      key={drive.id}
                      accessibilityRole="button"
                      accessibilityState={{
                        selected:
                          drive.id === (breadcrumbs[0]?.id ?? rootFolderId),
                      }}
                      onPress={() => changeDrive(drive)}
                      style={[
                        styles.driveChip,
                        {
                          backgroundColor:
                            drive.id === (breadcrumbs[0]?.id ?? rootFolderId)
                              ? "#1f6f78"
                              : colors.surface,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.driveText,
                          {
                            color:
                              drive.id === (breadcrumbs[0]?.id ?? rootFolderId)
                                ? "#ffffff"
                                : colors.foreground,
                          },
                        ]}
                      >
                        {drive.name}
                        {drive.isProtected ? " · Locked" : ""}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>

                {activeFolder === rootFolderId && pinnedFolders.length > 0 ? (
                  <View>
                    <Text
                      style={[
                        styles.sectionTitle,
                        { color: colors.foreground },
                      ]}
                    >
                      Pinned folders
                    </Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.driveRow}
                    >
                      {pinnedFolders.map((folder) => (
                        <Pressable
                          key={folder.id}
                          accessibilityRole="button"
                          onPress={() => void openPinnedFolder(folder)}
                          style={[
                            styles.driveChip,
                            {
                              backgroundColor: colors.surface,
                              borderColor: colors.border,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.driveText,
                              { color: colors.foreground },
                            ]}
                            numberOfLines={1}
                          >
                            ▰ {folder.name ?? "Pinned folder"}
                          </Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                ) : null}

                <View
                  style={[
                    styles.searchBox,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <TextInput
                    accessibilityLabel="Search files in this folder"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                    placeholder={`Search in ${currentFolderName}`}
                    placeholderTextColor={colors.muted}
                    value={searchInput}
                    onChangeText={setSearchInput}
                    onSubmitEditing={() => {
                      cancelPendingListRequest();
                      selectedFileIdRef.current = null;
                      invalidateDownload();
                      leaveSelectionMode();
                      setShowingFavorites(false);
                      setActiveQuery(searchInput.trim());
                      setSelectedFile(null);
                      setFileDetails(null);
                      setDownloadedUri(null);
                      setPreviewText(null);
                    }}
                    style={[styles.searchInput, { color: colors.foreground }]}
                  />
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      cancelPendingListRequest();
                      selectedFileIdRef.current = null;
                      invalidateDownload();
                      leaveSelectionMode();
                      setShowingFavorites(false);
                      setActiveQuery(searchInput.trim());
                      setSelectedFile(null);
                      setFileDetails(null);
                      setDownloadedUri(null);
                      setPreviewText(null);
                    }}
                  >
                    <Text style={styles.actionText}>Search</Text>
                  </Pressable>
                </View>

                {selectionMode ? (
                  <View
                    style={[
                      styles.detailCard,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.sectionTitle,
                        { color: colors.foreground },
                      ]}
                    >
                      {selectedIds.size} selected
                    </Text>
                    <View style={styles.buttonRow}>
                      <Pressable
                        accessibilityRole="button"
                        disabled={!files.length || working}
                        style={styles.secondaryButton}
                        onPress={() =>
                          setSelectedIds(
                            new Set(
                              files.flatMap((file) =>
                                file.id ? [file.id] : [],
                              ),
                            ),
                          )
                        }
                      >
                        <Text style={styles.secondaryButtonText}>
                          Select all in this folder
                        </Text>
                      </Pressable>
                      {selectedIds.size > 0 ? (
                        <Pressable
                          accessibilityRole="button"
                          disabled={working || selectedIds.size > 20}
                          style={[
                            styles.secondaryButton,
                            (working || selectedIds.size > 20) &&
                              styles.disabled,
                          ]}
                          onPress={() => void handleBulkDownload()}
                        >
                          <Text style={styles.secondaryButtonText}>
                            {working
                              ? "Preparing archive…"
                              : `Download selected (${selectedIds.size})`}
                          </Text>
                        </Pressable>
                      ) : null}
                      {selectedIds.size > 0 &&
                      ["ADMIN", "EDITOR"].includes(userRole.toUpperCase()) ? (
                        <Pressable
                          accessibilityRole="button"
                          disabled={working}
                          style={styles.secondaryButton}
                          onPress={openBulkMovePicker}
                        >
                          <Text style={styles.secondaryButtonText}>
                            Move selected…
                          </Text>
                        </Pressable>
                      ) : null}
                      {selectedIds.size > 0 &&
                      userRole.toUpperCase() === "ADMIN" ? (
                        <Pressable
                          accessibilityRole="button"
                          disabled={working}
                          style={styles.secondaryButton}
                          onPress={requestBulkDelete}
                        >
                          <Text
                            style={[
                              styles.secondaryButtonText,
                              { color: "#b42318" },
                            ]}
                          >
                            Delete selected permanently
                          </Text>
                        </Pressable>
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        style={styles.secondaryButton}
                        onPress={leaveSelectionMode}
                      >
                        <Text style={styles.secondaryButtonText}>Done</Text>
                      </Pressable>
                    </View>
                    {fileError ? (
                      <Text accessibilityRole="alert" style={styles.error}>
                        {fileError}
                      </Text>
                    ) : null}
                  </View>
                ) : null}

                <View style={styles.breadcrumbs}>
                  {shareActions.map((crumb, index) => (
                    <View key={`${crumb.id}-${index}`} style={styles.crumbPart}>
                      {index > 0 ? (
                        <Text
                          style={[
                            styles.crumbSeparator,
                            { color: colors.muted },
                          ]}
                        >
                          ›
                        </Text>
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => openCrumb(crumb.index)}
                      >
                        <Text
                          style={[
                            styles.crumbText,
                            {
                              color:
                                index === shareActions.length - 1
                                  ? colors.foreground
                                  : colors.accent,
                            },
                          ]}
                          numberOfLines={1}
                        >
                          {crumb.name}
                        </Text>
                      </Pressable>
                    </View>
                  ))}
                </View>

                {userRole.toUpperCase() === "ADMIN" &&
                activeFolder !== rootFolderId &&
                !activeFolder.startsWith("local-storage:") ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={working}
                    onPress={() => void toggleCurrentFolderPin()}
                  >
                    <Text style={styles.actionText}>
                      {currentFolderIsPinned
                        ? "Unpin this folder"
                        : "Pin this folder"}
                    </Text>
                  </Pressable>
                ) : null}

                {localAuthNeeded ? (
                  <View
                    style={[
                      styles.authCard,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.sectionTitle,
                        { color: colors.foreground },
                      ]}
                    >
                      Unlock local storage
                    </Text>
                    <Text style={[styles.fileMeta, { color: colors.muted }]}>
                      Enter the local storage password configured on this
                      server. Vaehor keeps the temporary access token in this
                      device’s secure storage.
                    </Text>
                    <TextInput
                      accessibilityLabel="Local storage password"
                      autoCapitalize="none"
                      autoCorrect={false}
                      secureTextEntry
                      placeholder="Local storage password"
                      placeholderTextColor={colors.muted}
                      value={localPassword}
                      onChangeText={setLocalPassword}
                      style={[
                        styles.input,
                        {
                          color: colors.foreground,
                          borderColor: colors.border,
                        },
                      ]}
                    />
                    <Pressable
                      style={[
                        styles.primaryButton,
                        (localAuthWorking || !localPassword) && styles.disabled,
                      ]}
                      disabled={localAuthWorking || !localPassword}
                      onPress={() => void handleUnlockLocalStorage()}
                    >
                      <Text style={styles.primaryButtonText}>
                        {localAuthWorking
                          ? "Unlocking…"
                          : "Unlock local storage"}
                      </Text>
                    </Pressable>
                  </View>
                ) : folderAuthTarget ? (
                  <View
                    style={[
                      styles.authCard,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.sectionTitle,
                        { color: colors.foreground },
                      ]}
                    >
                      Unlock {folderAuthTarget.name}
                    </Text>
                    <Text style={[styles.fileMeta, { color: colors.muted }]}>
                      Enter the folder ID and password configured by your server
                      administrator.
                    </Text>
                    <TextInput
                      accessibilityLabel="Protected folder ID"
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder="Folder ID"
                      placeholderTextColor={colors.muted}
                      value={folderAuthId}
                      onChangeText={setFolderAuthId}
                      style={[
                        styles.input,
                        {
                          color: colors.foreground,
                          borderColor: colors.border,
                        },
                      ]}
                    />
                    <TextInput
                      accessibilityLabel="Protected folder password"
                      autoCapitalize="none"
                      secureTextEntry
                      placeholder="Folder password"
                      placeholderTextColor={colors.muted}
                      value={folderPassword}
                      onChangeText={setFolderPassword}
                      style={[
                        styles.input,
                        {
                          color: colors.foreground,
                          borderColor: colors.border,
                        },
                      ]}
                    />
                    <Pressable
                      style={[
                        styles.primaryButton,
                        (folderAuthWorking ||
                          !folderAuthId.trim() ||
                          !folderPassword) &&
                          styles.disabled,
                      ]}
                      disabled={
                        folderAuthWorking ||
                        !folderAuthId.trim() ||
                        !folderPassword
                      }
                      onPress={() => void handleUnlockProtectedFolder()}
                    >
                      <Text style={styles.primaryButtonText}>
                        {folderAuthWorking ? "Unlocking…" : "Unlock folder"}
                      </Text>
                    </Pressable>
                  </View>
                ) : (
                  <>
                    {activeQuery ? (
                      <Text
                        style={[styles.resultLabel, { color: colors.muted }]}
                      >
                        Results for “{activeQuery}”
                      </Text>
                    ) : null}
                    {loadingFiles ? (
                      <ActivityIndicator color="#1f6f78" />
                    ) : null}
                  </>
                )}
              </>
            ) : null}
          </>
        }
        ListFooterComponent={
          <>
            {canRenderFileList ? (
              <>
                {nextPageToken && !activeQuery ? (
                  <Pressable
                    style={styles.secondaryButton}
                    disabled={loadingMore}
                    onPress={() =>
                      void (showingFavorites
                        ? loadMoreFavorites()
                        : loadContents(activeFolder, "", nextPageToken))
                    }
                  >
                    <Text style={styles.secondaryButtonText}>
                      {loadingMore ? "Loading…" : "Load more"}
                    </Text>
                  </Pressable>
                ) : null}

                <Pressable
                  style={[
                    styles.primaryButton,
                    (working || activeJob) && styles.disabled,
                  ]}
                  disabled={working || activeJob}
                  onPress={() => void uploadQueue.handlePickFiles()}
                >
                  <Text style={styles.primaryButtonText}>
                    {activeJob
                      ? "Uploading…"
                      : `Upload to ${currentFolderName}`}
                  </Text>
                </Pressable>
              </>
            ) : null}

            {moveTarget ? (
              <View
                style={[
                  styles.detailCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[styles.sectionTitle, { color: colors.foreground }]}
                >
                  {moveFileIds.length > 1
                    ? `Move ${moveFileIds.length} items to a folder`
                    : `Move ${moveTarget.name ?? "item"} to a folder`}
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.driveRow}
                >
                  {drives.map((drive) => (
                    <Pressable
                      key={`move-${drive.id}`}
                      accessibilityRole="button"
                      onPress={() =>
                        void loadMoveFolder(
                          drive.id,
                          [{ id: drive.id, name: drive.name }],
                          moveFileIds,
                        )
                      }
                      style={[
                        styles.driveChip,
                        {
                          backgroundColor:
                            drive.id === moveBreadcrumbs[0]?.id
                              ? "#1f6f78"
                              : colors.surface,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.driveText,
                          {
                            color:
                              drive.id === moveBreadcrumbs[0]?.id
                                ? "#ffffff"
                                : colors.foreground,
                          },
                        ]}
                      >
                        {drive.name}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <View style={styles.breadcrumbs}>
                  {moveBreadcrumbs.map((crumb, index) => (
                    <View
                      key={`move-crumb-${crumb.id}`}
                      style={styles.crumbPart}
                    >
                      {index > 0 ? (
                        <Text
                          style={[
                            styles.crumbSeparator,
                            { color: colors.muted },
                          ]}
                        >
                          ›
                        </Text>
                      ) : null}
                      <Pressable
                        onPress={() =>
                          void loadMoveFolder(
                            crumb.id,
                            moveBreadcrumbs.slice(0, index + 1),
                            moveFileIds,
                          )
                        }
                      >
                        <Text
                          style={[
                            styles.crumbText,
                            {
                              color:
                                index === moveBreadcrumbs.length - 1
                                  ? colors.foreground
                                  : colors.accent,
                            },
                          ]}
                          numberOfLines={1}
                        >
                          {crumb.name}
                        </Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
                {moveLoading ? <ActivityIndicator color="#1f6f78" /> : null}
                {moveFolders.map((folder, index) => (
                  <Pressable
                    key={folder.id ?? `${folder.name}-${index}`}
                    accessibilityRole="button"
                    onPress={() => {
                      if (!folder.id) return;
                      const crumb = {
                        id: folder.id,
                        name: folder.name ?? "Folder",
                      };
                      void loadMoveFolder(
                        folder.id,
                        [...moveBreadcrumbs, crumb],
                        moveFileIds,
                      );
                    }}
                    style={[
                      styles.fileRow,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text style={styles.fileIcon}>▰</Text>
                    <Text
                      style={[styles.fileName, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
                      {folder.name ?? "Unnamed folder"}
                    </Text>
                    <Text style={[styles.fileChevron, { color: colors.muted }]}>
                      ›
                    </Text>
                  </Pressable>
                ))}
                {!moveLoading && moveFolders.length === 0 ? (
                  <Text style={[styles.empty, { color: colors.muted }]}>
                    No subfolders in this destination.
                  </Text>
                ) : null}
                <Pressable
                  style={[
                    styles.primaryButton,
                    (working || moveLoading || !moveFolderId) &&
                      styles.disabled,
                  ]}
                  disabled={working || moveLoading || !moveFolderId}
                  onPress={() => void confirmMove()}
                >
                  <Text style={styles.primaryButtonText}>
                    {working
                      ? "Moving…"
                      : `Move ${moveFileIds.length > 1 ? `${moveFileIds.length} items` : "here"} to ${moveBreadcrumbs.at(-1)?.name ?? "folder"}`}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  style={styles.closeButton}
                  onPress={() => {
                    cancelPendingMoveFolderRequest();
                    setMoveTarget(null);
                    setMoveFileIds([]);
                  }}
                >
                  <Text style={[styles.actionText, { color: colors.muted }]}>
                    Cancel move
                  </Text>
                </Pressable>
              </View>
            ) : null}

            <FileDetailsPanel
              selectedDetails={selectedDetails}
              colors={colors}
              fileError={fileError}
              tagsLoading={tagsLoading}
              tags={tags}
              working={working}
              userRole={userRole}
              tagDraft={tagDraft}
              setTagDraft={setTagDraft}
              favoriteIds={favoriteIds}
              downloadPercent={downloadPercent}
              downloadedUri={downloadedUri}
              previewText={previewText}
              previewKind={previewKind}
              serverUrl={server?.url}
              subtitleFiles={subtitleFiles}
              formatSize={formatSize}
              handleRemoveTag={handleRemoveTag}
              handleAddTag={handleAddTag}
              toggleFavorite={toggleFavorite}
              openMovePicker={openMovePicker}
              handleCreateShare={handleCreateShare}
              requestDelete={requestDelete}
              handleShareDownloaded={handleShareDownloaded}
              handleDownload={handleDownload}
              loadSubtitle={loadSubtitle}
              handleCloseDetails={handleCloseDetails}
            />

            <UploadJobsPanel
              jobs={jobs}
              activeJob={activeJob}
              colors={colors}
              onCancel={uploadQueue.cancelUpload}
              onRetry={uploadQueue.retryUpload}
            />
          </>
        }
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      />
    </SafeAreaView>
  );
}

function formatSize(value: string): string {
  const size = Number(value);
  if (!Number.isFinite(size) || size < 0) return value;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024)
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function themeColors(dark: boolean) {
  return dark
    ? {
        background: "#10191d",
        surface: "#18262b",
        foreground: "#eaf1f2",
        muted: "#a6b7bd",
        border: "#304249",
        accent: "#83c7ca",
      }
    : {
        background: "#f4f7f8",
        surface: "#ffffff",
        foreground: "#17252b",
        muted: "#607279",
        border: "#d9e2e5",
        accent: "#1f6f78",
      };
}
