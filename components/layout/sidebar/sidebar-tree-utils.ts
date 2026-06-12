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

export async function buildExpandedTreeForPath(options: {
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
}): Promise<FlatTree | null> {
  const pathIds = await resolveFolderPathIds(
    options.currentFolderId,
    options.rootFolderId,
    options.shareToken,
    options.locale,
    options.queryClient,
  );

  const nextTree = { ...options.treeSnapshot };
  let stateChanged = false;

  for (const folderId of [options.rootFolderId, ...pathIds]) {
    const node = nextTree[folderId];
    if (!node) {
      if (folderId === options.rootFolderId) {
        continue;
      }
      break;
    }

    if (node.isFolder && !node.isExpanded) {
      nextTree[folderId] = { ...node, isExpanded: true };
      stateChanged = true;
    }

    if (node.isFolder && node.childIds.length === 0 && !node.hasLoaded) {
      const children = await options.fetchSubfolders(folderId, nextTree);
      applyExpandedFolderChildren(nextTree, folderId, children);
      stateChanged = true;
    }
  }

  return stateChanged ? nextTree : null;
}
