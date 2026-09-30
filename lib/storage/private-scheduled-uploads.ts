import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  stat,
  statfs,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;
const STORAGE_KEY_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;
const MAX_IO_CHUNK_BYTES = 64 * 1024;

export interface ScheduledUploadManifestEntryInput {
  path: string;
  kind: "file" | "folder";
  size: number;
  sha256?: string;
  contentType?: string;
}

export interface ScheduledUploadManifestEntry
  extends ScheduledUploadManifestEntryInput {
  path: string;
  sha256?: string;
  contentType?: string;
}

export interface ScheduledUploadLimits {
  maxFileBytes: number;
  maxPackageBytes: number;
  maxItems: number;
  reserveFreeBytes: number;
}

export interface ValidatedScheduledUploadManifest {
  items: ScheduledUploadManifestEntry[];
  totalBytes: number;
}

export interface PrivateScheduledUploadStorageOptions {
  rootDirectory?: string;
  maxFileBytes?: number;
  maxPackageBytes?: number;
  maxItems?: number;
  reserveFreeBytes?: number;
  freeBytes?: (directory: string) => Promise<number>;
}

export interface WriteScheduledUploadInput {
  scheduleId: string;
  storageKey: string;
  body: ReadableStream<Uint8Array> | null;
  expectedSize: number;
  expectedSha256?: string;
  onProgress?: (bytesWritten: number) => Promise<void> | void;
}

export interface ScheduledUploadReadRange {
  start: number;
  end: number;
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getScheduledUploadLimits(): ScheduledUploadLimits {
  return {
    maxFileBytes: positiveInteger(
      process.env.SCHEDULED_UPLOAD_MAX_FILE_BYTES,
      5 * GiB,
    ),
    maxPackageBytes: positiveInteger(
      process.env.SCHEDULED_UPLOAD_MAX_PACKAGE_BYTES,
      10 * GiB,
    ),
    maxItems: positiveInteger(process.env.SCHEDULED_UPLOAD_MAX_ITEMS, 1000),
    reserveFreeBytes: positiveInteger(
      process.env.SCHEDULED_UPLOAD_MIN_FREE_BYTES,
      256 * MiB,
    ),
  };
}

function isWithinRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function assertOpaqueKey(key: string, label: string) {
  if (!STORAGE_KEY_PATTERN.test(key)) {
    throw new Error(`Invalid private scheduled upload ${label}.`);
  }
}

export function normalizeManifestPath(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024) {
    throw new Error(
      "Manifest paths must contain between 1 and 1024 characters.",
    );
  }

  if (value.includes("\0") || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("Manifest paths cannot contain control characters.");
  }

  const portable = value.replaceAll("\\", "/");
  if (portable.startsWith("/") || /^[a-zA-Z]:/.test(portable)) {
    throw new Error("Manifest paths cannot be absolute.");
  }

  const segments = portable.split("/").filter((segment) => segment.length > 0);
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("Manifest paths cannot contain traversal segments.");
  }
  if (segments.some((segment) => segment.length > 255)) {
    throw new Error("Manifest path components cannot exceed 255 characters.");
  }

  return segments.join("/");
}

