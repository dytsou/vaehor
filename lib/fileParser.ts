export interface FileEntry {
  file: File;
  path: string;
}

interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
}

interface FileSystemFileEntryLike extends FileSystemEntryLike {
  isFile: true;
  file: (callback: (file: File) => void) => void;
}

interface FileSystemDirectoryReaderLike {
  readEntries: (callback: (entries: FileSystemEntryLike[]) => void) => void;
}

interface FileSystemDirectoryEntryLike extends FileSystemEntryLike {
  isDirectory: true;
  createReader: () => FileSystemDirectoryReaderLike;
}

function readFileFromEntry(
  fileItem: FileSystemFileEntryLike,
  path: string,
): Promise<FileEntry[]> {
  return new Promise((resolve) => {
    fileItem.file((file: File) => {
      resolve([{ file, path: path + file.name }]);
    });
  });
}

function readDirectoryBatch(
  dirReader: FileSystemDirectoryReaderLike,
): Promise<FileSystemEntryLike[]> {
  return new Promise((resolve) => {
    dirReader.readEntries(resolve);
  });
}

async function readAllDirectoryEntries(
  dirReader: FileSystemDirectoryReaderLike,
): Promise<FileSystemEntryLike[]> {
  const allEntries: FileSystemEntryLike[] = [];
  let batch = await readDirectoryBatch(dirReader);

  while (batch.length > 0) {
    allEntries.push(...batch);
    batch = await readDirectoryBatch(dirReader);
  }

  return allEntries;
}

async function traverseDirectory(
  directoryItem: FileSystemDirectoryEntryLike,
  path: string,
): Promise<FileEntry[]> {
  const dirReader = directoryItem.createReader();
  const childEntries = await readAllDirectoryEntries(dirReader);
  const childPath = path + directoryItem.name + "/";
  const childResults = await Promise.all(
    childEntries.map((entry) => traverseFileTree(entry, childPath)),
  );

  return childResults.flat();
}

async function traverseFileTree(
  item: FileSystemEntryLike,
  path: string = "",
): Promise<FileEntry[]> {
  if (item.isFile) {
    return readFileFromEntry(item as FileSystemFileEntryLike, path);
  }

  if (item.isDirectory) {
    return traverseDirectory(item as FileSystemDirectoryEntryLike, path);
  }

  return [];
}

export async function parseDroppedItems(
  dataTransfer: DataTransfer,
): Promise<FileEntry[]> {
  const items = dataTransfer.items;
  const files: FileEntry[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i].webkitGetAsEntry() as FileSystemEntryLike | null;
    if (item) {
      const result = await traverseFileTree(item);
      files.push(...result);
    }
  }
  return files;
}
