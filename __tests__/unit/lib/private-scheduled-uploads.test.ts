import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PrivateScheduledUploadStorage,
  normalizeManifestPath,
  validateScheduledUploadManifest,
} from "@/lib/storage/private-scheduled-uploads";

const scheduleId = "scheduled-test-123";
const storageKey = "blob-test-123";

function streamOf(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("private scheduled upload storage", () => {
  let root: string;
  let storage: PrivateScheduledUploadStorage;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "vaehor-scheduled-"));
    storage = new PrivateScheduledUploadStorage({
      rootDirectory: path.join(root, "private"),
      maxFileBytes: 1024,
      maxPackageBytes: 2048,
      reserveFreeBytes: 0,
      freeBytes: async () => 1024 * 1024,
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("streams nested package files privately and reads back verified bytes", async () => {
    const bytes = new TextEncoder().encode("private nested content");
    const manifest = validateScheduledUploadManifest([
      {
        path: "photos/2026/image.txt",
        kind: "file",
        size: bytes.byteLength,
        sha256: sha256(bytes),
      },
      { path: "photos", kind: "folder", size: 0 },
      { path: "photos/2026", kind: "folder", size: 0 },
    ]);

    const staged = await storage.writeStream({
      scheduleId,
      storageKey,
      body: streamOf(bytes),
      expectedSize: bytes.byteLength,
      expectedSha256: sha256(bytes),
    });
    const storedPath = path.join(
      root,
      "private",
      scheduleId,
      `${storageKey}.blob`,
    );

    expect(manifest.items[0]?.path).toBe("photos/2026/image.txt");
    expect(staged).toEqual({ size: bytes.byteLength, sha256: sha256(bytes) });
    expect(await readFile(storedPath, "utf8")).toBe("private nested content");
    expect(
      await new Response(
        await storage.readStream(scheduleId, storageKey),
      ).text(),
    ).toBe("private nested content");
    expect(
      await new Response(
        await storage.readStream(scheduleId, storageKey, { start: 8, end: 13 }),
      ).text(),
    ).toBe("nested");
    expect(
      await storage.verifyFile({
        scheduleId,
        storageKey,
        expectedSize: bytes.byteLength,
        expectedSha256: sha256(bytes),
      }),
    ).toBe(true);
  });

  it("calculates a file hash while streaming when the client omits it", async () => {
    const bytes = new TextEncoder().encode("server hashed content");
    const manifest = validateScheduledUploadManifest([
      { path: "report.txt", kind: "file", size: bytes.byteLength },
    ]);

    const staged = await storage.writeStream({
      scheduleId,
      storageKey,
      body: streamOf(bytes),
      expectedSize: bytes.byteLength,
    });

    expect(manifest.items[0]?.sha256).toBeUndefined();
    expect(staged).toEqual({ size: bytes.byteLength, sha256: sha256(bytes) });
  });

  it.each([
    "../secret.txt",
    "/etc/passwd",
    "C:\\private\\secret.txt",
    "folder/../../secret.txt",
  ])("rejects unsafe manifest path %s", (manifestPath) => {
    expect(() => normalizeManifestPath(manifestPath)).toThrow();
  });

  it("rejects duplicate normalized paths and file/folder conflicts", () => {
    expect(() =>
      validateScheduledUploadManifest([
        {
          path: "photos//image.jpg",
          kind: "file",
          size: 1,
          sha256: "a".repeat(64),
        },
        {
          path: "photos/image.jpg",
          kind: "file",
          size: 1,
          sha256: "a".repeat(64),
        },
      ]),
    ).toThrow(/duplicate/i);
    expect(() =>
      validateScheduledUploadManifest([
        { path: "photos", kind: "file", size: 1, sha256: "a".repeat(64) },
        {
          path: "photos/image.jpg",
          kind: "file",
          size: 1,
          sha256: "a".repeat(64),
        },
      ]),
    ).toThrow(/conflict/i);
  });

  it("rejects manifest entries whose parent folders are missing", () => {
    expect(() =>
      validateScheduledUploadManifest([
        {
          path: "photos/2026/image.jpg",
          kind: "file",
          size: 1,
          sha256: "a".repeat(64),
        },
        { path: "photos/2026", kind: "folder", size: 0 },
      ]),
    ).toThrow(/missing parent folder/i);
  });

  it("rejects symlink escapes, oversized files, hash mismatches, and low free space", async () => {
    const outside = path.join(root, "outside");
    const storageRoot = path.join(root, "private");
    await mkdir(storageRoot, { recursive: true });
    await mkdir(outside, { recursive: true });
    await symlink(outside, path.join(storageRoot, scheduleId), "dir");

    const bytes = new TextEncoder().encode("safe");
    await expect(
      storage.writeStream({
        scheduleId,
        storageKey,
        body: streamOf(bytes),
        expectedSize: bytes.length,
        expectedSha256: sha256(bytes),
      }),
    ).rejects.toThrow(/symlink|outside/i);
    await expect(
      storage.writeStream({
        scheduleId: "scheduled-other",
        storageKey,
        body: streamOf(bytes),
        expectedSize: 1025,
        expectedSha256: sha256(bytes),
      }),
    ).rejects.toThrow(/size|limit/i);
    await expect(
      storage.writeStream({
        scheduleId: "scheduled-other",
        storageKey,
        body: streamOf(bytes),
        expectedSize: bytes.length,
        expectedSha256: "b".repeat(64),
      }),
    ).rejects.toThrow(/hash/i);

    const noSpace = new PrivateScheduledUploadStorage({
      rootDirectory: path.join(root, "no-space"),
      reserveFreeBytes: 100,
      freeBytes: async () => 50,
    });
    await expect(
      noSpace.writeStream({
        scheduleId,
        storageKey,
        body: streamOf(bytes),
        expectedSize: bytes.length,
        expectedSha256: sha256(bytes),
      }),
    ).rejects.toThrow(/space|capacity/i);
  });
});
