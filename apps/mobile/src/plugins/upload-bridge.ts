import { Capacitor } from "@capacitor/core";
import { Filesystem } from "@capacitor/filesystem";
import { FilePicker } from "@capawesome/capacitor-file-picker";
import {
  ZEE_MOBILE_MESSAGE,
  type ZeeMobileMessage,
  type ZeeMobilePickScheduledUploadRequest,
  type ZeeMobilePickUploadRequest,
} from "@vaehor/mobile-bridge-protocol";
import { getMimeType } from "../../../../lib/storage/mime";
import { createServerFetch } from "../lib/api-client";
import { runWithBackgroundUploadSupport } from "../lib/background-upload";
import { nativeUploadErrorMessage } from "../lib/upload-errors";
import {
  decodeBase64File,
  runNativeChunkedUpload,
  type NativeUploadFile,
  type NativeUploadProgress,
} from "../lib/upload-bridge";

export type UploadBridgeHandlers = {
  origin: string;
  sessionToken: string;
  iframe: HTMLIFrameElement;
  onProgress: (progress: NativeUploadProgress) => void;
  onLogout?: () => void;
};

function postToFrame(
  iframe: HTMLIFrameElement,
  message: ZeeMobileMessage,
  targetOrigin: string,
): void {
  iframe.contentWindow?.postMessage(message, targetOrigin);
}

async function pickNativeFiles(): Promise<NativeUploadFile[]> {
  const result = await FilePicker.pickFiles({ readData: true, limit: 0 });
  return result.files
    .filter((file) => file.name && file.data)
    .map((file) => ({
      name: file.name,
      mimeType: file.mimeType ?? "application/octet-stream",
      bytes: decodeBase64File(file.data!),
    }));
}

async function handlePickAndUpload(
  request: ZeeMobilePickUploadRequest,
  handlers: UploadBridgeHandlers,
): Promise<void> {
  const fetchImpl = createServerFetch(handlers.origin, handlers.sessionToken);
  const files = await pickNativeFiles();

  for (const file of files) {
    handlers.onProgress({
      fileName: file.name,
      percent: 0,
      status: "uploading",
    });

    try {
      await runNativeChunkedUpload({
        fetchImpl,
        file,
        parentId: request.parentId,
        onProgress: (percent) => {
          handlers.onProgress({
            fileName: file.name,
            percent,
            status: "uploading",
          });
          postToFrame(
            handlers.iframe,
            {
              type: ZEE_MOBILE_MESSAGE,
              action: "upload/progress",
              requestId: request.requestId,
              fileName: file.name,
              percent,
            },
            handlers.origin,
          );
        },
      });

      handlers.onProgress({
        fileName: file.name,
        percent: 100,
        status: "success",
      });
    } catch (error) {
      const errorMessage = nativeUploadErrorMessage(error);
      handlers.onProgress({
        fileName: file.name,
        percent: 0,
        status: "error",
        errorMessage,
      });
      throw error;
    }
  }
}

type NativeScheduledManifestItem = {
  path: string;
  kind: "file" | "folder";
  size: number;
  contentType?: string;
};

type NativeScheduledFile = {
  path: string;
  uri: string;
  size: number;
};

type NativeScheduledUploadSchedule = {
  id: string;
  status: string;
  totalBytes: string;
  items: Array<{
    id: string;
    path: string;
    kind: "FILE" | "FOLDER";
    size: string;
    status: string;
  }>;
};

type NativeScheduledUploadLimits = {
  maxFileBytes: string;
  maxPackageBytes: string;
  maxItems: number;
};

type NativeScheduledUploadProgress = {
  phase: "scanning" | "staging" | "committing";
  path?: string;
  index?: number;
  total?: number;
};

function getNativeFolderName(path: string): string {
  const pathWithoutTrailingSeparator = path.replace(/[\\/]+$/, "");
  const rawName = pathWithoutTrailingSeparator.split(/[\\/]/).pop() ?? "";
  let decodedName = rawName;
  try {
    decodedName = decodeURIComponent(rawName);
  } catch {
    // Keep the native path segment when it isn't valid URI encoding.
  }
  const folderName = decodedName
    .split("/")
    .filter(Boolean)
    .pop()
    ?.split(":")
    .pop();
  if (!folderName || folderName === "." || folderName === "..") {
    throw new Error("The selected folder name is unavailable.");
  }
  return folderName;
}