export function validateScheduledUploadManifest(
  input: readonly ScheduledUploadManifestEntryInput[],
  limits: Pick<
    ScheduledUploadLimits,
    "maxFileBytes" | "maxPackageBytes" | "maxItems"
  > = getScheduledUploadLimits(),
): ValidatedScheduledUploadManifest {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error(
      "A scheduled upload must contain at least one manifest item.",
    );
  }
  if (input.length > limits.maxItems) {
    throw new Error(`The package exceeds the ${limits.maxItems} item limit.`);
  }

  let totalBytes = 0;
  const paths = new Map<string, ScheduledUploadManifestEntry>();
  const items = input.map((entry) => {
    if (!entry || (entry.kind !== "file" && entry.kind !== "folder")) {
      throw new Error("Every manifest item must be a file or folder.");
    }
    const normalizedPath = normalizeManifestPath(entry.path);
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new Error(`Manifest item ${normalizedPath} has an invalid size.`);
    }

    const item: ScheduledUploadManifestEntry = {
      path: normalizedPath,
      kind: entry.kind,
      size: entry.size,
    };

    if (entry.kind === "file") {
      if (entry.size > limits.maxFileBytes) {
        throw new Error(
          `Manifest item ${normalizedPath} exceeds the file size limit.`,
        );
      }
      if (
        entry.sha256 !== undefined &&
        (typeof entry.sha256 !== "string" ||
          !/^[a-f\d]{64}$/i.test(entry.sha256))
      ) {
        throw new Error(
          `Manifest item ${normalizedPath} must include a SHA-256 hash.`,
        );
      }
      if (entry.sha256 !== undefined) {
        item.sha256 = entry.sha256.toLowerCase();
      }
      if (entry.contentType !== undefined) {
        if (
          typeof entry.contentType !== "string" ||
          entry.contentType.length > 255
        ) {
          throw new Error(
            `Manifest item ${normalizedPath} has an invalid content type.`,
          );
        }
        item.contentType = entry.contentType;
      }
      totalBytes += entry.size;
      if (
        !Number.isSafeInteger(totalBytes) ||
        totalBytes > limits.maxPackageBytes
      ) {
        throw new Error("The package exceeds the configured size limit.");
      }
    } else if (entry.size !== 0 || entry.sha256 !== undefined) {
      throw new Error(
        `Folder manifest item ${normalizedPath} must have size zero and no hash.`,
      );
    }

    const existing = paths.get(normalizedPath);
    if (existing) {
      throw new Error(`Duplicate normalized manifest path: ${normalizedPath}.`);
    }
    paths.set(normalizedPath, item);
    return item;
  });

  for (const item of items) {
    const segments = item.path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      const parentPath = segments.slice(0, index).join("/");
      const parent = paths.get(parentPath);
      if (!parent) {
        throw new Error(
          `Manifest path conflict: ${parentPath} is a missing parent folder.`,
        );
      }
      if (parent.kind === "file") {
        throw new Error(
          `Manifest path conflict: ${parentPath} is a file parent.`,
        );
      }
    }
    if (item.kind === "file") {
      const descendantPrefix = `${item.path}/`;
      if (items.some((other) => other.path.startsWith(descendantPrefix))) {
        throw new Error(
          `Manifest path conflict: ${item.path} is also a parent folder.`,
        );
      }
    }
  }

  return { items, totalBytes };
}

export class PrivateScheduledUploadStorage {
  private readonly rootDirectory: string;
  private readonly limits: ScheduledUploadLimits;
  private readonly freeBytes: (directory: string) => Promise<number>;

  constructor(options: PrivateScheduledUploadStorageOptions = {}) {
    const limits = getScheduledUploadLimits();
    this.rootDirectory = path.resolve(
      /* turbopackIgnore: true */
      options.rootDirectory ??
        process.env.PRIVATE_SCHEDULED_UPLOADS_PATH ??
        path.join(process.cwd(), ".private-data", "scheduled-uploads"),
    );
    this.limits = {
      maxFileBytes: options.maxFileBytes ?? limits.maxFileBytes,
      maxPackageBytes: options.maxPackageBytes ?? limits.maxPackageBytes,
      maxItems: options.maxItems ?? limits.maxItems,
      reserveFreeBytes: options.reserveFreeBytes ?? limits.reserveFreeBytes,
    };
    this.freeBytes =
      options.freeBytes ??
      (async (directory) => {
        const info = await statfs(directory);
        return info.bavail * info.bsize;
      });
  }

  getLimits() {
    return { ...this.limits };
  }

