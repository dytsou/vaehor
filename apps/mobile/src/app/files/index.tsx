import { useFocusEffect, useRouter } from "expo-router";
import { File as ExpoFile } from "expo-file-system";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
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

function localStorageUnlockFailure(result: {
  success: boolean;
  protected: boolean;
  token?: string;
}): string | null {
  if (!result.success) {
    return "Could not unlock local storage. Check the password and retry.";
  }
  if (result.protected && !result.token) {
    return "The server did not return an access token. Retry the unlock.";
  }
  return null;
}

async function reportLocalStorageUnlockFailure(
  cause: unknown,
  showAuthFailure: (cause: unknown) => Promise<boolean>,
  setError: (error: string | null) => void,
): Promise<void> {
  if (cause instanceof MobileApiError && cause.status === 403) {
    setError("The local storage password is incorrect.");
    return;
  }
  if (await showAuthFailure(cause)) return;
  setError(
    cause instanceof MobileApiError
      ? cause.message
      : "Could not unlock local storage. Check your connection and retry.",
  );
}

async function reportMoreFavoritesFailure(options: {
  cause: unknown;
  isCurrent: () => boolean;
  showAuthFailure: (cause: unknown) => Promise<boolean>;
  setError: (error: string | null) => void;
}): Promise<void> {
  if (!options.isCurrent()) return;
  if (await options.showAuthFailure(options.cause)) return;
  if (!options.isCurrent()) return;
  options.setError(
    options.cause instanceof MobileApiError
      ? options.cause.message
      : "Could not load more favorites. Check your connection and retry.",
  );
}

async function finishFileDownload(options: {
  file: MobileFile;
  uri: string;
  isCurrent: () => boolean;
  setPreviewText: (value: string | null) => void;
  setDownloadedUri: (uri: string | null) => void;
  setDownloadPercent: (percent: number | null) => void;
}): Promise<void> {
  if (!options.isCurrent()) return;
  if (
    getNativePreviewKind(options.file.mimeType, options.file.name) === "text"
  ) {
    await setDownloadedTextPreview(
      options.uri,
      options.isCurrent,
      options.setPreviewText,
    );
  }
  if (!options.isCurrent()) return;
  options.setDownloadedUri(options.uri);
  options.setDownloadPercent(100);
}

type LoadMoveFolderOptions = Readonly<{
  targetFolderId: string;
  nextBreadcrumbs: Crumb[];
  excludedIds: string[];
  apiRef: { current: UploadApiSession | null };
  moveFolderRequestEpochRef: {
    current: ReturnType<typeof createAsyncRequestEpoch>;
  };
  moveFolderControllerRef: { current: AbortController | null };
  cancelPendingMoveFolderRequest: () => void;
  fetchForFolder: (folderId: string) => ServerFetch | null;
  showAuthFailure: (cause: unknown) => Promise<boolean>;
  setMoveLoading: (loading: boolean) => void;
  setFileError: (error: string | null) => void;
  setMoveFolderId: (folderId: string) => void;
  setMoveBreadcrumbs: (breadcrumbs: Crumb[]) => void;
  setMoveFolders: Dispatch<SetStateAction<MobileFile[]>>;
}>;

async function loadMoveFolderAction(
  options: LoadMoveFolderOptions,
): Promise<void> {
  const api = options.apiRef.current;
  if (!api || !options.targetFolderId) return;
  options.cancelPendingMoveFolderRequest();
  const requestEpoch = options.moveFolderRequestEpochRef.current.begin();
  const controller = new AbortController();
  options.moveFolderControllerRef.current = controller;
  const excludedIds = new Set(options.excludedIds);
  const isCurrent = () =>
    !controller.signal.aborted &&
    options.moveFolderRequestEpochRef.current.isCurrent(requestEpoch);
  options.setMoveLoading(true);
  options.setFileError(null);
  try {
    const response = await listMobileFiles(
      options.fetchForFolder(options.targetFolderId) ?? api.fetchImpl,
      { folderId: options.targetFolderId },
      controller.signal,
    );
    if (!isCurrent()) return;
    options.setMoveFolderId(options.targetFolderId);
    options.setMoveBreadcrumbs(options.nextBreadcrumbs);
    options.setMoveFolders(
      (response.files ?? []).filter(
        (file) => file.isFolder && !excludedIds.has(file.id ?? ""),
      ),
    );
  } catch (cause) {
    if (!isCurrent()) return;
    if (!(await options.showAuthFailure(cause)) && isCurrent()) {
      options.setFileError(
        cause instanceof MobileApiError
          ? cause.message
          : "Could not load destination folders. Retry or choose another folder.",
      );
    }
  } finally {
    if (options.moveFolderControllerRef.current === controller && isCurrent()) {
      options.moveFolderControllerRef.current = null;
      options.setMoveLoading(false);
    }
  }
}

