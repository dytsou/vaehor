import { beforeEach, describe, expect, it, vi } from "vitest";
import { Directory as ExpoDirectory } from "expo-file-system";
import { pickScheduledUploadDirectory } from "../src/lib/native-upload-file";

const fileSystem = vi.hoisted(() => {
  const directories: Record<string, string[]> = {};
  const files: Record<string, { size: number; bytes: number }> = {};
  const handles: Array<{ close: ReturnType<typeof vi.fn> }> = [];
  const pickDirectoryAsync = vi.fn();
  return { directories, files, handles, pickDirectoryAsync };
});

vi.mock("expo-file-system", () => {
  class MockFile {
    constructor(readonly uri: string) {}

    get name() {
      return this.uri.split("/").at(-1) ?? "file";
    }

    open() {
      const details = fileSystem.files[this.uri] ?? { size: 0, bytes: 0 };
      const handle = {
        size: details.size,
        offset: 0,
        readBytes: vi.fn((length: number) =>
          new Uint8Array(Math.min(length, details.size)).fill(details.bytes),
        ),
        close: vi.fn(),
      };
      fileSystem.handles.push(handle);
      return handle;
    }
  }

  class MockDirectory {
    static pickDirectoryAsync = fileSystem.pickDirectoryAsync;

    constructor(readonly uri: string) {}

    get name() {
      return this.uri.split("/").at(-1) ?? "folder";
    }

    list() {
      return (fileSystem.directories[this.uri] ?? []).map((uri) =>
        Object.hasOwn(fileSystem.directories, uri)
          ? new MockDirectory(uri)
          : new MockFile(uri),
      );
    }
  }

  return {
    Directory: MockDirectory,
    File: MockFile,
    FileMode: { ReadOnly: "read-only" },
    Paths: { cache: { uri: "file:///cache/" } },
  };
});

vi.mock("expo-document-picker", () => ({
  getDocumentAsync: vi.fn(),
}));

describe("native scheduled folder selection", () => {
  beforeEach(() => {
    for (const key of Object.keys(fileSystem.directories)) {
      delete fileSystem.directories[key];
    }
    for (const key of Object.keys(fileSystem.files)) {
      delete fileSystem.files[key];
    }
    fileSystem.handles.length = 0;
    fileSystem.pickDirectoryAsync.mockReset();
  });

  it("preserves sorted nested paths, sizes and MIME defaults while retaining handles", async () => {
    fileSystem.pickDirectoryAsync.mockResolvedValue(
      new ExpoDirectory("content://root"),
    );
    fileSystem.directories["content://root"] = [
      "content://root/notes.txt",
      "content://root/nested",
      "content://root/empty",
    ];
    fileSystem.directories["content://root/nested"] = [
      "content://root/nested/report.pdf",
      "content://root/nested/mystery.zzz",
    ];
    fileSystem.directories["content://root/empty"] = [];
    fileSystem.files["content://root/notes.txt"] = { size: 3, bytes: 1 };
    fileSystem.files["content://root/nested/report.pdf"] = {
      size: 5,
      bytes: 2,
    };
    fileSystem.files["content://root/nested/mystery.zzz"] = {
      size: 2,
      bytes: 3,
    };

    const selection = await pickScheduledUploadDirectory();

    expect(
      selection?.entries.map(({ path, kind, size, contentType }) => ({
        path,
        kind,
        size,
        contentType,
      })),
    ).toEqual([
      { path: "root/empty", kind: "folder", size: 0, contentType: undefined },
      { path: "root/nested", kind: "folder", size: 0, contentType: undefined },
      {
        path: "root/nested/mystery.zzz",
        kind: "file",
        size: 2,
        contentType: "application/octet-stream",
      },
      {
        path: "root/nested/report.pdf",
        kind: "file",
        size: 5,
        contentType: "application/pdf",
      },
      {
        path: "root/notes.txt",
        kind: "file",
        size: 3,
        contentType: "text/plain",
      },
    ]);
    expect(fileSystem.handles).toHaveLength(3);

    selection?.release();
    expect(
      fileSystem.handles.every(({ close }) => close.mock.calls.length === 1),
    ).toBe(true);
  });

  it("treats picker cancellation as recoverable without creating a selection", async () => {
    fileSystem.pickDirectoryAsync.mockRejectedValue({ code: "ERR_CANCELED" });

    await expect(pickScheduledUploadDirectory()).resolves.toBeNull();
  });

  it("returns a recoverable error when access to a selected folder is denied", async () => {
    fileSystem.pickDirectoryAsync.mockRejectedValue(
      new Error("Permission denied"),
    );

    await expect(pickScheduledUploadDirectory()).rejects.toMatchObject({
      name: "NativeFolderPickerError",
      recoverable: true,
    });
  });
});