  async assertPackageCapacity(requiredBytes: number) {
    if (!Number.isSafeInteger(requiredBytes) || requiredBytes < 0) {
      throw new Error("Scheduled upload size is invalid.");
    }
    if (requiredBytes > this.limits.maxPackageBytes) {
      throw new Error("The package exceeds the configured size limit.");
    }
    const root = await this.ensureRoot();
    const free = await this.freeBytes(root);
    if (
      !Number.isFinite(free) ||
      free - requiredBytes < this.limits.reserveFreeBytes
    ) {
      throw new Error("Insufficient private staging capacity is available.");
    }
  }

  async writeStream(input: WriteScheduledUploadInput) {
    assertOpaqueKey(input.scheduleId, "schedule key");
    assertOpaqueKey(input.storageKey, "storage key");
    if (!input.body) throw new Error("A streamed file body is required.");
    if (
      !Number.isSafeInteger(input.expectedSize) ||
      input.expectedSize < 0 ||
      input.expectedSize > this.limits.maxFileBytes
    ) {
      throw new Error("The file size is outside the configured limit.");
    }
    if (
      input.expectedSha256 !== undefined &&
      !/^[a-f\d]{64}$/i.test(input.expectedSha256)
    ) {
      throw new Error("A valid expected SHA-256 hash is required.");
    }

    const directory = await this.ensureScheduleDirectory(input.scheduleId);
    await this.assertPackageCapacity(input.expectedSize);
    const temporaryPath = path.join(directory, `.${randomUUID()}.partial`);
    const finalPath = path.join(directory, `${input.storageKey}.blob`);
    let fileHandle: Awaited<ReturnType<typeof open>> | undefined;
    let receivedBytes = 0;
    const hash = createHash("sha256");

    try {
      fileHandle = await open(
        temporaryPath,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600,
      );

      const reader = input.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          for (
            let offset = 0;
            offset < value.byteLength;
            offset += MAX_IO_CHUNK_BYTES
          ) {
            const chunk = value.subarray(offset, offset + MAX_IO_CHUNK_BYTES);
            receivedBytes += chunk.byteLength;
            if (receivedBytes > input.expectedSize) {
              throw new Error("The streamed file exceeds its declared size.");
            }
            hash.update(chunk);
            await fileHandle.write(chunk);
          }
          await input.onProgress?.(receivedBytes);
        }
      } finally {
        reader.releaseLock();
      }

      if (receivedBytes !== input.expectedSize) {
        throw new Error("The streamed file size does not match its manifest.");
      }
      const actualHash = hash.digest("hex");
      if (
        input.expectedSha256 !== undefined &&
        actualHash !== input.expectedSha256.toLowerCase()
      ) {
        throw new Error(
          "The streamed file SHA-256 hash does not match its manifest.",
        );
      }

      await fileHandle.sync();
      await fileHandle.close();
      fileHandle = undefined;

