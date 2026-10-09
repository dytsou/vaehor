import { getAccessToken } from "@/lib/drive";
import {
  privateScheduledUploadStorage,
  type ScheduledUploadReadRange,
} from "@/lib/storage/private-scheduled-uploads";
import { resolveRole } from "@/lib/services/auth-jwt";
import { deliverNextScheduledUploadAdminAlertEmail } from "@/lib/services/scheduled-upload-admin-alert";
import {
  claimDueScheduledUploadForRelease,
  canAccessScheduledUploadDestination,
  finishScheduledUploadReleaseClaim,
  markScheduledUploadFirstWriteAttempt,
  recordScheduledUploadFirstWriteResponse,
  retryPendingScheduledUploadCleanupBatch,
  retryScheduledUploadCleanup,
  updateScheduledUploadReleaseItem,
  type ScheduledUploadReleaseClaim,
  type ScheduledUploadReleaseItem,
  type ScheduledUploadReleaseItemUpdate,
} from "@/lib/services/scheduled-upload";
import {
  assertScheduledUploadSessionEncryptionAvailable,
  decryptScheduledUploadSession,
  encryptScheduledUploadSession,
  ScheduledUploadSessionCryptoError,
} from "@/lib/services/scheduled-upload-session-crypto";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const CHUNK_SIZE_BYTES = 8 * 1024 * 1024;
const GOOGLE_CHUNK_ALIGNMENT_BYTES = 256 * 1024;
const MAX_PARENT_CHAIN_LENGTH = 32;
const DRIVE_REQUEST_TIMEOUT_MS = 5_000;

export type ScheduledUploadWorkerRole = "ADMIN" | "EDITOR" | "USER";

export interface ScheduledUploadDriveMetadata {
  id: string;
  name?: string;
  mimeType?: string;
  parents?: string[];
  trashed?: boolean;
  size?: string;
  capabilities?: { canAddChildren?: boolean };
  appProperties?: Record<string, string>;
}

export type ScheduledUploadUploadStatus =
  | { kind: "incomplete"; acknowledgedBytes: number }
  | { kind: "complete"; file: ScheduledUploadDriveMetadata }
  | { kind: "expired" };

export interface ScheduledUploadDriveAdapter {
  getFileMetadata(fileId: string): Promise<ScheduledUploadDriveMetadata | null>;
  generateFileId(): Promise<string>;
  createFolder(input: {
    id: string;
    name: string;
    parentId: string;
    scheduleId: string;
    itemId: string;
  }): Promise<void>;
  startResumableUpload(input: {
    id: string;
    name: string;
    parentId: string;
    size: number;
    contentType: string;
    scheduleId: string;
    itemId: string;
  }): Promise<string>;
  queryUploadStatus(
    sessionUri: string,
    totalBytes: number,
  ): Promise<ScheduledUploadUploadStatus>;
  uploadChunk(input: {
    sessionUri: string;
    start: number;
    totalBytes: number;
    bytes: Uint8Array;
  }): Promise<ScheduledUploadUploadStatus>;
}

export interface ScheduledUploadWorkerStore {
  claimNextScheduledUpload(): Promise<ScheduledUploadReleaseClaim | null>;
  markFirstWriteAttempt(
    scheduleId: string,
    leaseToken: string,
  ): Promise<boolean>;
  recordFirstWriteResponse(
    scheduleId: string,
    leaseToken: string,
  ): Promise<boolean>;
  updateItem(
    scheduleId: string,
    itemId: string,
    leaseToken: string,
    data: ScheduledUploadReleaseItemUpdate,
  ): Promise<boolean>;
  finishClaim(input: {
    scheduleId: string;
    leaseToken: string;
    attemptId: string;
    status: "RELEASING" | "PARTIAL" | "NEEDS_ATTENTION" | "COMPLETED";
    errorCode?: string | null;
    errorMessage?: string | null;
    retryAfter?: Date | null;
    adminAlertReason?: string | null;
  }): Promise<boolean>;
}

export interface ScheduledUploadWorkerStorage {
  verifyFile(input: {
    scheduleId: string;
    storageKey: string;
    expectedSize: number;
    expectedSha256: string;
  }): Promise<boolean>;
  readStream(
    scheduleId: string,
    storageKey: string,
    range: ScheduledUploadReadRange,
  ): Promise<ReadableStream<Uint8Array>>;
}

export interface ScheduledUploadWorkerDependencies {
  store: ScheduledUploadWorkerStore;
  drive: ScheduledUploadDriveAdapter;
  storage: ScheduledUploadWorkerStorage;
  resolveRole(email: string): Promise<ScheduledUploadWorkerRole>;
  canAccessDestination(
    email: string,
    destinationId: string,
    role: ScheduledUploadWorkerRole,
  ): Promise<boolean>;
  assertEncryptionAvailable(): void;
  encryptSession(
    sessionUri: string,
    context: string,
  ): {
    ciphertext: string;
    nonce: string;
    tag: string;
    keyVersion: string;
  };
  decryptSession(
    session: {
      ciphertext: string;
      nonce: string;
      tag: string;
      keyVersion: string;
    },
    context: string,
  ): string;
  retryCleanup(scheduleId: string): Promise<unknown>;
  retryPendingCleanup(): Promise<number>;
  now(): Date;
  maxSchedulesPerTick: number;
  maxItemsPerTick: number;
  maxChunksPerTick: number;
  maxDurationMs: number;
  chunkSizeBytes: number;
}

class ScheduledUploadDriveError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(`Google Drive request failed with status ${status}.`);
    this.name = "ScheduledUploadDriveError";
  }
}

class ScheduledUploadWorkerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ScheduledUploadWorkerError";
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(60 * 60, Math.ceil(seconds));
  }
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.min(60 * 60, Math.max(0, Math.ceil((date - Date.now()) / 1000)));
}

function isRetryableDriveStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

async function getDriveResponse(
  url: string,
  init: RequestInit,
): Promise<Response> {
  let token: string;
  try {
    token = await getAccessToken();
  } catch {
    throw new ScheduledUploadWorkerError(
      "DRIVE_AUTH_UNAVAILABLE",
      "Google Drive authorization is unavailable.",
      true,
    );
  }

  try {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(url, {
      ...init,
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(DRIVE_REQUEST_TIMEOUT_MS),
    });
    if (response.status === 429 || response.status >= 500) {
      throw new ScheduledUploadDriveError(
        response.status,
        parseRetryAfter(response.headers.get("Retry-After")),
      );
    }
    return response;
  } catch (error) {
    if (error instanceof ScheduledUploadDriveError) throw error;
    throw new ScheduledUploadWorkerError(
      "DRIVE_NETWORK_ERROR",
      "Google Drive is temporarily unavailable.",
      true,
    );
  }
}

