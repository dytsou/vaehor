const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

export type NavigableFile = {
  id: string;
  name: string;
  mimeType: string;
};

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    ["INPUT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable
  );
}

export function moveFocusDown(fileCount: number) {
  return (previousIndex: number) =>
    previousIndex < fileCount - 1 ? previousIndex + 1 : previousIndex;
}

export function moveFocusUp() {
  return (previousIndex: number) => (previousIndex > 0 ? previousIndex - 1 : 0);
}

export function openFocusedFile(
  focusedIndex: number,
  files: NavigableFile[],
  navigateTo: (path: string) => void,
  onFileOpen?: (file: NavigableFile) => void,
) {
  if (focusedIndex < 0 || focusedIndex >= files.length) {
    return;
  }

  const file = files[focusedIndex];
  if (file.mimeType === FOLDER_MIME_TYPE) {
    navigateTo(`/folder/${file.id}`);
    return;
  }

  onFileOpen?.(file);
}

export function shouldNavigateBackOnBackspace(pathname: string): boolean {
  return pathname !== "/" && !pathname.startsWith("/admin");
}

export function handleBackspaceKey(
  event: KeyboardEvent,
  searchBuffer: string,
  pathname: string,
  trimSearchBuffer: () => void,
  navigateBack: () => void,
) {
  if (searchBuffer.length > 0) {
    trimSearchBuffer();
    return;
  }

  if (!shouldNavigateBackOnBackspace(pathname)) {
    return;
  }

  event.preventDefault();
  navigateBack();
}

export function isTypeaheadKey(event: KeyboardEvent): boolean {
  return (
    event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey
  );
}

export function findTypeaheadMatchIndex(
  files: NavigableFile[],
  buffer: string,
): number {
  return files.findIndex((file) => file.name.toLowerCase().startsWith(buffer));
}

export function applyTypeaheadKey(
  event: KeyboardEvent,
  searchBuffer: string,
  files: NavigableFile[],
  setSearchBuffer: (value: string) => void,
  setFocusedIndex: (index: number) => void,
  resetSearchBufferSoon: () => void,
) {
  if (!isTypeaheadKey(event)) {
    return;
  }

  const newBuffer = searchBuffer + event.key.toLowerCase();
  setSearchBuffer(newBuffer);

  const matchIndex = findTypeaheadMatchIndex(files, newBuffer);
  if (matchIndex !== -1) {
    setFocusedIndex(matchIndex);
  }

  resetSearchBufferSoon();
}