function validateNativePathSegment(name: string): string {
  if (
    !name ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\")
  ) {
    throw new Error("The selected folder contains an unsafe file path.");
  }
  return name;
}

async function readNativeJson<T>(
  response: Response,
  fallback: string,
): Promise<T> {
  const data = (await response.json().catch(() => null)) as {
    error?: unknown;
    message?: unknown;
  } | null;
  if (!response.ok) {
    const message =
      typeof data?.error === "string"
        ? data.error
        : typeof data?.message === "string"
          ? data.message
          : `${fallback} (${response.status})`;
    throw new Error(message);
  }
  if (!data || typeof data !== "object") {
    throw new Error(fallback);
  }
  return data as T;
}

async function getNativeScheduledUploadLimits(
  fetchImpl: ReturnType<typeof createServerFetch>,
): Promise<NativeScheduledUploadLimits> {
  const response = await fetchImpl("/api/scheduled-uploads", {
    method: "GET",
    cache: "no-store",
  });
  const data = await readNativeJson<{
    limits: NativeScheduledUploadLimits;
  }>(response, "Unable to load scheduled upload limits.");
  return data.limits;
}

async function getNativeScheduledUpload(
  fetchImpl: ReturnType<typeof createServerFetch>,
  scheduleId: string,
): Promise<NativeScheduledUploadSchedule> {
  const response = await fetchImpl(
    `/api/scheduled-uploads/${encodeURIComponent(scheduleId)}`,
    { method: "GET", cache: "no-store" },
  );
  const data = await readNativeJson<{
    schedule: NativeScheduledUploadSchedule;
  }>(response, "Unable to load the scheduled upload.");
  return data.schedule;
}

async function scanNativeDirectory(
  rootPath: string,
  rootName: string,
  limits: NativeScheduledUploadLimits,
  report: (progress: NativeScheduledUploadProgress) => void,
): Promise<{
  items: NativeScheduledManifestItem[];
  files: Map<string, NativeScheduledFile>;
}> {
  const maxFileBytes = Number(limits.maxFileBytes);
  const maxPackageBytes = Number(limits.maxPackageBytes);
  const maxItems = limits.maxItems;
  if (
    !Number.isSafeInteger(maxFileBytes) ||
    !Number.isSafeInteger(maxPackageBytes) ||
    !Number.isSafeInteger(maxItems) ||
    maxFileBytes < 0 ||
    maxPackageBytes < 0 ||
    maxItems < 1
  ) {
    throw new Error("Scheduled upload limits are invalid.");
  }

  const items = new Map<string, NativeScheduledManifestItem>();
  const files = new Map<string, NativeScheduledFile>();
  const visitedDirectories = new Set<string>();
  let totalBytes = 0;
  items.set(rootName, { path: rootName, kind: "folder", size: 0 });

  const visitDirectory = async (uri: string, relativePath: string) => {
    if (!uri || visitedDirectories.has(uri)) {
      throw new Error("The selected folder contains a repeated directory.");
    }
    visitedDirectories.add(uri);
    report({ phase: "scanning", path: relativePath });

    const result = await Filesystem.readdir({ path: uri });
    const entries = [...result.files].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      const name = validateNativePathSegment(entry.name);
      const entryPath = `${relativePath}/${name}`;
      if (items.has(entryPath)) {
        throw new Error("The selected folder contains duplicate file paths.");
      }

      if (entry.type === "directory") {
        items.set(entryPath, { path: entryPath, kind: "folder", size: 0 });
        if (!entry.uri) {
          throw new Error(
            "The selected folder contains an unreadable directory.",
          );
        }
        await visitDirectory(entry.uri, entryPath);
      } else {
        if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
          throw new Error(`The size of ${entryPath} could not be read.`);
        }
        if (entry.size > maxFileBytes) {
          throw new Error(`${entryPath} exceeds the file size limit.`);
        }
        totalBytes += entry.size;
        if (!Number.isSafeInteger(totalBytes) || totalBytes > maxPackageBytes) {
          throw new Error(
            "The folder exceeds the scheduled upload size limit.",
          );
        }
        items.set(entryPath, {
          path: entryPath,
          kind: "file",
          size: entry.size,
          contentType: getMimeType(name),
        });
        if (!entry.uri) {
          throw new Error(`The local path for ${entryPath} could not be read.`);
        }
        files.set(entryPath, {
          path: entryPath,
          uri: entry.uri,
          size: entry.size,
        });
      }

      if (items.size > maxItems) {
        throw new Error(`The folder exceeds the ${maxItems} item limit.`);
      }
    }
  };

  await visitDirectory(rootPath, rootName);
  const manifestItems = [...items.values()].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
    return left.path.localeCompare(right.path);
  });
  return { items: manifestItems, files };
}