function assertAllowedSessionUri(sessionUri: string) {
  try {
    const parsed = new URL(sessionUri);
    if (
      parsed.protocol === "https:" &&
      parsed.hostname === "www.googleapis.com" &&
      parsed.pathname.startsWith("/upload/drive/v3/files") &&
      parsed.searchParams.has("upload_id")
    ) {
      return;
    }
  } catch {
    // Treat any malformed or untrusted URI as tampered persisted state.
  }
  throw new ScheduledUploadSessionCryptoError("TAMPERED_SESSION");
}

function driveError(response: Response): ScheduledUploadDriveError {
  return new ScheduledUploadDriveError(
    response.status,
    parseRetryAfter(response.headers.get("Retry-After")),
  );
}

function parseAcknowledgedBytes(range: string | null, totalBytes: number) {
  if (!range) return 0;
  const match = /^bytes\s*=\s*0-(\d+)$/i.exec(range.trim());
  if (!match) {
    throw new ScheduledUploadWorkerError(
      "DRIVE_INVALID_RANGE",
      "Google Drive returned an invalid upload offset.",
    );
  }
  const acknowledged = Number(match[1]) + 1;
  if (
    !Number.isSafeInteger(acknowledged) ||
    acknowledged < 0 ||
    acknowledged > totalBytes
  ) {
    throw new ScheduledUploadWorkerError(
      "DRIVE_INVALID_RANGE",
      "Google Drive returned an invalid upload offset.",
    );
  }
  return acknowledged;
}

function parseDriveFile(value: unknown, fallbackId?: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ScheduledUploadWorkerError(
      "DRIVE_INVALID_RESPONSE",
      "Google Drive returned an invalid file response.",
    );
  }
  const file = value as Record<string, unknown>;
  const id = typeof file.id === "string" ? file.id : fallbackId;
  if (!id) {
    throw new ScheduledUploadWorkerError(
      "DRIVE_INVALID_RESPONSE",
      "Google Drive did not return a file ID.",
    );
  }
  return {
    ...file,
    id,
  } as ScheduledUploadDriveMetadata;
}

async function readResponseFile(response: Response, fallbackId?: string) {
  try {
    return parseDriveFile(await response.json(), fallbackId);
  } catch (error) {
    if (error instanceof ScheduledUploadWorkerError) throw error;
    throw new ScheduledUploadWorkerError(
      "DRIVE_INVALID_RESPONSE",
      "Google Drive returned an invalid file response.",
    );
  }
}

export function createDriveAdapter(): ScheduledUploadDriveAdapter {
  return {
    async getFileMetadata(fileId) {
      const params = new URLSearchParams({
        fields:
          "id,name,mimeType,parents,trashed,size,capabilities(canAddChildren),appProperties",
        supportsAllDrives: "true",
      });
      const response = await getDriveResponse(
        `${DRIVE_API}/files/${encodeURIComponent(fileId)}?${params.toString()}`,
        { method: "GET" },
      );
      if (response.status === 404) return null;
      if (!response.ok) throw driveError(response);
      return readResponseFile(response);
    },

    async generateFileId() {
      const response = await getDriveResponse(
        `${DRIVE_API}/files/generateIds?count=1&space=drive&type=files`,
        { method: "GET" },
      );
      if (!response.ok) throw driveError(response);
      try {
        const body = (await response.json()) as { ids?: unknown };
        const id = Array.isArray(body.ids) ? body.ids[0] : undefined;
        if (typeof id === "string" && id.length > 0) return id;
      } catch {
        // Use a stable, sanitized error below.
      }
      throw new ScheduledUploadWorkerError(
        "DRIVE_INVALID_RESPONSE",
        "Google Drive did not return a file ID.",
      );
    },

    async createFolder(input) {
      const params = new URLSearchParams({
        supportsAllDrives: "true",
        fields: "id",
      });
      const response = await getDriveResponse(
        `${DRIVE_API}/files?${params.toString()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: input.id,
            name: input.name,
            mimeType: FOLDER_MIME_TYPE,
            parents: [input.parentId],
            appProperties: {
              vaehorScheduleId: input.scheduleId,
              vaehorScheduleItemId: input.itemId,
            },
          }),
        },
      );
      if (!response.ok) throw driveError(response);
      await response.body?.cancel();
    },

    async startResumableUpload(input) {
      const params = new URLSearchParams({
        uploadType: "resumable",
        supportsAllDrives: "true",
        fields: "id,name",
      });
      const response = await getDriveResponse(
        `${DRIVE_UPLOAD_API}?${params.toString()}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Length": String(input.size),
            "X-Upload-Content-Type": input.contentType,
          },
          body: JSON.stringify({
            id: input.id,
            name: input.name,
            mimeType: input.contentType,
            parents: [input.parentId],
            appProperties: {
              vaehorScheduleId: input.scheduleId,
              vaehorScheduleItemId: input.itemId,
            },
          }),
        },
      );
      if (!response.ok) throw driveError(response);
      const sessionUri = response.headers.get("Location");
      await response.body?.cancel();
      if (!sessionUri) {
        throw new ScheduledUploadWorkerError(
          "DRIVE_SESSION_MISSING",
          "Google Drive did not return an upload session.",
        );
      }
      assertAllowedSessionUri(sessionUri);
      return sessionUri;
    },

    async queryUploadStatus(sessionUri, totalBytes) {
      assertAllowedSessionUri(sessionUri);
      const response = await getDriveResponse(sessionUri, {
        method: "PUT",
        headers: {
          "Content-Length": "0",
          "Content-Range": `bytes */${totalBytes}`,
        },
        body: new Uint8Array(0),
      });
      if (response.status === 404) return { kind: "expired" };
      if (response.status === 308) {
        const acknowledgedBytes = parseAcknowledgedBytes(
          response.headers.get("Range"),
          totalBytes,
        );
        await response.body?.cancel();
        return { kind: "incomplete", acknowledgedBytes };
      }
      if (response.ok) {
        return {
          kind: "complete",
          file: await readResponseFile(response),
        };
      }
      throw driveError(response);
    },

    async uploadChunk(input) {
      assertAllowedSessionUri(input.sessionUri);
      if (
        input.start < 0 ||
        (input.bytes.byteLength === 0 && input.totalBytes !== 0) ||
        input.start + input.bytes.byteLength > input.totalBytes ||
        (input.start + input.bytes.byteLength < input.totalBytes &&
          input.bytes.byteLength % GOOGLE_CHUNK_ALIGNMENT_BYTES !== 0)
      ) {
        throw new ScheduledUploadWorkerError(
          "INVALID_CHUNK_RANGE",
          "The scheduled upload chunk range is invalid.",
        );
      }
      const end = input.start + input.bytes.byteLength - 1;
      const body = new ArrayBuffer(input.bytes.byteLength);
      new Uint8Array(body).set(input.bytes);
      const response = await getDriveResponse(input.sessionUri, {
        method: "PUT",
        headers: {
          "Content-Length": String(input.bytes.byteLength),
          ...(input.bytes.byteLength > 0
            ? {
                "Content-Range": `bytes ${input.start}-${end}/${input.totalBytes}`,
              }
            : {}),
        },
        body,
      });
      if (response.status === 404) return { kind: "expired" };
      if (response.status === 308) {
        const acknowledgedBytes = parseAcknowledgedBytes(
          response.headers.get("Range"),
          input.totalBytes,
        );
        await response.body?.cancel();
        return { kind: "incomplete", acknowledgedBytes };
      }
      if (response.ok) {
        return {
          kind: "complete",
          file: await readResponseFile(response),
        };
      }
      throw driveError(response);
    },
  };
}

