type FolderAncestorNode = {
  id?: string;
  parents?: string[];
};

export async function findProtectedFolderAncestorId(
  file: FolderAncestorNode,
  protectedFolderIds: ReadonlySet<string>,
  isPrivateFolderId: (folderId: string) => boolean,
  getFolderDetails: (folderId: string) => Promise<FolderAncestorNode | null>,
  maxDepth = 20,
): Promise<string | undefined> {
  let current = file;

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const currentId = current.id;
    if (
      currentId &&
      (protectedFolderIds.has(currentId) || isPrivateFolderId(currentId))
    ) {
      return currentId;
    }

    const parentId = current.parents?.[0];
    if (!parentId) return undefined;
    if (protectedFolderIds.has(parentId) || isPrivateFolderId(parentId)) {
      return parentId;
    }

    const parent = await getFolderDetails(parentId);
    if (!parent) return undefined;
    current = parent;
  }

  return undefined;
}