function assertNativeManifestMatchesSchedule(
  scannedItems: readonly NativeScheduledManifestItem[],
  schedule: NativeScheduledUploadSchedule,
): void {
  const selected = new Map(scannedItems.map((item) => [item.path, item]));
  if (selected.size !== schedule.items.length) {
    throw new Error(
      "The selected folder does not match this scheduled upload.",
    );
  }

  for (const item of schedule.items) {
    const selectedItem = selected.get(item.path);
    const expectedKind = item.kind === "FILE" ? "file" : "folder";
    if (
      !selectedItem ||
      selectedItem.kind !== expectedKind ||
      (item.kind === "FILE" && selectedItem.size !== Number(item.size))
    ) {
      throw new Error(
        "The selected folder does not match this scheduled upload.",
      );
    }
  }
}

async function handlePickAndStageScheduledUpload(
  request: ZeeMobilePickScheduledUploadRequest,
  handlers: UploadBridgeHandlers,
): Promise<string> {
  const fetchImpl = createServerFetch(handlers.origin, handlers.sessionToken);
  const existingSchedule =
    request.mode === "resume"
      ? await getNativeScheduledUpload(fetchImpl, request.scheduleId)
      : null;
  if (existingSchedule && existingSchedule.status !== "STAGING") {
    throw new Error(
      "Files can only be added before this package is committed.",
    );
  }

  const limits = existingSchedule
    ? {
        maxFileBytes: existingSchedule.totalBytes,
        maxPackageBytes: existingSchedule.totalBytes,
        maxItems: existingSchedule.items.length,
      }
    : await getNativeScheduledUploadLimits(fetchImpl);
  const pickedDirectory = await FilePicker.pickDirectory();
  const rootName = getNativeFolderName(pickedDirectory.path);
  let schedule = existingSchedule;
  let scheduleId = existingSchedule?.id;
  const report = (progress: NativeScheduledUploadProgress) => {
    postToFrame(
      handlers.iframe,
      {
        type: ZEE_MOBILE_MESSAGE,
        action: "scheduled/progress",
        requestId: request.requestId,
        ...(scheduleId ? { scheduleId } : {}),
        ...progress,
      },
      handlers.origin,
    );
  };

  const scanned = await scanNativeDirectory(
    pickedDirectory.path,
    rootName,
    limits,
    report,
  );
  if (schedule) {
    assertNativeManifestMatchesSchedule(scanned.items, schedule);
  } else {
    const createResponse = await fetchImpl("/api/scheduled-uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destinationId: request.mode === "create" ? request.destinationId : "",
        scheduledLocalTime:
          request.mode === "create" ? request.scheduledLocalTime : "",
        timeZone: request.mode === "create" ? request.timeZone : "",
        utcOffset: request.mode === "create" ? request.utcOffset : "",
        items: scanned.items,
      }),
    });
    const data = await readNativeJson<{
      schedule: NativeScheduledUploadSchedule;
    }>(createResponse, "Unable to create the scheduled upload.");
    schedule = data.schedule;
    scheduleId = schedule.id;
  }

  if (!schedule || !scheduleId) {
    throw new Error("The scheduled upload could not be created.");
  }

  const fileItems = schedule.items.filter((item) => item.kind === "FILE");
  const pendingItems = fileItems.filter((item) => item.status !== "STAGED");
  for (let index = 0; index < pendingItems.length; index += 1) {
    const item = pendingItems[index]!;
    const file = scanned.files.get(item.path);
    if (!file) {
      throw new Error(
        `Select the original folder to continue staging ${item.path}.`,
      );
    }

    report({
      phase: "staging",
      index: index + 1,
      total: pendingItems.length,
      path: item.path,
    });
    handlers.onProgress({
      fileName: item.path,
      percent: 0,
      status: "uploading",
    });
    try {
      const deviceResponse = await fetch(Capacitor.convertFileSrc(file.uri));
      if (!deviceResponse.ok) {
        throw new Error(`Unable to read ${item.path} from this device.`);
      }
      const blob = await deviceResponse.blob();
      if (blob.size !== file.size) {
        throw new Error(`${item.path} changed after the folder was selected.`);
      }

      const stagedResponse = await fetchImpl(
        `/api/scheduled-uploads/${encodeURIComponent(scheduleId)}/items/${encodeURIComponent(item.id)}/content`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: blob,
        },
      );
      await readNativeJson<{ item: unknown }>(
        stagedResponse,
        `Unable to stage ${item.path}.`,
      );
      handlers.onProgress({
        fileName: item.path,
        percent: 100,
        status: "success",
      });
    } catch (error) {
      const errorMessage = nativeUploadErrorMessage(error);
      handlers.onProgress({
        fileName: item.path,
        percent: 0,
        status: "error",
        errorMessage,
      });
      throw error;
    }
  }

  report({
    phase: "committing",
    index: pendingItems.length,
    total: pendingItems.length,
  });
  const commitResponse = await fetchImpl(
    `/api/scheduled-uploads/${encodeURIComponent(scheduleId)}/commit`,
    { method: "POST" },
  );
  await readNativeJson<{ schedule: NativeScheduledUploadSchedule }>(
    commitResponse,
    "Unable to commit the scheduled upload.",
  );
  return scheduleId;
}