const productionStore: ScheduledUploadWorkerStore = {
  claimNextScheduledUpload: claimDueScheduledUploadForRelease,
  markFirstWriteAttempt: markScheduledUploadFirstWriteAttempt,
  recordFirstWriteResponse: recordScheduledUploadFirstWriteResponse,
  updateItem: updateScheduledUploadReleaseItem,
  finishClaim: finishScheduledUploadReleaseClaim,
};

export function createScheduledUploadWorker(
  overrides: Partial<ScheduledUploadWorkerDependencies> = {},
) {
  const dependencies: ScheduledUploadWorkerDependencies = {
    store: productionStore,
    drive: createDriveAdapter(),
    storage: privateScheduledUploadStorage,
    resolveRole,
    canAccessDestination: canAccessScheduledUploadDestination,
    assertEncryptionAvailable: assertScheduledUploadSessionEncryptionAvailable,
    encryptSession: (uri, context) =>
      encryptScheduledUploadSession(uri, context),
    decryptSession: (encrypted, context) =>
      decryptScheduledUploadSession(encrypted, context),
    retryCleanup: retryScheduledUploadCleanup,
    retryPendingCleanup: retryPendingScheduledUploadCleanupBatch,
    now: () => new Date(),
    maxSchedulesPerTick: 2,
    maxItemsPerTick: 2,
    maxChunksPerTick: 1,
    maxDurationMs: 7_000,
    chunkSizeBytes: CHUNK_SIZE_BYTES,
    ...overrides,
  };

  return {
    runTick: () => runWorkerTick(dependencies),
  };
}

function allStagingComplete(claim: ScheduledUploadReleaseClaim) {
  const { schedule } = claim;
  return (
    schedule.status === "RELEASING" &&
    Boolean(schedule.stageCompleteAt) &&
    schedule.items.length === schedule.itemCount &&
    schedule.stagedBytes === schedule.totalBytes &&
    schedule.items.every(
      (item) =>
        item.kind === "FOLDER" ||
        ((item.status === "STAGED" ||
          item.status === "UPLOADING" ||
          item.status === "COMPLETE") &&
          item.storageKey !== null &&
          item.sha256 !== null &&
          item.uploadedBytes === item.size),
    )
  );
}

function sessionContext(scheduleId: string, itemId: string) {
  return `${scheduleId}:${itemId}`;
}

function getItemSessionUri(
  claim: ScheduledUploadReleaseClaim,
  item: ScheduledUploadReleaseItem,
  dependencies: ScheduledUploadWorkerDependencies,
) {
  if (
    !item.encryptedUploadSession ||
    !item.uploadSessionNonce ||
    !item.uploadSessionTag ||
    !item.uploadSessionKeyVersion
  ) {
    return null;
  }
  return dependencies.decryptSession(
    {
      ciphertext: item.encryptedUploadSession,
      nonce: item.uploadSessionNonce,
      tag: item.uploadSessionTag,
      keyVersion: item.uploadSessionKeyVersion,
    },
    sessionContext(claim.schedule.id, item.id),
  );
}

function currentSessionUris(
  claim: ScheduledUploadReleaseClaim,
  dependencies: ScheduledUploadWorkerDependencies,
) {
  const result = new Map<string, string>();
  for (const item of claim.schedule.items) {
    if (item.kind !== "FILE" || item.status === "COMPLETE") continue;
    const hasPartialSession = Boolean(
      item.encryptedUploadSession ||
        item.uploadSessionNonce ||
        item.uploadSessionTag ||
        item.uploadSessionKeyVersion,
    );
    if (hasPartialSession) {
      if (
        !item.encryptedUploadSession ||
        !item.uploadSessionNonce ||
        !item.uploadSessionTag ||
        !item.uploadSessionKeyVersion
      ) {
        throw new ScheduledUploadSessionCryptoError("TAMPERED_SESSION");
      }
      result.set(item.id, getItemSessionUri(claim, item, dependencies)!);
    }
  }
  return result;
}

function needsActiveEncryptionKey(claim: ScheduledUploadReleaseClaim) {
  return claim.schedule.items.some(
    (item) =>
      item.kind === "FILE" &&
      item.status !== "COMPLETE" &&
      !item.encryptedUploadSession,
  );
}

async function pauseForAttention(
  claim: ScheduledUploadReleaseClaim,
  dependencies: ScheduledUploadWorkerDependencies,
  code: string,
  message: string,
  adminAlertReason?: string,
) {
  await dependencies.store.finishClaim({
    scheduleId: claim.schedule.id,
    leaseToken: claim.leaseToken,
    attemptId: claim.attemptId,
    status: "NEEDS_ATTENTION",
    errorCode: code,
    errorMessage: message,
    adminAlertReason:
      adminAlertReason ??
      (code === "CREATOR_ROLE_REVOKED" ? "CREATOR_ROLE_REVOKED" : undefined),
  });
}

function scheduledUploadAccessEmail(
  schedule: ScheduledUploadReleaseClaim["schedule"],
) {
  return schedule.creatorAccessEmail ?? schedule.creatorEmail;
}

async function ensureFirstWriteAuthorization(
  claim: ScheduledUploadReleaseClaim,
  dependencies: ScheduledUploadWorkerDependencies,
) {
  if (claim.schedule.firstWriteAttemptAt !== null) return true;

  const role = await dependencies.resolveRole(claim.schedule.creatorEmail);
  if (role !== "EDITOR" && role !== "ADMIN") {
    await pauseForAttention(
      claim,
      dependencies,
      "CREATOR_ROLE_REVOKED",
      "The creator no longer has editor access.",
    );
    return false;
  }

  let canAccessDestination = false;
  try {
    canAccessDestination = await dependencies.canAccessDestination(
      scheduledUploadAccessEmail(claim.schedule),
      claim.schedule.destinationId,
      role,
    );
  } catch {
    canAccessDestination = false;
  }
  if (!canAccessDestination) {
    await pauseForAttention(
      claim,
      dependencies,
      "DESTINATION_ACCESS_REVOKED",
      "The creator no longer has access to the selected destination folder.",
      "DESTINATION_ACCESS_REVOKED",
    );
    return false;
  }

  return true;
}