async function loadSubtitleText(options: {
  api: UploadApiSession | null;
  file: MobileFile | null;
  subtitle: SubtitleFile;
  activeFolder: string;
  currentFolderAccessToken: string | undefined;
  folderTokens: Record<string, string>;
  localStorageAccessToken: string | null;
}): Promise<string> {
  const { api, file, subtitle, activeFolder, currentFolderAccessToken } =
    options;
  if (!api || !file) {
    throw new Error("The server session has ended. Select the file again.");
  }
  const parentId = file.parents?.[0] ?? activeFolder;
  const folderAccessToken =
    (file.protectedFolderId
      ? options.folderTokens[file.protectedFolderId]
      : undefined) ??
    (parentId ? options.folderTokens[parentId] : undefined) ??
    (parentId === activeFolder ? currentFolderAccessToken : undefined);
  const downloaded = await downloadMobileFile({
    origin: api.origin,
    sessionToken: api.token,
    folderAccessToken,
    localStorageAccessToken: subtitle.id.startsWith("local-storage:")
      ? (options.localStorageAccessToken ?? undefined)
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
}

async function handleBulkDownloadAction(options: {
  api: UploadApiSession | null;
  files: MobileFile[];
  selectedIds: Set<string>;
  currentFolderAccessToken: string | undefined;
  setError: (error: string | null) => void;
  setWorking: (working: boolean) => void;
  setSelectedIds: (ids: Set<string>) => void;
  setSelectionMode: (enabled: boolean) => void;
}): Promise<void> {
  const selected = options.files.filter(
    (file) => file.id && options.selectedIds.has(file.id),
  );
  if (
    !options.api ||
    selected.length !== options.selectedIds.size ||
    !selected.length
  ) {
    return;
  }
  if (selected.length > 20) {
    options.setError("Choose no more than 20 files for one archive.");
    return;
  }
  if (selected.some((file) => file.isFolder)) {
    options.setError(
      "Choose files only. Folders cannot be added to a download archive.",
    );
    return;
  }
  if (
    selected.some((file) => file.id?.startsWith("local-storage:")) ||
    options.currentFolderAccessToken
  ) {
    options.setError(
      "Bulk download is not available for local or password-protected folders. Download each permitted file separately.",
    );
    return;
  }

  options.setWorking(true);
  options.setError(null);
  try {
    const archive = await downloadMobileArchive(
      options.api.fetchImpl,
      selected.flatMap((file) => (file.id ? [file.id] : [])),
    );
    options.setSelectedIds(new Set());
    options.setSelectionMode(false);
    const sharing = await import("expo-sharing");
    if (await sharing.isAvailableAsync()) {
      await sharing.shareAsync(archive.uri, {
        mimeType: "application/zip",
        dialogTitle: "Save or share selected files",
        UTI: "com.pkware.zip-archive",
      });
    } else {
      options.setError(
        "The ZIP archive is saved in Vaehor's app documents, but this device has no available share sheet.",
      );
    }
  } catch (cause) {
    options.setError(
      cause instanceof MobileApiError
        ? cause.message
        : "Could not prepare the selected files for download.",
    );
  } finally {
    options.setWorking(false);
  }
}

async function reportFileActionFailure(options: {
  cause: unknown;
  showAuthFailure: (cause: unknown) => Promise<boolean>;
  setFileError: (error: string | null) => void;
  fallback: string;
}): Promise<void> {
  if (await options.showAuthFailure(options.cause)) return;
  options.setFileError(
    options.cause instanceof MobileApiError
      ? options.cause.message
      : options.fallback,
  );
}

async function toggleFavoriteAction(options: {
  api: UploadApiSession | null;
  fileId: string | undefined;
  favoriteIds: Set<string>;
  favoritesLoaded: boolean;
  showingFavorites: boolean;
  setFavoriteIds: Dispatch<SetStateAction<Set<string>>>;
  setFavoritesLoaded: (loaded: boolean) => void;
  setFiles: Dispatch<SetStateAction<MobileFile[]>>;
  setWorking: (working: boolean) => void;
  setFileError: (error: string | null) => void;
  showAuthFailure: (cause: unknown) => Promise<boolean>;
}): Promise<void> {
  const { api, fileId } = options;
  if (!api || !fileId) return;
  options.setWorking(true);
  options.setFileError(null);
  try {
    let currentFavorites = options.favoriteIds;
    if (!options.favoritesLoaded) {
      const response = await getMobileFavoriteIds(api.fetchImpl);
      currentFavorites = new Set(response.favoriteIds);
      options.setFavoriteIds(currentFavorites);
      options.setFavoritesLoaded(true);
    }
    const isFavorite = !currentFavorites.has(fileId);
    await setMobileFavorite(api.fetchImpl, { fileId, isFavorite });
    options.setFavoriteIds((current) => {
      const updated = new Set(current);
      if (isFavorite) updated.add(fileId);
      else updated.delete(fileId);
      return updated;
    });
    if (options.showingFavorites && !isFavorite) {
      options.setFiles((current) =>
        current.filter((file) => file.id !== fileId),
      );
    }
  } catch (cause) {
    await reportFileActionFailure({
      cause,
      showAuthFailure: options.showAuthFailure,
      setFileError: options.setFileError,
      fallback:
        "Could not update this favorite. Check your connection and retry.",
    });
  } finally {
    options.setWorking(false);
  }
}

async function toggleFolderPinAction(options: {
  api: UploadApiSession | null;
  userRole: string;
  activeFolder: string;
  pinnedFolders: MobilePinnedFolder[];
  breadcrumbs: Crumb[];
  currentFolderName: string;
  setPinnedFolders: Dispatch<SetStateAction<MobilePinnedFolder[]>>;
  setWorking: (working: boolean) => void;
  setFileError: (error: string | null) => void;
  showAuthFailure: (cause: unknown) => Promise<boolean>;
}): Promise<void> {
  const { api, activeFolder } = options;
  if (
    !api ||
    options.userRole.toUpperCase() !== "ADMIN" ||
    !activeFolder ||
    activeFolder.startsWith("local-storage:")
  ) {
    return;
  }
  const isPinned = options.pinnedFolders.some(
    (folder) => folder.id === activeFolder,
  );
  options.setWorking(true);
  options.setFileError(null);
  try {
    await setMobileFolderPinned(api.fetchImpl, activeFolder, !isPinned);
    options.setPinnedFolders((current) => {
      if (isPinned)
        return current.filter((folder) => folder.id !== activeFolder);
      const parentId = options.breadcrumbs.at(-2)?.id;
      return [
        ...current,
        {
          id: activeFolder,
          name: options.currentFolderName,
          mimeType: "application/vnd.google-apps.folder",
          parents: parentId ? [parentId] : [],
        },
      ];
    });
  } catch (cause) {
    await reportFileActionFailure({
      cause,
      showAuthFailure: options.showAuthFailure,
      setFileError: options.setFileError,
      fallback:
        "Could not update pinned folders. Check your connection and retry.",
    });
  } finally {
    options.setWorking(false);
  }
}

async function updateFileTagAction(options: {
  api: UploadApiSession | null;
  fileId: string | undefined;
  tag: string;
  userRole: string;
  add: boolean;
  setTags: Dispatch<SetStateAction<string[]>>;
  setTagDraft: (value: string) => void;
  setWorking: (working: boolean) => void;
  setFileError: (error: string | null) => void;
  showAuthFailure: (cause: unknown) => Promise<boolean>;
}): Promise<void> {
  const { api, fileId, tag } = options;
  if (
    !api ||
    !fileId ||
    fileId.startsWith("local-storage:") ||
    options.userRole.toUpperCase() !== "ADMIN" ||
    (options.add && (!tag || tag.length > 80))
  ) {
    return;
  }
  options.setWorking(true);
  options.setFileError(null);
  try {
    if (options.add) {
      await addMobileTag(api.fetchImpl, fileId, tag);
      options.setTags((current) =>
        current.includes(tag) ? current : [...current, tag],
      );
      options.setTagDraft("");
    } else {
      await removeMobileTag(api.fetchImpl, fileId, tag);
      options.setTags((current) =>
        current.filter((currentTag) => currentTag !== tag),
      );
    }
  } catch (cause) {
    const action = options.add ? "add" : "remove";
    await reportFileActionFailure({
      cause,
      showAuthFailure: options.showAuthFailure,
      setFileError: options.setFileError,
      fallback: `Could not ${action} this tag. Check your connection and retry.`,
    });
  } finally {
    options.setWorking(false);
  }
}

async function deleteSelectedFileAction(options: {
  api: UploadApiSession | null;
  fileId: string | undefined;
  setFiles: Dispatch<SetStateAction<MobileFile[]>>;
  setSelectedFile: Dispatch<SetStateAction<MobileFile | null>>;
  setFileDetails: Dispatch<SetStateAction<MobileFile | null>>;
  setDownloadedUri: (uri: string | null) => void;
  setPreviewText: (text: string | null) => void;
  setMoveTarget: Dispatch<SetStateAction<MobileFile | null>>;
  setWorking: (working: boolean) => void;
  setFileError: (error: string | null) => void;
  showAuthFailure: (cause: unknown) => Promise<boolean>;
}): Promise<void> {
  if (!options.api || !options.fileId) return;
  options.setWorking(true);
  options.setFileError(null);
  try {
    await deleteManagedMobileFile(options.api.fetchImpl, options.fileId);
    options.setFiles((current) =>
      current.filter((entry) => entry.id !== options.fileId),
    );
    options.setSelectedFile(null);
    options.setFileDetails(null);
    options.setDownloadedUri(null);
    options.setPreviewText(null);
    options.setMoveTarget(null);
  } catch (cause) {
    await reportFileActionFailure({
      cause,
      showAuthFailure: options.showAuthFailure,
      setFileError: options.setFileError,
      fallback: "Could not delete this file. Check your access and retry.",
    });
  } finally {
    options.setWorking(false);
  }
}

async function deleteSelectedFilesAction(options: {
  api: UploadApiSession | null;
  selectedIds: Set<string>;
  activeFolder: string;
  setFiles: Dispatch<SetStateAction<MobileFile[]>>;
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
  setSelectionMode: (enabled: boolean) => void;
  setSelectedFile: Dispatch<SetStateAction<MobileFile | null>>;
  setFileDetails: Dispatch<SetStateAction<MobileFile | null>>;
  setDownloadedUri: (uri: string | null) => void;
  setPreviewText: (text: string | null) => void;
  setWorking: (working: boolean) => void;
  setFileError: (error: string | null) => void;
  showAuthFailure: (cause: unknown) => Promise<boolean>;
}): Promise<void> {
  const fileIds = [...options.selectedIds];
  if (!options.api || !fileIds.length) return;
  const fileIdSet = new Set(fileIds);
  options.setWorking(true);
  options.setFileError(null);
  try {
    await deleteMobileFiles(options.api.fetchImpl, {
      fileIds,
      parentId: options.activeFolder,
    });
    options.setFiles((current) =>
      current.filter((file) => !fileIdSet.has(file.id ?? "")),
    );
    options.setSelectedIds(new Set());
    options.setSelectionMode(false);
    options.setSelectedFile(null);
    options.setFileDetails(null);
    options.setDownloadedUri(null);
    options.setPreviewText(null);
  } catch (cause) {
    await reportFileActionFailure({
      cause,
      showAuthFailure: options.showAuthFailure,
      setFileError: options.setFileError,
      fallback: "Could not delete the selected items.",
    });
  } finally {
    options.setWorking(false);
  }
}

async function loadFavoriteFilesAction(options: {
  api: UploadApiSession | null;
  selectedFileIdRef: { current: string | null };
  invalidateDownload: () => void;
  cancelPendingListRequest: () => void;
  listRequestEpochRef: { current: ReturnType<typeof createAsyncRequestEpoch> };
  listControllerRef: { current: AbortController | null };
  setSelectionMode: (enabled: boolean) => void;
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
  setSelectedFile: Dispatch<SetStateAction<MobileFile | null>>;
  setFileDetails: Dispatch<SetStateAction<MobileFile | null>>;
  setDownloadedUri: (uri: string | null) => void;
  setPreviewText: (text: string | null) => void;
  setLoadingFiles: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setNextPageToken: (token: string | undefined) => void;
  setFiles: Dispatch<SetStateAction<MobileFile[]>>;
  setFavoriteIds: Dispatch<SetStateAction<Set<string>>>;
  setFavoritesLoaded: (loaded: boolean) => void;
  setShowingFavorites: (showing: boolean) => void;
  setActiveQuery: (query: string) => void;
  setSearchInput: (query: string) => void;
  setFileError: (error: string | null) => void;
  showAuthFailure: (cause: unknown) => Promise<boolean>;
}): Promise<void> {
  const { api } = options;
  if (!api) return;
  options.selectedFileIdRef.current = null;
  options.invalidateDownload();
  options.cancelPendingListRequest();
  const requestEpoch = options.listRequestEpochRef.current.begin();
  const controller = new AbortController();
  options.listControllerRef.current = controller;
  options.setSelectionMode(false);
  options.setSelectedIds(new Set());
  options.setSelectedFile(null);
  options.setFileDetails(null);
  options.setDownloadedUri(null);
  options.setPreviewText(null);
  options.setLoadingFiles(true);
  options.setError(null);
  options.setNextPageToken(undefined);
  const isCurrent = () =>
    !controller.signal.aborted &&
    options.listRequestEpochRef.current.isCurrent(requestEpoch);
  try {
    const [response, favoriteIdsResponse] = await Promise.all([
      listMobileFavorites(api.fetchImpl, undefined, controller.signal),
      getMobileFavoriteIds(api.fetchImpl, controller.signal).catch(() => null),
    ]);
    if (!isCurrent()) return;
    options.setFiles(response.files);
    options.setNextPageToken(response.nextPageToken);
    if (favoriteIdsResponse) {
      options.setFavoriteIds(new Set(favoriteIdsResponse.favoriteIds));
      options.setFavoritesLoaded(true);
    } else {
      options.setFavoritesLoaded(false);
    }
    options.setShowingFavorites(true);
    options.setActiveQuery("");
    options.setSearchInput("");
    options.setSelectedFile(null);
    options.setFileDetails(null);
    options.setDownloadedUri(null);
    options.setFileError(null);
  } catch (cause) {
    await reportMobileListFailure(
      cause,
      isCurrent,
      options.showAuthFailure,
      options.setError,
      "Could not load favorites. Check your connection and retry.",
    );
  } finally {
    if (
      options.listControllerRef.current === controller &&
      options.listRequestEpochRef.current.isCurrent(requestEpoch)
    ) {
      options.listControllerRef.current = null;
      options.setLoadingFiles(false);
    }
  }
}

async function loadNextFavoritesPageAction(options: {
  api: UploadApiSession | null;
  nextPageToken: string | undefined;
  loadingMore: boolean;
  cancelPendingListRequest: () => void;
  listRequestEpochRef: { current: ReturnType<typeof createAsyncRequestEpoch> };
  listControllerRef: { current: AbortController | null };
  setLoadingMore: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setFiles: Dispatch<SetStateAction<MobileFile[]>>;
  setNextPageToken: (token: string | undefined) => void;
  showAuthFailure: (cause: unknown) => Promise<boolean>;
}): Promise<void> {
  const { api, nextPageToken } = options;
  if (!api || !nextPageToken || options.loadingMore) return;
  options.cancelPendingListRequest();
  const requestEpoch = options.listRequestEpochRef.current.begin();
  const controller = new AbortController();
  options.listControllerRef.current = controller;
  const isCurrent = () =>
    !controller.signal.aborted &&
    options.listRequestEpochRef.current.isCurrent(requestEpoch);
  options.setLoadingMore(true);
  options.setError(null);
  try {
    const response = await listMobileFavorites(
      api.fetchImpl,
      nextPageToken,
      controller.signal,
    );
    if (!isCurrent()) return;
    options.setFiles((current) => [...current, ...response.files]);
    options.setNextPageToken(response.nextPageToken);
  } catch (cause) {
    await reportMoreFavoritesFailure({
      cause,
      isCurrent,
      showAuthFailure: options.showAuthFailure,
      setError: options.setError,
    });
  } finally {
    if (
      options.listControllerRef.current === controller &&
      options.listRequestEpochRef.current.isCurrent(requestEpoch)
    ) {
      options.listControllerRef.current = null;
      options.setLoadingMore(false);
    }
  }
}

type FilesRouteSessionOptions = {
  isActive: () => boolean;
  controller: AbortController;
  apiRef: { current: UploadApiSession | null };
  localStorageAccessTokenRef: { current: string | null };
  redirectToServer: () => void;
  setApiReady: (ready: boolean) => void;
  setLoadingAuth: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setFavoriteIds: (ids: Set<string>) => void;
  setFavoritesLoaded: (loaded: boolean) => void;
  setServer: (server: ServerBookmark | null) => void;
  setDrives: (
    drives: { id: string; name: string; isProtected: boolean }[],
  ) => void;
  setUserRole: (role: string) => void;
  setRootFolderId: (id: string) => void;
  setFolderId: (id: string) => void;
  setBreadcrumbs: (breadcrumbs: Crumb[]) => void;
  setActiveQuery: (query: string) => void;
  setSearchInput: (query: string) => void;
  setPinnedFolders: (folders: MobilePinnedFolder[]) => void;
};

type FilesRouteSession = {
  server: ServerBookmark;
  fetchImpl: ServerFetch;
};

async function authenticateFilesRoute(
  options: FilesRouteSessionOptions,
): Promise<FilesRouteSession | null> {
  const activeServer = await getActiveServer(preferencesStore);
  if (!options.isActive()) return null;
  if (!activeServer) {
    options.redirectToServer();
    return null;
  }

  const access = await loadBiometricServerSession(activeServer);
  if (!options.isActive()) return null;
  switch (access.status) {
    case "biometrics-unavailable":
      options.setError(
        "Biometric unlock is unavailable. Return to the server screen to sign in again.",
      );
      return null;
    case "biometrics-denied":
      options.setError(
        "Biometric unlock did not succeed. Return to the server screen and try again.",
      );
      return null;
    case "authenticated":
      break;
    default:
      options.setError("Sign in to this server before browsing files.");
      options.redirectToServer();
      return null;
  }

  const fetchImpl = createServerFetch(activeServer.url, access.token);
  options.apiRef.current = {
    origin: activeServer.url,
    token: access.token,
    fetchImpl,
  };
  options.setApiReady(true);
  return { server: activeServer, fetchImpl };
}

async function loadFilesRouteData(
  session: FilesRouteSession,
  options: FilesRouteSessionOptions,
): Promise<void> {
  const localToken = await loadLocalStorageAccessTokenForServer(
    session.server.url,
  );
  if (!options.isActive()) return;
  options.localStorageAccessTokenRef.current = localToken;
  const [driveResponse, favoriteIdsResponse] = await Promise.all([
    listMobileDrives(session.fetchImpl, options.controller.signal),
    getMobileFavoriteIds(session.fetchImpl, options.controller.signal).catch(
      () => null,
    ),
  ]);
  if (!options.isActive()) return;
  if (favoriteIdsResponse) {
    options.setFavoriteIds(new Set(favoriteIdsResponse.favoriteIds));
    options.setFavoritesLoaded(true);
  }
  const root = driveResponse.drives.find(
    (drive) => drive.id === driveResponse.rootFolderId,
  );
  options.setServer(session.server);
  options.setDrives(driveResponse.drives);
  options.setUserRole(driveResponse.role);
  options.setRootFolderId(driveResponse.rootFolderId);
  options.setFolderId(driveResponse.rootFolderId);
  options.setBreadcrumbs([
    { id: driveResponse.rootFolderId, name: root?.name ?? "Home" },
  ]);
  options.setActiveQuery("");
  options.setSearchInput("");
  void listMobilePinnedFolders(session.fetchImpl, options.controller.signal)
    .then((response) => {
      if (options.isActive()) options.setPinnedFolders(response.folders);
    })
    .catch(() => undefined);
}

async function handleFilesRouteSessionFailure(
  cause: unknown,
  activeOrigin: string | null,
  options: FilesRouteSessionOptions,
): Promise<void> {
  if (!options.isActive()) return;
  const expiredSession =
    cause instanceof MobileApiError &&
    cause.status === 401 &&
    !cause.access.protected &&
    !cause.access.isLocalAuthNeeded;
  if (!expiredSession) {
    options.setError(
      cause instanceof MobileApiError
        ? cause.message
        : "Could not unlock this server. Return to the server screen and retry.",
    );
    return;
  }
  if (activeOrigin) {
    await clearSessionForServer(activeOrigin);
    await clearLocalStorageAccessTokenForServer(activeOrigin);
  }
  options.apiRef.current = null;
  options.setApiReady(false);
  options.redirectToServer();
}

async function initializeFilesRouteSession(
  options: FilesRouteSessionOptions,
): Promise<void> {
  let activeOrigin: string | null = null;
  try {
    const session = await authenticateFilesRoute(options);
    if (!session) return;
    activeOrigin = session.server.url;
    await loadFilesRouteData(session, options);
  } catch (cause) {
    await handleFilesRouteSessionFailure(cause, activeOrigin, options);
  } finally {
    if (options.isActive()) options.setLoadingAuth(false);
  }
}

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
  const reversedBreadcrumbs = [...breadcrumbs];
  reversedBreadcrumbs.reverse();
  const currentFolderAccessToken = reversedBreadcrumbs
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
      const reversedBreadcrumbs = [...breadcrumbs];
      reversedBreadcrumbs.reverse();
      const folderToken =
        folderTokensRef.current[targetFolderId] ??
        reversedBreadcrumbs
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
        await handleContentsLoadFailure(cause, {
          isCurrent: () =>
            !controller.signal.aborted &&
            listRequestEpochRef.current.isCurrent(requestEpoch),
          showAuthFailure,
          setError,
          fallback:
            "Could not load this folder. Check your connection and retry.",
          onLocalStorageAuthRequired: async () => {
            localStorageAccessTokenRef.current = null;
            setLocalAuthNeeded(true);
            setLocalPassword("");
            setFiles([]);
            setError(null);
            if (api) await clearLocalStorageAccessTokenForServer(api.origin);
          },
          onProtectedFolderRequired: (folderId) => {
            setFiles([]);
            setFolderAuthTarget({
              id: folderId,
              name: breadcrumbs.at(-1)?.name ?? "Protected folder",
            });
            setFolderPassword("");
          },
          targetFolderId,
        });
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

      void initializeFilesRouteSession({
        isActive: () => active,
        controller,
        apiRef,
        localStorageAccessTokenRef,
        redirectToServer: () => router.replace("/"),
        setApiReady,
        setLoadingAuth,
        setError,
        setFavoriteIds,
        setFavoritesLoaded,
        setServer,
        setDrives,
        setUserRole,
        setRootFolderId,
        setFolderId,
        setBreadcrumbs,
        setActiveQuery,
        setSearchInput,
        setPinnedFolders,
      });

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

  const loadFavorites = () =>
    loadFavoriteFilesAction({
      api: apiRef.current,
      selectedFileIdRef,
      invalidateDownload,
      cancelPendingListRequest,
      listRequestEpochRef,
      listControllerRef,
      setSelectionMode,
      setSelectedIds,
      setSelectedFile,
      setFileDetails,
      setDownloadedUri,
      setPreviewText,
      setLoadingFiles,
      setError,
      setNextPageToken,
      setFiles,
      setFavoriteIds,
      setFavoritesLoaded,
      setShowingFavorites,
      setActiveQuery,
      setSearchInput,
      setFileError,
      showAuthFailure,
    });

  const toggleSelected = (fileId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  };

  const loadMoreFavorites = () =>
    loadNextFavoritesPageAction({
      api: apiRef.current,
      nextPageToken,
      loadingMore,
      cancelPendingListRequest,
      listRequestEpochRef,
      listControllerRef,
      setLoadingMore,
      setError,
      setFiles,
      setNextPageToken,
      showAuthFailure,
    });

  const handleRefreshFiles = async () => {
    if (showingFavorites) {
      await loadFavorites();
      return;
    }
    await loadContents(activeFolder, activeQuery);
  };

  const handleLoadMoreFiles = async () => {
    if (showingFavorites) {
      await loadMoreFavorites();
      return;
    }
    if (!nextPageToken) return;
    await loadContents(activeFolder, "", nextPageToken);
  };

  const toggleFavorite = () =>
    toggleFavoriteAction({
      api: apiRef.current,
      fileId: selectedDetails?.id,
      favoriteIds,
      favoritesLoaded,
      showingFavorites,
      setFavoriteIds,
      setFavoritesLoaded,
      setFiles,
      setWorking,
      setFileError,
      showAuthFailure,
    });

  const toggleCurrentFolderPin = () =>
    toggleFolderPinAction({
      api: apiRef.current,
      userRole,
      activeFolder,
      pinnedFolders,
      breadcrumbs,
      currentFolderName,
      setPinnedFolders,
      setWorking,
      setFileError,
      showAuthFailure,
    });

  const handleAddTag = () =>
    updateFileTagAction({
      api: apiRef.current,
      fileId: selectedDetails?.id,
      tag: tagDraft.trim(),
      userRole,
      add: true,
      setTags,
      setTagDraft,
      setWorking,
      setFileError,
      showAuthFailure,
    });

  const handleRemoveTag = (tag: string) =>
    updateFileTagAction({
      api: apiRef.current,
      fileId: selectedDetails?.id,
      tag,
      userRole,
      add: false,
      setTags,
      setTagDraft,
      setWorking,
      setFileError,
      showAuthFailure,
    });

  const loadMoveFolder = (
    targetFolderId: string,
    nextBreadcrumbs: Crumb[],
    excludedIds = moveFileIds,
  ) =>
    loadMoveFolderAction({
      targetFolderId,
      nextBreadcrumbs,
      excludedIds,
      apiRef,
      moveFolderRequestEpochRef,
      moveFolderControllerRef,
      cancelPendingMoveFolderRequest,
      fetchForFolder,
      showAuthFailure,
      setMoveLoading,
      setFileError,
      setMoveFolderId,
      setMoveBreadcrumbs,
      setMoveFolders,
    });

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

  const performDelete = () =>
    deleteSelectedFileAction({
      api: apiRef.current,
      fileId: selectedDetails?.id,
      setFiles,
      setSelectedFile,
      setFileDetails,
      setDownloadedUri,
      setPreviewText,
      setMoveTarget,
      setWorking,
      setFileError,
      showAuthFailure,
    });

  const performBulkDelete = () =>
    deleteSelectedFilesAction({
      api: apiRef.current,
      selectedIds,
      activeFolder,
      setFiles,
      setSelectedIds,
      setSelectionMode,
      setSelectedFile,
      setFileDetails,
      setDownloadedUri,
      setPreviewText,
      setWorking,
      setFileError,
      showAuthFailure,
    });

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

    try {
      const nextBreadcrumbs = await buildPinnedFolderBreadcrumbs({
        folder,
        drives,
        rootFolderId,
        isCurrent: () => listRequestEpochRef.current.isCurrent(requestEpoch),
        loadDetails: (fileId) =>
          getMobileFileDetails(api.fetchImpl, { fileId }),
      });
      if (!nextBreadcrumbs) return;
      setFolderId(folder.id);
      setBreadcrumbs(nextBreadcrumbs);
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
      await handleFileInspectionFailure(cause, {
        isCurrent: () => selectedFileIdRef.current === requestFileId,
        file,
        activeFolder,
        showAuthFailure,
        setFileError,
        onLocalStorageAuthRequired: async () => {
          localStorageAccessTokenRef.current = null;
          setLocalAuthNeeded(true);
          setLocalPassword("");
          if (apiRef.current) {
            await clearLocalStorageAccessTokenForServer(apiRef.current.origin);
          }
        },
        onProtectedFolderRequired: (protectedFolderId) => {
          setSelectedFile({ ...file, protectedFolderId });
          setFolderAuthTarget({
            id: protectedFolderId,
            name: file.name ?? "Protected folder",
          });
          setFolderPassword("");
        },
      });
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
        setError(protectedFolderUnlockError(response.status));
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
      const unlockFailure = localStorageUnlockFailure(result);
      if (unlockFailure) {
        setError(unlockFailure);
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
      await reportLocalStorageUnlockFailure(cause, showAuthFailure, setError);
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
      await finishFileDownload({
        file,
        uri: downloaded.uri,
        isCurrent: isCurrentRequest,
        setPreviewText,
        setDownloadedUri,
        setDownloadPercent,
      });
    } catch (cause) {
      await handleDownloadFailure(cause, {
        isCurrentRequest,
        file,
        activeFolder,
        showAuthFailure,
        setFileError,
        onLocalStorageAuthRequired: async () => {
          localStorageAccessTokenRef.current = null;
          await clearLocalStorageAccessTokenForServer(api.origin);
          if (!isCurrentRequest()) return;
          setLocalAuthNeeded(true);
          setLocalPassword("");
        },
        onProtectedFolderRequired: (protectedFolderId) => {
          const protectedFile = { ...file, protectedFolderId };
          setSelectedFile(protectedFile);
          setFileDetails(protectedFile);
          setFolderAuthTarget({
            id: protectedFolderId,
            name: file.name ?? "Protected folder",
          });
          setFolderPassword("");
        },
      });
    } finally {
      if (downloadControllerRef.current === controller) {
        downloadControllerRef.current = null;
        setWorking(false);
      }
    }
  };

  const loadSubtitle = (subtitle: SubtitleFile): Promise<string> =>
    loadSubtitleText({
      api: apiRef.current,
      file: selectedDetails,
      subtitle,
      activeFolder,
      currentFolderAccessToken,
      folderTokens: folderTokensRef.current,
      localStorageAccessToken: localStorageAccessTokenRef.current,
    });

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

  const handleBulkDownload = () =>
    handleBulkDownloadAction({
      api: apiRef.current,
      files,
      selectedIds,
      currentFolderAccessToken,
      setError,
      setWorking,
      setSelectedIds,
      setSelectionMode,
    });

  const shareActions = useMemo(
    () => breadcrumbs.map((crumb, index) => ({ ...crumb, index })),
    [breadcrumbs],
  );
  const canRenderFileList =
    !loadingAuth && apiReady && !localAuthNeeded && !folderAuthTarget;

  const renderDriveSection = () => (
    <>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
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
              selected: drive.id === (breadcrumbs[0]?.id ?? rootFolderId),
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
    </>
  );

  const renderPinnedFolders = () => (
    <>
      {activeFolder === rootFolderId && pinnedFolders.length > 0 ? (
        <View>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
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
                  style={[styles.driveText, { color: colors.foreground }]}
                  numberOfLines={1}
                >
                  ▰ {folder.name ?? "Pinned folder"}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </>
  );

  const renderSearchBox = () => (
    <>
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
    </>
  );

  const renderSelectionPanel = () => (
    <>
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
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            {selectedIds.size} selected
          </Text>
          <View style={styles.buttonRow}>
            <Pressable
              accessibilityRole="button"
              disabled={!files.length || working}
              style={styles.secondaryButton}
              onPress={() =>
                setSelectedIds(
                  new Set(files.flatMap((file) => (file.id ? [file.id] : []))),
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
                  (working || selectedIds.size > 20) && styles.disabled,
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
                <Text style={styles.secondaryButtonText}>Move selected…</Text>
              </Pressable>
            ) : null}
            {selectedIds.size > 0 && userRole.toUpperCase() === "ADMIN" ? (
              <Pressable
                accessibilityRole="button"
                disabled={working}
                style={styles.secondaryButton}
                onPress={requestBulkDelete}
              >
                <Text
                  style={[styles.secondaryButtonText, { color: "#b42318" }]}
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
    </>
  );

  const renderBreadcrumbs = () => (
    <>
      <View style={styles.breadcrumbs}>
        {shareActions.map((crumb, index) => (
          <View key={`${crumb.id}-${index}`} style={styles.crumbPart}>
            {index > 0 ? (
              <Text style={[styles.crumbSeparator, { color: colors.muted }]}>
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
    </>
  );

  const renderCurrentFolderPin = () => (
    <>
      {userRole.toUpperCase() === "ADMIN" &&
      activeFolder !== rootFolderId &&
      !activeFolder.startsWith("local-storage:") ? (
        <Pressable
          accessibilityRole="button"
          disabled={working}
          onPress={() => void toggleCurrentFolderPin()}
        >
          <Text style={styles.actionText}>
            {currentFolderIsPinned ? "Unpin this folder" : "Pin this folder"}
          </Text>
        </Pressable>
      ) : null}
    </>
  );

  const renderLocalStorageUnlock = () => (
    <>
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
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Unlock local storage
          </Text>
          <Text style={[styles.fileMeta, { color: colors.muted }]}>
            Enter the local storage password configured on this server. Vaehor
            keeps the temporary access token in this device’s secure storage.
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
              {localAuthWorking ? "Unlocking…" : "Unlock local storage"}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );

  const renderProtectedFolderUnlock = () => (
    <>
      {!localAuthNeeded && folderAuthTarget ? (
        <View
          style={[
            styles.authCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
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
              (folderAuthWorking || !folderAuthId.trim() || !folderPassword) &&
                styles.disabled,
            ]}
            disabled={
              folderAuthWorking || !folderAuthId.trim() || !folderPassword
            }
            onPress={() => void handleUnlockProtectedFolder()}
          >
            <Text style={styles.primaryButtonText}>
              {folderAuthWorking ? "Unlocking…" : "Unlock folder"}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );

  const renderFileRouteProgress = () => (
    <>
      {!localAuthNeeded && !folderAuthTarget ? (
        <>
          {activeQuery ? (
            <Text style={[styles.resultLabel, { color: colors.muted }]}>
              Results for “{activeQuery}”
            </Text>
          ) : null}
          {loadingFiles ? <ActivityIndicator color="#1f6f78" /> : null}
        </>
      ) : null}
    </>
  );

  const renderFileRouteContent = () => (
    <>
      {!loadingAuth && apiReady ? (
        <>
          {renderDriveSection()}

          {renderPinnedFolders()}

          {renderSearchBox()}

          {renderSelectionPanel()}

          {renderBreadcrumbs()}

          {renderCurrentFolderPin()}

          {renderLocalStorageUnlock()}
          {renderProtectedFolderUnlock()}
          {renderFileRouteProgress()}
        </>
      ) : null}
    </>
  );

  const renderListHeader = () => (
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
            onPress={handleRefreshFiles}
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
                selectionMode ? leaveSelectionMode() : setSelectionMode(true)
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
      {loadingAuth ? <ActivityIndicator color="#1f6f78" size="large" /> : null}

      {renderFileRouteContent()}
    </>
  );
  const renderMovePicker = () => (
    <>
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
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
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
              <View key={`move-crumb-${crumb.id}`} style={styles.crumbPart}>
                {index > 0 ? (
                  <Text
                    style={[styles.crumbSeparator, { color: colors.muted }]}
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
              (working || moveLoading || !moveFolderId) && styles.disabled,
            ]}
            disabled={working || moveLoading || !moveFolderId}
            onPress={() => void confirmMove()}
          >
            <Text style={styles.primaryButtonText}>
              {moveButtonLabel(
                moveFileIds.length,
                moveBreadcrumbs.at(-1)?.name,
                working,
              )}
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
    </>
  );

  const renderListFooter = () => (
    <>
      {canRenderFileList ? (
        <>
          {nextPageToken && !activeQuery ? (
            <Pressable
              style={styles.secondaryButton}
              disabled={loadingMore}
              onPress={handleLoadMoreFiles}
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
              {activeJob ? "Uploading…" : `Upload to ${currentFolderName}`}
            </Text>
          </Pressable>
        </>
      ) : null}

      {renderMovePicker()}

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
  );

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
              {fileRowIcon(
                selectionMode,
                file.id,
                selectedIds,
                file.isFolder === true,
              )}
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
        ListHeaderComponent={renderListHeader()}
        ListFooterComponent={renderListFooter()}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      />
    </SafeAreaView>
  );
}

async function setDownloadedTextPreview(
  uri: string,
  isCurrentRequest: () => boolean,
  setPreviewText: (value: string | null) => void,
): Promise<void> {
  try {
    const textFile = new ExpoFile(uri);
    const text =
      textFile.size > MAX_TEXT_PREVIEW_BYTES
        ? "This text file is too large to preview here. Use Save or share to open it in another app."
        : await textFile.text();
    if (isCurrentRequest()) setPreviewText(text);
  } catch {
    if (isCurrentRequest()) {
      setPreviewText(
        "Text preview could not be loaded. Use Save or share to open this file in another app.",
      );
    }
  }
}

type DownloadFailureOptions = Readonly<{
  isCurrentRequest: () => boolean;
  file: MobileFile;
  activeFolder: string;
  showAuthFailure: (cause: unknown) => Promise<boolean>;
  setFileError: (message: string) => void;
  onLocalStorageAuthRequired: () => Promise<void>;
  onProtectedFolderRequired: (folderId: string) => void;
}>;

async function handleDownloadFailure(
  cause: unknown,
  options: DownloadFailureOptions,
): Promise<void> {
  if (!options.isCurrentRequest()) return;
  if (cause instanceof MobileApiError && cause.access.isLocalAuthNeeded) {
    await options.onLocalStorageAuthRequired();
    return;
  }
  if (
    cause instanceof MobileApiError &&
    (await options.showAuthFailure(cause))
  ) {
    return;
  }
  if (!options.isCurrentRequest()) return;
  if (cause instanceof MobileApiError && cause.access.protected) {
    const folderId =
      cause.access.folderId ??
      options.file.protectedFolderId ??
      options.activeFolder;
    options.onProtectedFolderRequired(folderId);
    return;
  }
  options.setFileError(
    cause instanceof MobileApiError
      ? cause.message
      : "The file could not be downloaded. Check your connection and retry.",
  );
}

type FileInspectionFailureOptions = Readonly<{
  isCurrent: () => boolean;
  file: MobileFile;
  activeFolder: string;
  showAuthFailure: (cause: unknown) => Promise<boolean>;
  setFileError: (message: string) => void;
  onLocalStorageAuthRequired: () => Promise<void>;
  onProtectedFolderRequired: (folderId: string) => void;
}>;

async function handleFileInspectionFailure(
  cause: unknown,
  options: FileInspectionFailureOptions,
): Promise<void> {
  if (!options.isCurrent()) return;
  if (cause instanceof MobileApiError && cause.access.isLocalAuthNeeded) {
    await options.onLocalStorageAuthRequired();
    return;
  }
  if (cause instanceof MobileApiError && cause.access.protected) {
    const folderId =
      cause.access.folderId ??
      options.file.protectedFolderId ??
      options.activeFolder;
    options.onProtectedFolderRequired(folderId);
    return;
  }
  if (
    cause instanceof MobileApiError &&
    (await options.showAuthFailure(cause))
  ) {
    return;
  }
  if (!options.isCurrent()) return;
  options.setFileError(
    cause instanceof MobileApiError
      ? cause.message
      : "Could not load file details. You can still try downloading the file.",
  );
}

async function reportMobileListFailure(
  cause: unknown,
  isCurrent: () => boolean,
  showAuthFailure: (cause: unknown) => Promise<boolean>,
  setError: (message: string) => void,
  fallback: string,
): Promise<void> {
  if (!isCurrent()) return;
  if (await showAuthFailure(cause)) return;
  if (!isCurrent()) return;
  setError(cause instanceof MobileApiError ? cause.message : fallback);
}

type ContentsLoadFailureOptions = Readonly<{
  isCurrent: () => boolean;
  showAuthFailure: (cause: unknown) => Promise<boolean>;
  setError: (message: string | null) => void;
  fallback: string;
  targetFolderId: string;
  onLocalStorageAuthRequired: () => Promise<void>;
  onProtectedFolderRequired: (folderId: string) => void;
}>;

async function handleContentsLoadFailure(
  cause: unknown,
  options: ContentsLoadFailureOptions,
): Promise<void> {
  if (!options.isCurrent()) return;
  if (cause instanceof MobileApiError && cause.access.isLocalAuthNeeded) {
    await options.onLocalStorageAuthRequired();
    return;
  }
  if (cause instanceof MobileApiError && cause.access.protected) {
    options.onProtectedFolderRequired(
      cause.access.folderId ?? options.targetFolderId,
    );
    return;
  }
  await reportMobileListFailure(
    cause,
    options.isCurrent,
    options.showAuthFailure,
    options.setError,
    options.fallback,
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

type PinnedFolderBreadcrumbOptions = Readonly<{
  folder: MobilePinnedFolder;
  drives: ReadonlyArray<{ id: string; name: string }>;
  rootFolderId: string;
  isCurrent: () => boolean;
  loadDetails: (fileId: string) => Promise<MobileFile>;
}>;

async function buildPinnedFolderBreadcrumbs({
  folder,
  drives,
  rootFolderId,
  isCurrent,
  loadDetails,
}: PinnedFolderBreadcrumbOptions): Promise<Crumb[] | null> {
  const path: Crumb[] = [{ id: folder.id, name: folder.name ?? "Folder" }];
  const visited = new Set([folder.id]);
  let parentId = folder.parents?.[0];
  let rootDrive: { id: string; name: string } | undefined;

  for (let depth = 0; parentId && depth < 32; depth += 1) {
    rootDrive = drives.find((drive) => drive.id === parentId);
    if (rootDrive || visited.has(parentId)) break;
    visited.add(parentId);
    const parent = await loadDetails(parentId);
    if (!isCurrent()) return null;
    path.push({ id: parent.id ?? parentId, name: parent.name ?? "Folder" });
    parentId = parent.parents?.[0];
  }

  if (!isCurrent()) return null;
  const drive =
    rootDrive ?? drives.find((candidate) => candidate.id === folder.id);
  const rootCrumb = drive
    ? { id: drive.id, name: drive.name }
    : { id: rootFolderId, name: "Home" };
  if (drive?.id === folder.id) return [rootCrumb];
  return [rootCrumb, ...path.slice().reverse()];
}

function fileRowIcon(
  selectionMode: boolean,
  fileId: string | undefined,
  selectedIds: ReadonlySet<string>,
  isFolder: boolean,
): string {
  if (selectionMode) return fileId && selectedIds.has(fileId) ? "☑" : "☐";
  if (isFolder) return "▰";
  return "▤";
}

function protectedFolderUnlockError(status: number): string {
  if (status === 401) return "The folder ID or password is incorrect.";
  if (status === 429) return "Too many attempts. Wait a moment and retry.";
  return "Could not unlock this folder. Check your connection and retry.";
}

function moveButtonLabel(
  itemCount: number,
  destination: string | undefined,
  working: boolean,
): string {
  if (working) return "Moving…";
  const itemLabel = itemCount > 1 ? `${itemCount} items` : "here";
  return `Move ${itemLabel} to ${destination ?? "folder"}`;
}