      const checkedDirectory = await this.ensureScheduleDirectory(
        input.scheduleId,
      );
      if (checkedDirectory !== directory) {
        throw new Error("The private staging directory changed while writing.");
      }
      await rename(temporaryPath, finalPath);
      const directoryHandle = await open(directory, constants.O_RDONLY);
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }

      return { size: receivedBytes, sha256: actualHash };
    } catch (error) {
      await fileHandle?.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  async readStream(
    scheduleId: string,
    storageKey: string,
    range?: ScheduledUploadReadRange,
  ) {
    if (
      range &&
      (!Number.isSafeInteger(range.start) ||
        range.start < 0 ||
        !Number.isSafeInteger(range.end) ||
        range.end < range.start)
    ) {
      throw new Error("The private staged file range is invalid.");
    }
    const directory = await this.ensureScheduleDirectory(scheduleId);
    assertOpaqueKey(storageKey, "storage key");
    const filePath = path.join(directory, `${storageKey}.blob`);
    const fileStats = await lstat(filePath);
    if (!fileStats.isFile() || fileStats.isSymbolicLink()) {
      throw new Error("The private staged file is unavailable.");
    }
    const checkedPath = await realpath(filePath);
    const root = await this.ensureRoot();
    if (!isWithinRoot(root, checkedPath)) {
      throw new Error("The private staged file escaped its storage root.");
    }

    const fileHandle = await open(
      filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const openedFileStats = await fileHandle.stat();
      if (!openedFileStats.isFile()) {
        throw new Error("The private staged file is unavailable.");
      }
      return Readable.toWeb(
        fileHandle.createReadStream({ autoClose: true, ...range }),
      ) as ReadableStream<Uint8Array>;
    } catch (error) {
      await fileHandle.close().catch(() => undefined);
      throw error;
    }
  }

  async verifyFile(input: {
    scheduleId: string;
    storageKey: string;
    expectedSize: number;
    expectedSha256: string;
  }) {
    const filePath = await this.resolveExistingFile(
      input.scheduleId,
      input.storageKey,
    );
    const details = await stat(filePath);
    if (details.size !== input.expectedSize) return false;

    const stream = await this.readStream(input.scheduleId, input.storageKey);
    const reader = stream.getReader();
    const hash = createHash("sha256");
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (
          let offset = 0;
          offset < value.byteLength;
          offset += MAX_IO_CHUNK_BYTES
        ) {
          const chunk = value.subarray(offset, offset + MAX_IO_CHUNK_BYTES);
          size += chunk.byteLength;
          hash.update(chunk);
        }
      }
    } finally {
      reader.releaseLock();
    }
    return (
      size === input.expectedSize &&
      hash.digest("hex") === input.expectedSha256.toLowerCase()
    );
  }

  async removeFile(scheduleId: string, storageKey: string) {
    const directory = await this.ensureScheduleDirectory(scheduleId);
    assertOpaqueKey(storageKey, "storage key");
    await unlink(path.join(directory, `${storageKey}.blob`)).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      },
    );
  }

  async removeSchedule(scheduleId: string) {
    const directory = await this.ensureScheduleDirectory(scheduleId);
    await rm(directory, { recursive: true, force: true });
  }

  private async resolveExistingFile(scheduleId: string, storageKey: string) {
    const directory = await this.ensureScheduleDirectory(scheduleId);
    assertOpaqueKey(storageKey, "storage key");
    const filePath = path.join(directory, `${storageKey}.blob`);
    const fileStats = await lstat(filePath);
    if (!fileStats.isFile() || fileStats.isSymbolicLink()) {
      throw new Error("The private staged file is unavailable.");
    }
    const checkedPath = await realpath(filePath);
    const root = await this.ensureRoot();
    if (!isWithinRoot(root, checkedPath)) {
      throw new Error("The private staged file escaped its storage root.");
    }
    return checkedPath;
  }

  private async ensureRoot() {
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    const rootStats = await lstat(this.rootDirectory);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
      throw new Error(
        "The private scheduled upload root must be a real directory.",
      );
    }
    await chmod(this.rootDirectory, 0o700);
    return realpath(this.rootDirectory);
  }

  private async ensureScheduleDirectory(scheduleId: string) {
    assertOpaqueKey(scheduleId, "schedule key");
    const root = await this.ensureRoot();
    const directory = path.join(root, scheduleId);
    await mkdir(directory, { recursive: false, mode: 0o700 }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      },
    );
    const directoryStats = await lstat(directory);
    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
      throw new Error("The private schedule staging path cannot be a symlink.");
    }
    await chmod(directory, 0o700);
    const resolvedDirectory = await realpath(directory);
    if (!isWithinRoot(root, resolvedDirectory)) {
      throw new Error(
        "The private schedule staging path escaped its storage root.",
      );
    }
    return resolvedDirectory;
  }
}

export const privateScheduledUploadStorage =
  new PrivateScheduledUploadStorage();