async function markFirstWriteAttempt(
  claim: ScheduledUploadReleaseClaim,
  dependencies: ScheduledUploadWorkerDependencies,
) {
  if (claim.schedule.firstWriteAttemptAt !== null) return;
  const marked = await dependencies.store.markFirstWriteAttempt(
    claim.schedule.id,
    claim.leaseToken,
  );
  if (!marked) {
    throw new ScheduledUploadWorkerError(
      "RELEASE_LEASE_LOST",
      "The scheduled upload release lease expired.",
      true,
    );
  }
}

async function recordFirstWriteResponse(
  claim: ScheduledUploadReleaseClaim,
  dependencies: ScheduledUploadWorkerDependencies,
) {
  const recorded = await dependencies.store.recordFirstWriteResponse(
    claim.schedule.id,
    claim.leaseToken,
  );
  if (!recorded) {
    throw new ScheduledUploadWorkerError(
      "RELEASE_LEASE_LOST",
      "The scheduled upload release lease expired.",
      true,
    );
  }
}

async function releaseProgressClaim(
  claim: ScheduledUploadReleaseClaim,
  dependencies: ScheduledUploadWorkerDependencies,
) {
  const released = await dependencies.store.finishClaim({
    scheduleId: claim.schedule.id,
    leaseToken: claim.leaseToken,
    attemptId: claim.attemptId,
    status: "RELEASING",
  });
  if (!released) {
    throw new ScheduledUploadWorkerError(
      "RELEASE_LEASE_LOST",
      "The scheduled upload release lease expired.",
      true,
    );
  }
}

function retryDelayMilliseconds(attemptCount: number) {
  return Math.min(60 * 60 * 1000, 5_000 * 2 ** Math.min(attemptCount, 9));
}

async function pauseForRetry(
  claim: ScheduledUploadReleaseClaim,
  dependencies: ScheduledUploadWorkerDependencies,
  code: string,
  message: string,
  retryAfterSeconds?: number,
) {
  const retryDelay =
    retryAfterSeconds === undefined
      ? retryDelayMilliseconds(claim.schedule.workerRetryCount)
      : retryAfterSeconds * 1000;
  await dependencies.store.finishClaim({
    scheduleId: claim.schedule.id,
    leaseToken: claim.leaseToken,
    attemptId: claim.attemptId,
    status: "PARTIAL",
    errorCode: code,
    errorMessage: message,
    retryAfter: new Date(dependencies.now().getTime() + retryDelay),
  });
}

async function verifyStagingBeforeRelease(
  claim: ScheduledUploadReleaseClaim,
  dependencies: ScheduledUploadWorkerDependencies,
) {
  const next = claim.schedule.items.find(
    (item) => item.kind === "FILE" && item.releaseVerifiedAt === null,
  );
  if (!next) return "verified" as const;
  const verified = await dependencies.storage.verifyFile({
    scheduleId: claim.schedule.id,
    storageKey: next.storageKey!,
    expectedSize: Number(next.size),
    expectedSha256: next.sha256!,
  });
  if (!verified) return "invalid" as const;
  const updated = await dependencies.store.updateItem(
    claim.schedule.id,
    next.id,
    claim.leaseToken,
    { releaseVerifiedAt: dependencies.now() },
  );
  if (!updated) {
    throw new ScheduledUploadWorkerError(
      "RELEASE_LEASE_LOST",
      "The scheduled upload release lease expired.",
      true,
    );
  }
  const remaining = claim.schedule.items.some(
    (item) =>
      item.kind === "FILE" &&
      item.id !== next.id &&
      item.releaseVerifiedAt === null,
  );
  return remaining ? ("progress" as const) : ("verified" as const);
}

async function validateDestinationChain(
  destinationId: string,
  drive: ScheduledUploadDriveAdapter,
) {
  const destination = await drive.getFileMetadata(destinationId);
  if (!destination || destination.trashed) {
    throw new ScheduledUploadWorkerError(
      "DESTINATION_MISSING",
      "The selected Drive destination is no longer available.",
    );
  }
  if (destination.mimeType !== FOLDER_MIME_TYPE) {
    throw new ScheduledUploadWorkerError(
      "DESTINATION_NOT_FOLDER",
      "The selected Drive destination is no longer a folder.",
    );
  }
  if (destination.capabilities?.canAddChildren !== true) {
    throw new ScheduledUploadWorkerError(
      "DESTINATION_NO_ADD_CHILDREN",
      "The selected Drive destination no longer allows new children.",
    );
  }

  const visited = new Set([destination.id]);
  const pending = [...(destination.parents ?? [])];
  let visitedCount = 0;
  while (pending.length > 0) {
    const parentId = pending.pop()!;
    if (visited.has(parentId)) {
      throw new ScheduledUploadWorkerError(
        "DESTINATION_PARENT_CHAIN_INVALID",
        "The selected Drive destination has an invalid parent chain.",
      );
    }
    visited.add(parentId);
    visitedCount += 1;
    if (visitedCount > MAX_PARENT_CHAIN_LENGTH) {
      throw new ScheduledUploadWorkerError(
        "DESTINATION_PARENT_CHAIN_TOO_DEEP",
        "The selected Drive destination has an unsupported parent chain.",
      );
    }
    const parent = await drive.getFileMetadata(parentId);
    if (!parent || parent.trashed || parent.mimeType !== FOLDER_MIME_TYPE) {
      throw new ScheduledUploadWorkerError(
        "DESTINATION_PARENT_CHAIN_INVALID",
        "The selected Drive destination has an invalid parent chain.",
      );
    }
    pending.push(...(parent.parents ?? []));
  }
}

function parentPath(item: ScheduledUploadReleaseItem) {
  const segments = item.manifestPath.split("/");
  segments.pop();
  return segments.join("/");
}

function resolveParentId(
  item: ScheduledUploadReleaseItem,
  claim: ScheduledUploadReleaseClaim,
) {
  const parent = parentPath(item);
  if (!parent) return claim.schedule.destinationId;
  const parentFolder = claim.schedule.items.find(
    (candidate) =>
      candidate.kind === "FOLDER" && candidate.manifestPath === parent,
  );
  if (!parentFolder?.remoteFileId || parentFolder.status !== "COMPLETE") {
    throw new ScheduledUploadWorkerError(
      "MANIFEST_PARENT_FOLDER_MISSING",
      "The staged package is missing a required parent folder.",
    );
  }
  return parentFolder.remoteFileId;
}

