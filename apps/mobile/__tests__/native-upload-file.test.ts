import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDocumentPickerUploadFile } from "../src/lib/native-upload-file";

const fileSystem = vi.hoisted(() => {
  const handle = {
    size: 8 as number | undefined,
    offset: 0,
    readBytes: vi.fn(async (length: number) => new Uint8Array(length).fill(7)),
    close: vi.fn(),
  };
  const open = vi.fn(() => handle);
  const pickDirectoryAsync = vi.fn();
  const constructedUris: string[] = [];
  const openedModes: string[] = [];

  return { handle, open, pickDirectoryAsync, constructedUris, openedModes };
});

vi.mock("expo-file-system", () => ({
  Directory: class MockDirectory {
    static pickDirectoryAsync = fileSystem.pickDirectoryAsync;

    constructor(readonly uri: string) {}

    list() {
      return [];
    }
  },
  File: class MockFile {
    constructor(uri: string) {
      fileSystem.constructedUris.push(uri);
    }

    open(mode: string) {
      fileSystem.openedModes.push(mode);
      return fileSystem.open();
    }
  },
  FileMode: { ReadOnly: "read-only" },
  Paths: { cache: { uri: "file:///cache/" } },
}));

vi.mock("expo-document-picker", () => ({
  getDocumentAsync: vi.fn(),
}));

const asset = (overrides: Record<string, unknown> = {}) =>
  ({
    uri: "file:///picked/report.bin",
    name: "report.bin",
    mimeType: "application/octet-stream",
    size: 8,
    ...overrides,
  }) as Parameters<typeof openDocumentPickerUploadFile>[0];

describe("openDocumentPickerUploadFile", () => {
  beforeEach(() => {
    fileSystem.handle.size = 8;
    fileSystem.handle.offset = 0;
    fileSystem.handle.readBytes.mockClear();
    fileSystem.handle.close.mockClear();
    fileSystem.open.mockClear();
    fileSystem.pickDirectoryAsync.mockReset();
    fileSystem.constructedUris.length = 0;
    fileSystem.openedModes.length = 0;
  });

  it("opens the picked URI read-only and reads the requested byte range", async () => {
    const picked = openDocumentPickerUploadFile(asset());

    expect(picked.name).toBe("report.bin");
    expect(picked.mimeType).toBe("application/octet-stream");
    expect(picked.size).toBe(8);
    expect(fileSystem.constructedUris).toEqual(["file:///picked/report.bin"]);
    expect(fileSystem.openedModes).toEqual(["read-only"]);

    await expect(picked.readChunk(3, 9)).resolves.toEqual(
      new Uint8Array(6).fill(7),
    );
    expect(fileSystem.handle.offset).toBe(3);
    expect(fileSystem.handle.readBytes).toHaveBeenCalledWith(6);

    picked.close?.();
    picked.close?.();
    expect(fileSystem.handle.close).toHaveBeenCalledTimes(1);
    await expect(picked.readChunk(0, 1)).rejects.toThrow(
      "The selected file is no longer available.",
    );
  });

  it("uses the picker size when the native handle does not report one", () => {
    fileSystem.handle.size = undefined;

    expect(openDocumentPickerUploadFile(asset({ size: 23 })).size).toBe(23);
  });

  it("closes and rejects a file with an invalid size", () => {
    fileSystem.handle.size = Number.NaN;

    expect(() => openDocumentPickerUploadFile(asset())).toThrow(
      "This device could not read the selected file size.",
    );
    expect(fileSystem.handle.close).toHaveBeenCalledOnce();
  });

  it("stops reads after cancellation and falls back to the generic MIME type", async () => {
    const picked = openDocumentPickerUploadFile(
      asset({ mimeType: null, name: "unnamed.bin" }),
      "renamed.bin",
    );
    const controller = new AbortController();
    controller.abort();

    expect(picked.name).toBe("renamed.bin");
    expect(picked.mimeType).toBe("application/octet-stream");
    await expect(picked.readChunk(0, 1, controller.signal)).rejects.toThrow(
      "Upload cancelled",
    );
    expect(fileSystem.handle.readBytes).not.toHaveBeenCalled();
  });
});
