import type { QueryClient } from "@tanstack/react-query";
import { fetchFolderPathApi } from "@/hooks/useFileFetching";
import type { FlatTree, FolderNode } from "./types";

export interface FolderChildrenResult {
  id: string;
  children: FolderNode[];
}

interface FolderPathItem {
  id: string;
  name: string;
}

export function mergeChildIntoTree(next: FlatTree, child: FolderNode) {
  if (!next[child.id]) {
    next[child.id] = child;
    return;
  }

  next[child.id] = {
    ...next[child.id],
    name: child.name,
    isProtected: child.isProtected,
    isFolder: child.isFolder,
    parentId: child.parentId,
  };
}

export function appendNewChildrenOnly(next: FlatTree, children: FolderNode[]) {
  for (const child of children) {
    if (!next[child.id]) {
      next[child.id] = child;
    }
  }
}

export function applyToggleLoadResult(
  next: FlatTree,
  nodeId: string,
  children: FolderNode[],
) {
  next[nodeId] = {
    ...next[nodeId],
    childIds: children.map((child) => child.id),
    isLoading: false,
    isExpanded: true,
    hasLoaded: true,
  };
  appendNewChildrenOnly(next, children);
}

export function applyToggleLoadResultToTree(
  prev: FlatTree,
  nodeId: string,
  children: FolderNode[],
): FlatTree {
  const nextTree = { ...prev };
  applyToggleLoadResult(nextTree, nodeId, children);
  return nextTree;
}

export function applyResyncFolderChildren(
  next: FlatTree,
  folderId: string,
  children: FolderNode[],
) {
  if (!next[folderId]) {
    return;
  }

  next[folderId] = {
    ...next[folderId],
    childIds: children.map((child) => child.id),
    hasLoaded: true,
    isLoading: false,
  };

  for (const child of children) {
    mergeChildIntoTree(next, child);
  }
}

export function mergeResyncResultsIntoTree(
  prev: FlatTree,
  results: FolderChildrenResult[],
): FlatTree {
  const next = { ...prev };
  for (const { id, children } of results) {
    applyResyncFolderChildren(next, id, children);
  }
  return next;
}

export function collectLoadedFolderIdsToResync(
  snapshot: FlatTree,
  currentFolderId: string | null,
  rootFolderId: string,
): string[] {
  const ids = new Set<string>();
  if (currentFolderId && snapshot[currentFolderId]?.hasLoaded) {
    ids.add(currentFolderId);
  }
  if (snapshot[rootFolderId]?.hasLoaded) {
    ids.add(rootFolderId);
  }
  return [...ids];
}

export async function fetchChildrenForFolders(
  folderIds: string[],
  fetchSubfolders: (
    parentId: string,
    treeForBearer?: FlatTree,
  ) => Promise<FolderNode[]>,
): Promise<FolderChildrenResult[]> {
  return Promise.all(
    folderIds.map(async (id) => ({
      id,
      children: await fetchSubfolders(id),
    })),
  );
}

function applyExpandedFolderChildren(
  nextTree: FlatTree,
  folderId: string,
  children: FolderNode[],
) {
  nextTree[folderId] = {
    ...nextTree[folderId],
    childIds: children.map((child) => child.id),
    hasLoaded: true,
  };
  appendNewChildrenOnly(nextTree, children);
}

async function resolveFolderPathIds(
  currentFolderId: string | null,
  rootFolderId: string,
  shareToken: string | null,
  locale: string,
  queryClient: QueryClient,
): Promise<string[]> {
  if (!currentFolderId || currentFolderId === rootFolderId) {
    return [];
  }

  const pathData = await queryClient.fetchQuery({
    queryKey: ["folderPath", currentFolderId, shareToken, locale],
    queryFn: () => fetchFolderPathApi(currentFolderId, shareToken, locale),
    staleTime: 5 * 60 * 1000,
  });

  if (!Array.isArray(pathData)) {
    return [];
  }

  return pathData.map((pathItem: FolderPathItem) => pathItem.id);
}

export interface BuildExpandedTreeOptions {
  currentFolderId: string | null;
  rootFolderId: string;
  shareToken: string | null;
  locale: string;
  queryClient: QueryClient;
  treeSnapshot: FlatTree;
  fetchSubfolders: (
    parentId: string,
    treeForBearer?: FlatTree,
  ) => Promise<FolderNode[]>;
}

type PathFolderProcessResult = "unchanged" | "changed" | "continue" | "break";

function expandFolderNode(
  nextTree: FlatTree,
  folderId: string,
  node: FolderNode,
): boolean {
  if (!node.isFolder || node.isExpanded) {
    return false;
  }

  nextTree[folderId] = { ...node, isExpanded: true };
  return true;
}

function folderNeedsChildLoad(node: FolderNode): boolean {
  return node.isFolder && node.childIds.length === 0 && !node.hasLoaded;
}

async function loadFolderChildren(
  nextTree: FlatTree,
  folderId: string,
  fetchSubfolders: BuildExpandedTreeOptions["fetchSubfolders"],
): Promise<void> {
  const children = await fetchSubfolders(folderId, nextTree);
  applyExpandedFolderChildren(nextTree, folderId, children);
}

async function processPathFolder(
  nextTree: FlatTree,
  folderId: string,
  rootFolderId: string,
  fetchSubfolders: BuildExpandedTreeOptions["fetchSubfolders"],
): Promise<PathFolderProcessResult> {
  const node = nextTree[folderId];
  if (!node) {
    return folderId === rootFolderId ? "continue" : "break";
  }

  let changed = expandFolderNode(nextTree, folderId, node);

  if (folderNeedsChildLoad(node)) {
    await loadFolderChildren(nextTree, folderId, fetchSubfolders);
    changed = true;
  }

  return changed ? "changed" : "unchanged";
}

async function expandTreeAlongPath(
  nextTree: FlatTree,
  folderIds: string[],
  rootFolderId: string,
  fetchSubfolders: BuildExpandedTreeOptions["fetchSubfolders"],
): Promise<boolean> {
  let stateChanged = false;

  for (const folderId of folderIds) {
    const result = await processPathFolder(
      nextTree,
      folderId,
      rootFolderId,
      fetchSubfolders,
    );

    if (result === "break") {
      break;
    }
    if (result === "changed") {
      stateChanged = true;
    }
  }

  return stateChanged;
}

export async function buildExpandedTreeForPath(
  options: BuildExpandedTreeOptions,
): Promise<FlatTree | null> {
  const pathIds = await resolveFolderPathIds(
    options.currentFolderId,
    options.rootFolderId,
    options.shareToken,
    options.locale,
    options.queryClient,
  );

  const nextTree = { ...options.treeSnapshot };
  const stateChanged = await expandTreeAlongPath(
    nextTree,
    [options.rootFolderId, ...pathIds],
    options.rootFolderId,
    options.fetchSubfolders,
  );

  return stateChanged ? nextTree : null;
}

export async function runSidebarTreeExpandPath(
  options: BuildExpandedTreeOptions & {
    onExpand: (tree: FlatTree) => void;
  },
): Promise<void> {
  try {
    const nextTree = await buildExpandedTreeForPath(options);
    if (nextTree) {
      options.onExpand(nextTree);
    }
  } catch (error) {
    console.error("Error expanding tree:", error);
  }
}