function chooseNextItem(claim: ScheduledUploadReleaseClaim) {
  const folders = claim.schedule.items
    .filter((item) => item.kind === "FOLDER" && item.status !== "COMPLETE")
    .sort((a, b) => {
      const depth =
        a.manifestPath.split("/").length - b.manifestPath.split("/").length;
      return depth || a.manifestPath.localeCompare(b.manifestPath);
    });
  const readyFolder = folders.find((item) => {
    const parent = parentPath(item);
    if (!parent) return true;
    return claim.schedule.items.some(
      (candidate) =>
        candidate.kind === "FOLDER" &&
        candidate.manifestPath === parent &&
        candidate.status === "COMPLETE" &&
        candidate.remoteFileId !== null,
    );
  });
  if (readyFolder) return readyFolder;

  return claim.schedule.items.find(
    (item) => item.kind === "FILE" && item.status !== "COMPLETE",
  );
}

async function readChunkFromStorage(
  storage: ScheduledUploadWorkerStorage,
  scheduleId: string,
  storageKey: string,
  offset: number,
  length: number,
) {
  const stream = await storage.readStream(scheduleId, storageKey, {
    start: offset,
    end: offset + length - 1,
  });
  const reader = stream.getReader();
  const output = new Uint8Array(length);
  let copied = 0;
  try {
    while (copied < length) {
      const { done, value } = await reader.read();
      if (done) break;
      const count = Math.min(value.byteLength, length - copied);
      output.set(value.subarray(0, count), copied);
      copied += count;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (copied !== length) {
    throw new ScheduledUploadWorkerError(
      "STAGED_CONTENT_SHORT_READ",
      "The private staged content could not be read completely.",
    );
  }
  return output;
}

function assertRemoteFileMatches(
  file: ScheduledUploadDriveMetadata,
  scheduleId: string,
  item: ScheduledUploadReleaseItem,
  parentId: string,
) {
  const expectedName = item.manifestPath.split("/").at(-1);
  const properties = file.appProperties ?? {};
  if (
    file.name !== expectedName ||
    !(file.parents ?? []).includes(parentId) ||
    properties.vaehorScheduleId !== scheduleId ||
    properties.vaehorScheduleItemId !== item.id
  ) {
    throw new ScheduledUploadWorkerError(
      "DRIVE_ID_CONFLICT",
      "Google Drive returned an existing ID that does not match this item.",
    );
  }
}

async function ensureRemoteFileId(
  claim: ScheduledUploadReleaseClaim,
  item: ScheduledUploadReleaseItem,
  dependencies: ScheduledUploadWorkerDependencies,
) {
  if (item.remoteFileId) return item.remoteFileId;

  const remoteFileId = await dependencies.drive.generateFileId();
  const saved = await dependencies.store.updateItem(
    claim.schedule.id,
    item.id,
    claim.leaseToken,
    { remoteFileId, status: "UPLOADING" },
  );
  if (!saved) {
    throw new ScheduledUploadWorkerError(
      "RELEASE_LEASE_LOST",
      "The scheduled upload release lease expired.",
      true,
    );
  }
  return remoteFileId;
}

async function processFolder(
  claim: ScheduledUploadReleaseClaim,
  item: ScheduledUploadReleaseItem,
  dependencies: ScheduledUploadWorkerDependencies,
) {
  const parentId = resolveParentId(item, claim);
  const remoteFileId = await ensureRemoteFileId(claim, item, dependencies);

  const existing = await dependencies.drive.getFileMetadata(remoteFileId);
  if (existing) {
    assertRemoteFileMatches(existing, claim.schedule.id, item, parentId);
  } else {
    try {
      if (!(await ensureFirstWriteAuthorization(claim, dependencies))) {
        return { operation: "none" as const, chunks: 0 };
      }
      await markFirstWriteAttempt(claim, dependencies);
      await dependencies.drive.createFolder({
        id: remoteFileId,
        name: item.manifestPath.split("/").at(-1) ?? item.manifestPath,
        parentId,
        scheduleId: claim.schedule.id,
        itemId: item.id,
      });
    } catch (error) {
      if (
        !(error instanceof ScheduledUploadDriveError) ||
        error.status !== 409
      ) {
        throw error;
      }
      const duplicate = await dependencies.drive.getFileMetadata(remoteFileId);
      if (!duplicate) throw error;
      assertRemoteFileMatches(duplicate, claim.schedule.id, item, parentId);
    }
  }

  await recordFirstWriteResponse(claim, dependencies);

  const updated = await dependencies.store.updateItem(
    claim.schedule.id,
    item.id,
    claim.leaseToken,
    {
      status: "COMPLETE",
      remoteFileId,
      lastErrorCode: null,
      lastErrorMessage: null,
    },
  );
  if (!updated) {
    throw new ScheduledUploadWorkerError(
      "RELEASE_LEASE_LOST",
      "The scheduled upload release lease expired.",
      true,
    );
  }
  return { operation: "item" as const, chunks: 0 };
}

async function reconcileCompletedFile(
  claim: ScheduledUploadReleaseClaim,
  item: ScheduledUploadReleaseItem,
  remoteFileId: string,
  parentId: string,
  dependencies: ScheduledUploadWorkerDependencies,
) {
  const existing = await dependencies.drive.getFileMetadata(remoteFileId);
  if (!existing) return false;
  assertRemoteFileMatches(existing, claim.schedule.id, item, parentId);
  if (Number(existing.size) !== Number(item.size)) {
    throw new ScheduledUploadWorkerError(
      "DRIVE_ID_CONFLICT",
      "Google Drive returned an existing ID with a different size.",
    );
  }
  const updated = await dependencies.store.updateItem(
    claim.schedule.id,
    item.id,
    claim.leaseToken,
    {
      status: "COMPLETE",
      remoteFileId,
      encryptedUploadSession: null,
      uploadSessionNonce: null,
      uploadSessionTag: null,
      uploadSessionKeyVersion: null,
      remoteUploadOffset: item.size,
      lastErrorCode: null,
      lastErrorMessage: null,
    },
  );
  if (!updated) {
    throw new ScheduledUploadWorkerError(
      "RELEASE_LEASE_LOST",
      "The scheduled upload release lease expired.",
      true,
    );
  }
  await recordFirstWriteResponse(claim, dependencies);
  return true;
}

async function initializeUploadSession(
  claim: ScheduledUploadReleaseClaim,
  item: ScheduledUploadReleaseItem,
  remoteFileId: string,
  parentId: string,
  dependencies: ScheduledUploadWorkerDependencies,
): Promise<string> {
  await markFirstWriteAttempt(claim, dependencies);
  const sessionUri = await dependencies.drive.startResumableUpload({
    id: remoteFileId,
    name: item.manifestPath.split("/").at(-1) ?? item.manifestPath,
    parentId,
    size: Number(item.size),
    contentType: item.contentType ?? "application/octet-stream",
    scheduleId: claim.schedule.id,
    itemId: item.id,
  });
  await recordFirstWriteResponse(claim, dependencies);
  const encrypted = dependencies.encryptSession(
    sessionUri,
    sessionContext(claim.schedule.id, item.id),
  );
  const saved = await dependencies.store.updateItem(
    claim.schedule.id,
    item.id,
    claim.leaseToken,
    {
      status: "UPLOADING",
      remoteFileId,
      encryptedUploadSession: encrypted.ciphertext,
      uploadSessionNonce: encrypted.nonce,
      uploadSessionTag: encrypted.tag,
      uploadSessionKeyVersion: encrypted.keyVersion,
      remoteUploadOffset: BigInt(0),
      lastErrorCode: null,
      lastErrorMessage: null,
    },
  );
  if (!saved) {
    throw new ScheduledUploadWorkerError(
      "RELEASE_LEASE_LOST",
      "The scheduled upload release lease expired.",
      true,
    );
  }
  return sessionUri;
}

async function processFile(
  claim: ScheduledUploadReleaseClaim,
  item: ScheduledUploadReleaseItem,
  sessionUris: Map<string, string>,
  dependencies: ScheduledUploadWorkerDependencies,
) {
  if (!item.storageKey) {
    throw new ScheduledUploadWorkerError(
      "STAGED_CONTENT_MISSING",
      "The private staged content is no longer available.",
    );
  }
  const parentId = resolveParentId(item, claim);
  const remoteFileId = await ensureRemoteFileId(claim, item, dependencies);

  if (
    await reconcileCompletedFile(
      claim,
      item,
      remoteFileId,
      parentId,
      dependencies,
    )
  ) {
    return { operation: "item" as const, chunks: 0 };
  }

  const sessionUri = sessionUris.get(item.id) ?? null;
  if (!sessionUri) {
    if (!(await ensureFirstWriteAuthorization(claim, dependencies))) {
      return { operation: "none" as const, chunks: 0 };
    }
    await initializeUploadSession(
      claim,
      item,
      remoteFileId,
      parentId,
      dependencies,
    );
    return { operation: "item" as const, chunks: 0 };
  }

  const totalBytes = Number(item.size);
  const status = await dependencies.drive.queryUploadStatus(
    sessionUri,
    totalBytes,
  );
  if (status.kind === "complete") {
    return await handleCompleteStatus(claim, item, dependencies);
  }
  if (status.kind === "expired") {
    return await handleExpiredStatus(claim, item, dependencies);
  }

  const acknowledgedBytes = status.acknowledgedBytes;
  if (acknowledgedBytes >= totalBytes && totalBytes > 0) {
    throw new ScheduledUploadWorkerError(
      "DRIVE_INVALID_RANGE",
      "Google Drive returned an invalid upload offset.",
    );
  }
  const updatedOffset = await dependencies.store.updateItem(
    claim.schedule.id,
    item.id,
    claim.leaseToken,
    { status: "UPLOADING", remoteUploadOffset: BigInt(acknowledgedBytes) },
  );
  if (!updatedOffset) {
    throw new ScheduledUploadWorkerError(
      "RELEASE_LEASE_LOST",
      "The scheduled upload release lease expired.",
      true,
    );
  }

  const length = Math.min(
    dependencies.chunkSizeBytes,
    totalBytes - acknowledgedBytes,
  );
  if (length === 0 && totalBytes === 0) {
    return await handleEmptyFileUpload(claim, item, sessionUri, dependencies);
  }

  return await uploadFileChunk(
    claim,
    item,
    sessionUri,
    acknowledgedBytes,
    length,
    totalBytes,
    dependencies,
  );
}

async function handleCompleteStatus(
  claim: ScheduledUploadReleaseClaim,
  item: ScheduledUploadReleaseItem,
  dependencies: ScheduledUploadWorkerDependencies,
) {
  const updated = await dependencies.store.updateItem(
    claim.schedule.id,
    item.id,
    claim.leaseToken,
    {
      status: "COMPLETE",
      remoteUploadOffset: item.size,
      encryptedUploadSession: null,
      uploadSessionNonce: null,
      uploadSessionTag: null,
      uploadSessionKeyVersion: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    },
  );
  if (!updated) {
    throw new ScheduledUploadWorkerError(
      "RELEASE_LEASE_LOST",
      "The scheduled upload release lease expired.",
      true,
    );
  }
  await recordFirstWriteResponse(claim, dependencies);
  return { operation: "item" as const, chunks: 0 };
}

async function handleExpiredStatus(
  claim: ScheduledUploadReleaseClaim,
  item: ScheduledUploadReleaseItem,
  dependencies: ScheduledUploadWorkerDependencies,
) {
  const cleared = await dependencies.store.updateItem(
    claim.schedule.id,
    item.id,
    claim.leaseToken,
    {
      status: "PENDING",
      encryptedUploadSession: null,
      uploadSessionNonce: null,
      uploadSessionTag: null,
      uploadSessionKeyVersion: null,
      remoteUploadOffset: BigInt(0),
    },
  );
  if (!cleared) {
    throw new ScheduledUploadWorkerError(
      "RELEASE_LEASE_LOST",
      "The scheduled upload release lease expired.",
      true,
    );
  }
  return { operation: "item" as const, chunks: 0 };
}

async function handleEmptyFileUpload(
  claim: ScheduledUploadReleaseClaim,
  item: ScheduledUploadReleaseItem,
  sessionUri: string,
  dependencies: ScheduledUploadWorkerDependencies,
) {
  if (!(await ensureFirstWriteAuthorization(claim, dependencies))) {
    return { operation: "none" as const, chunks: 0 };
  }
  await markFirstWriteAttempt(claim, dependencies);
  const result = await dependencies.drive.uploadChunk({
    sessionUri,
    start: 0,
    totalBytes: 0,
    bytes: new Uint8Array(0),
  });
  if (result.kind !== "complete") {
    throw new ScheduledUploadWorkerError(
      "EMPTY_FILE_NOT_COMPLETED",
      "Google Drive did not complete the empty file upload.",
      true,
    );
  }
  const completed = await dependencies.store.updateItem(
    claim.schedule.id,
    item.id,
    claim.leaseToken,
    {
      status: "COMPLETE",
      remoteUploadOffset: BigInt(0),
      encryptedUploadSession: null,
      uploadSessionNonce: null,
      uploadSessionTag: null,
      uploadSessionKeyVersion: null,
    },
  );
  if (!completed) {
    throw new ScheduledUploadWorkerError(
      "RELEASE_LEASE_LOST",
      "The scheduled upload release lease expired.",
      true,
    );
  }
  await recordFirstWriteResponse(claim, dependencies);
  return { operation: "chunk" as const, chunks: 1 };
}

async function uploadFileChunk(
  claim: ScheduledUploadReleaseClaim,
  item: ScheduledUploadReleaseItem,
  sessionUri: string,
  acknowledgedBytes: number,
  length: number,
  totalBytes: number,
  dependencies: ScheduledUploadWorkerDependencies,
) {
  const bytes = await readChunkFromStorage(
    dependencies.storage,
    claim.schedule.id,
    item.storageKey!,
    acknowledgedBytes,
    length,
  );
  if (!(await ensureFirstWriteAuthorization(claim, dependencies))) {
    return { operation: "none" as const, chunks: 0 };
  }
  await markFirstWriteAttempt(claim, dependencies);
  const result = await dependencies.drive.uploadChunk({
    sessionUri,
    start: acknowledgedBytes,
    totalBytes,
    bytes,
  });
  if (result.kind !== "expired") {
    await recordFirstWriteResponse(claim, dependencies);
  }
  if (result.kind === "expired") {
    const cleared = await dependencies.store.updateItem(
      claim.schedule.id,
      item.id,
      claim.leaseToken,
      {
        status: "PENDING",
        encryptedUploadSession: null,
        uploadSessionNonce: null,
        uploadSessionTag: null,
        uploadSessionKeyVersion: null,
        remoteUploadOffset: BigInt(0),
      },
    );
    if (!cleared) {
      throw new ScheduledUploadWorkerError(
        "RELEASE_LEASE_LOST",
        "The scheduled upload release lease expired.",
        true,
      );
    }
    return { operation: "chunk" as const, chunks: 1 };
  }

  if (result.kind === "complete") {
    const completed = await dependencies.store.updateItem(
      claim.schedule.id,
      item.id,
      claim.leaseToken,
      {
        status: "COMPLETE",
        remoteUploadOffset: item.size,
        encryptedUploadSession: null,
        uploadSessionNonce: null,
        uploadSessionTag: null,
        uploadSessionKeyVersion: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    );
    if (!completed) {
      throw new ScheduledUploadWorkerError(
        "RELEASE_LEASE_LOST",
        "The scheduled upload release lease expired.",
        true,
      );
    }
    return { operation: "chunk" as const, chunks: 1 };
  }

  const savedOffset = await dependencies.store.updateItem(
    claim.schedule.id,
    item.id,
    claim.leaseToken,
    {
      status: "UPLOADING",
      remoteUploadOffset: BigInt(result.acknowledgedBytes),
    },
  );
  if (!savedOffset) {
    throw new ScheduledUploadWorkerError(
      "RELEASE_LEASE_LOST",
      "The scheduled upload release lease expired.",
      true,
    );
  }
  return { operation: "chunk" as const, chunks: 1 };
}

async function processClaim(
  claim: ScheduledUploadReleaseClaim,
  dependencies: ScheduledUploadWorkerDependencies,
) {
  if (!allStagingComplete(claim)) {
    await pauseForAttention(
      claim,
      dependencies,
      "STAGING_INCOMPLETE",
      "The committed staging package is incomplete.",
    );
    return { completed: false, operation: "none" as const, chunks: 0 };
  }

  const sessionUris = await getSessionUris(claim, dependencies);
  if (!sessionUris) {
    return { completed: false, operation: "none" as const, chunks: 0 };
  }

  if (claim.schedule.firstWriteAttemptAt === null) {
    const firstWriteResult = await handleFirstWrite(claim, dependencies);
    if (firstWriteResult) return firstWriteResult;
  }

  const item = chooseNextItem(claim);
  if (!item) {
    return await completeSchedule(claim, dependencies);
  }

  if (item.kind === "FOLDER") {
    const result = await processFolder(claim, item, dependencies);
    if (result.operation === "none") return { completed: false, ...result };
    await releaseProgressClaim(claim, dependencies);
    return { completed: false, ...result };
  }
  const result = await processFile(claim, item, sessionUris, dependencies);
  if (result.operation === "none") return { completed: false, ...result };
  await releaseProgressClaim(claim, dependencies);
  return { completed: false, ...result };
}

async function getSessionUris(
  claim: ScheduledUploadReleaseClaim,
  dependencies: ScheduledUploadWorkerDependencies,
): Promise<Map<string, string> | null> {
  let sessionUris: Map<string, string>;
  try {
    sessionUris = currentSessionUris(claim, dependencies);
    if (needsActiveEncryptionKey(claim)) {
      dependencies.assertEncryptionAvailable();
    }
  } catch (error) {
    if (error instanceof ScheduledUploadSessionCryptoError) {
      await pauseForAttention(
        claim,
        dependencies,
        error.code === "MISSING_KEY"
          ? "SESSION_KEY_MISSING"
          : "SESSION_TAMPERED",
        error.message,
      );
      return null;
    }
    throw error;
  }
  return sessionUris;
}

async function handleFirstWrite(
  claim: ScheduledUploadReleaseClaim,
  dependencies: ScheduledUploadWorkerDependencies,
) {
  const role = await dependencies.resolveRole(claim.schedule.creatorEmail);
  if (role !== "EDITOR" && role !== "ADMIN") {
    await pauseForAttention(
      claim,
      dependencies,
      "CREATOR_ROLE_REVOKED",
      "The creator no longer has editor access.",
    );
    return { completed: false, operation: "none" as const, chunks: 0 };
  }

  const verification = await verifyStagingBeforeRelease(claim, dependencies);
  if (verification === "invalid") {
    await pauseForAttention(
      claim,
      dependencies,
      "STAGE_INTEGRITY_FAILED",
      "Staged content no longer matches the committed package.",
    );
    return { completed: false, operation: "none" as const, chunks: 0 };
  }
  if (verification === "progress") {
    await dependencies.store.finishClaim({
      scheduleId: claim.schedule.id,
      leaseToken: claim.leaseToken,
      attemptId: claim.attemptId,
      status: "RELEASING",
    });
    return { completed: false, operation: "item" as const, chunks: 0 };
  }

  const canAccessDestination = await checkDestinationAccess(
    claim,
    dependencies,
    role,
  );
  if (!canAccessDestination) {
    await pauseForAttention(
      claim,
      dependencies,
      "DESTINATION_ACCESS_REVOKED",
      "The creator no longer has access to the selected destination folder.",
      "DESTINATION_ACCESS_REVOKED",
    );
    return { completed: false, operation: "none" as const, chunks: 0 };
  }

  const destValidation = await validateDestination(claim, dependencies);
  if (destValidation) return destValidation;
  return null;
}

async function checkDestinationAccess(
  claim: ScheduledUploadReleaseClaim,
  dependencies: ScheduledUploadWorkerDependencies,
  role: ScheduledUploadWorkerRole,
) {
  let canAccessDestination = false;
  try {
    canAccessDestination = await dependencies.canAccessDestination(
      scheduledUploadAccessEmail(claim.schedule),
      claim.schedule.destinationId,
      role,
    );
  } catch {
    canAccessDestination = false;
  }
  return canAccessDestination;
}

async function validateDestination(
  claim: ScheduledUploadReleaseClaim,
  dependencies: ScheduledUploadWorkerDependencies,
) {
  try {
    await validateDestinationChain(
      claim.schedule.destinationId,
      dependencies.drive,
    );
    return null;
  } catch (error) {
    if (error instanceof ScheduledUploadWorkerError) {
      if (error.retryable) {
        await pauseForRetry(claim, dependencies, error.code, error.message);
      } else {
        await pauseForAttention(claim, dependencies, error.code, error.message);
      }
      return { completed: false, operation: "none" as const, chunks: 0 };
    }
    if (error instanceof ScheduledUploadDriveError) {
      if (isRetryableDriveStatus(error.status)) {
        await pauseForRetry(
          claim,
          dependencies,
          `DRIVE_HTTP_${error.status}`,
          "Google Drive is temporarily unavailable.",
          error.retryAfterSeconds,
        );
      } else {
        await pauseForAttention(
          claim,
          dependencies,
          `DRIVE_HTTP_${error.status}`,
          "The Drive destination could not be verified.",
        );
      }
      return { completed: false, operation: "none" as const, chunks: 0 };
    }
    throw error;
  }
}

async function completeSchedule(
  claim: ScheduledUploadReleaseClaim,
  dependencies: ScheduledUploadWorkerDependencies,
) {
  const finished = await dependencies.store.finishClaim({
    scheduleId: claim.schedule.id,
    leaseToken: claim.leaseToken,
    attemptId: claim.attemptId,
    status: "COMPLETED",
  });
  if (!finished) {
    throw new ScheduledUploadWorkerError(
      "RELEASE_LEASE_LOST",
      "The scheduled upload release lease expired.",
      true,
    );
  }
  await dependencies.retryCleanup(claim.schedule.id);
  return { completed: true, operation: "none" as const, chunks: 0 };
}

async function handleClaimError(
  claim: ScheduledUploadReleaseClaim,
  error: unknown,
  dependencies: ScheduledUploadWorkerDependencies,
) {
  if (error instanceof ScheduledUploadSessionCryptoError) {
    await pauseForAttention(
      claim,
      dependencies,
      error.code === "MISSING_KEY" ? "SESSION_KEY_MISSING" : "SESSION_TAMPERED",
      error.message,
    );
    return;
  }
  if (error instanceof ScheduledUploadDriveError) {
    if (isRetryableDriveStatus(error.status)) {
      await pauseForRetry(
        claim,
        dependencies,
        `DRIVE_HTTP_${error.status}`,
        "Google Drive is temporarily unavailable.",
        error.retryAfterSeconds,
      );
      return;
    }
    await pauseForAttention(
      claim,
      dependencies,
      `DRIVE_HTTP_${error.status}`,
      "Google Drive rejected the scheduled upload.",
    );
    return;
  }
  if (error instanceof ScheduledUploadWorkerError) {
    if (error.retryable) {
      await pauseForRetry(claim, dependencies, error.code, error.message);
    } else {
      await pauseForAttention(claim, dependencies, error.code, error.message);
    }
    return;
  }
  await pauseForRetry(
    claim,
    dependencies,
    "WORKER_UNEXPECTED_ERROR",
    "The scheduled upload worker will retry this package.",
  );
}

async function runWorkerTick(dependencies: ScheduledUploadWorkerDependencies) {
  const startedAt = dependencies.now().getTime();
  const summary = createSummary();

  await runCleanup(dependencies, summary);

  while (shouldContinue(summary, dependencies, startedAt)) {
    const claim = await claimNextSchedule(dependencies, summary);
    if (!claim) break;

    await processClaimWithSummary(claim, dependencies, summary);
  }

  summary.elapsedMs = Math.max(0, dependencies.now().getTime() - startedAt);
  return summary;
}

function createSummary() {
  return {
    claimedSchedules: 0,
    completedSchedules: 0,
    cleanedSchedules: 0,
    cleanupFailures: 0,
    processedItems: 0,
    uploadedChunks: 0,
    leaseRecoveries: 0,
    pausedSchedules: 0,
    elapsedMs: 0,
  };
}

async function runCleanup(
  dependencies: ScheduledUploadWorkerDependencies,
  summary: ReturnType<typeof createSummary>,
) {
  try {
    summary.cleanedSchedules = await dependencies.retryPendingCleanup();
  } catch {
    summary.cleanupFailures += 1;
  }
}

function shouldContinue(
  summary: ReturnType<typeof createSummary>,
  dependencies: ScheduledUploadWorkerDependencies,
  startedAt: number,
) {
  return (
    summary.claimedSchedules < dependencies.maxSchedulesPerTick &&
    summary.processedItems < dependencies.maxItemsPerTick &&
    summary.uploadedChunks < dependencies.maxChunksPerTick &&
    dependencies.now().getTime() - startedAt < dependencies.maxDurationMs
  );
}

async function claimNextSchedule(
  dependencies: ScheduledUploadWorkerDependencies,
  summary: ReturnType<typeof createSummary>,
) {
  let claim: ScheduledUploadReleaseClaim | null;
  try {
    claim = await dependencies.store.claimNextScheduledUpload();
  } catch {
    summary.pausedSchedules += 1;
    return null;
  }
  if (!claim) return null;

  summary.claimedSchedules += 1;
  if (claim.leaseRecovered) summary.leaseRecoveries += 1;
  return claim;
}

async function processClaimWithSummary(
  claim: ScheduledUploadReleaseClaim,
  dependencies: ScheduledUploadWorkerDependencies,
  summary: ReturnType<typeof createSummary>,
) {
  try {
    const result = await processClaim(claim, dependencies);
    if (result.operation !== "none") summary.processedItems += 1;
    summary.uploadedChunks += result.chunks;
    if (result.completed) summary.completedSchedules += 1;
    else if (result.operation === "none") summary.pausedSchedules += 1;
  } catch (error) {
    summary.pausedSchedules += 1;
    await handleClaimError(claim, error, dependencies);
  }
}

export async function runScheduledUploadWorkerTick() {
  const summary = await createScheduledUploadWorker().runTick();
  const adminAlertEmails = await deliverNextScheduledUploadAdminAlertEmail();
  return { ...summary, adminAlertEmails };
}

export const SCHEDULED_UPLOAD_WORKER_LIMITS = {
  chunkSizeBytes: CHUNK_SIZE_BYTES,
  maxSchedulesPerTick: 2,
  maxItemsPerTick: 2,
  maxChunksPerTick: 1,
  maxDurationMs: 7_000,
};