export function attachUploadBridge(handlers: UploadBridgeHandlers): () => void {
  const onMessage = (event: MessageEvent) => {
    if (event.source !== handlers.iframe.contentWindow) return;
    if (event.origin !== handlers.origin) return;
    const data = event.data as ZeeMobileMessage | undefined;
    if (data?.type !== ZEE_MOBILE_MESSAGE) return;

    if (data.action === "upload/pick") {
      runWithBackgroundUploadSupport(() => handlePickAndUpload(data, handlers))
        .then(() => {
          postToFrame(
            handlers.iframe,
            {
              type: ZEE_MOBILE_MESSAGE,
              action: "upload/pick-done",
              requestId: data.requestId,
            },
            handlers.origin,
          );
        })
        .catch((error: unknown) => {
          postToFrame(
            handlers.iframe,
            {
              type: ZEE_MOBILE_MESSAGE,
              action: "upload/pick-error",
              requestId: data.requestId,
              error:
                error instanceof Error ? error.message : "Native upload failed",
            },
            handlers.origin,
          );
        });
      return;
    }

    if (data.action === "scheduled/pick-folder") {
      let scheduleId: string | undefined;
      runWithBackgroundUploadSupport(() =>
        handlePickAndStageScheduledUpload(data, handlers).then((createdId) => {
          scheduleId = createdId;
          return createdId;
        }),
      )
        .then((createdId) => {
          postToFrame(
            handlers.iframe,
            {
              type: ZEE_MOBILE_MESSAGE,
              action: "scheduled/done",
              requestId: data.requestId,
              scheduleId: createdId,
            },
            handlers.origin,
          );
        })
        .catch((error: unknown) => {
          postToFrame(
            handlers.iframe,
            {
              type: ZEE_MOBILE_MESSAGE,
              action: "scheduled/error",
              requestId: data.requestId,
              ...(scheduleId ? { scheduleId } : {}),
              error:
                error instanceof Error
                  ? error.message
                  : "Native scheduled upload failed",
            },
            handlers.origin,
          );
        });
      return;
    }

    if (data.action === "logout") {
      handlers.onLogout?.();
    }
  };

  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
