import { randomUUID } from "node:crypto";
import { ApiRouteError } from "@/lib/api-middleware";
import { db } from "@/lib/db";
import { kv } from "@/lib/kv";
import { resolveRole } from "@/lib/services/auth-jwt";
import { getPrivateFolderIds } from "@/lib/utils";
import {
  getScheduledUploadLimits,
  privateScheduledUploadStorage,
  validateScheduledUploadManifest,
  type ScheduledUploadManifestEntryInput,
} from "@/lib/storage/private-scheduled-uploads";

type ScheduledUploadStatus =
  | "STAGING"
  | "WAITING"
  | "RELEASING"
  | "PARTIAL"
  | "NEEDS_ATTENTION"
  | "COMPLETED"
  | "CANCELED"
  | "ABANDONED";

const TERMINAL_STATUS_VALUES = ["COMPLETED", "CANCELED", "ABANDONED"] as const;
const TERMINAL_STATUSES = new Set<string>(TERMINAL_STATUS_VALUES);
const PRIVATE_METADATA_BODY_LIMIT = 1024 * 1024;
const UPLOAD_LEASE_MS = 30 * 60 * 1000;
const PROGRESS_PERSIST_BYTES = 8 * 1024 * 1024;

export interface ScheduledUploadActor {
  email: string;
}

export interface ScheduledUploadReleaseItem {
  id: string;
  manifestPath: string;
  kind: "FILE" | "FOLDER";
  status:
    | "PENDING"
    | "STAGING"
    | "STAGED"
    | "UPLOADING"
    | "COMPLETE"
    | "FAILED";
  size: bigint;
  sha256: string | null;
  contentType: string | null;
  storageKey: string | null;
  uploadedBytes: bigint;
  remoteFileId: string | null;
  encryptedUploadSession: string | null;
  uploadSessionNonce: string | null;
  uploadSessionTag: string | null;
  uploadSessionKeyVersion: string | null;
  remoteUploadOffset: bigint;
  releaseVerifiedAt: Date | null;
  retryAfter: Date | null;
}

export interface ScheduledUploadReleaseSchedule {
  id: string;
  creatorEmail: string;
  creatorAccessEmail: string | null;
  destinationId: string;
  scheduledAt: Date;
  status: ScheduledUploadStatus;
  itemCount: number;
  totalBytes: bigint;
  stagedBytes: bigint;
  stageCompleteAt: Date | null;
  firstWriteAttemptAt: Date | null;
  workerRetryCount: number;
  items: ScheduledUploadReleaseItem[];
}

export interface ScheduledUploadReleaseClaim {
  schedule: ScheduledUploadReleaseSchedule;
  leaseToken: string;
  attemptId: string;
  leaseRecovered: boolean;
}

export interface ScheduledUploadReleaseItemUpdate {
  status?: ScheduledUploadReleaseItem["status"];
  remoteFileId?: string | null;
  encryptedUploadSession?: string | null;
  uploadSessionNonce?: string | null;
  uploadSessionTag?: string | null;
  uploadSessionKeyVersion?: string | null;
  remoteUploadOffset?: bigint;
  releaseVerifiedAt?: Date | null;
  attemptCount?: { increment: number };
  retryAfter?: Date | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
}

export interface CreateScheduledUploadInput {
  destinationId: string;
  scheduledLocalTime: string;
  timeZone: string;
  utcOffset: string;
  items: ScheduledUploadManifestEntryInput[];
}

interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function badRequest(message: string): never {
  throw new ApiRouteError(400, message);
}

function notFound(): never {
  throw new ApiRouteError(404, "Scheduled upload not found.");
}

function conflict(message: string): never {
  throw new ApiRouteError(409, message);
}

function actorEmail(actor: ScheduledUploadActor) {
  const email = actor.email.trim().toLowerCase();
  if (!email)
    throw new ApiRouteError(401, "An authenticated email is required.");
  return email;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseCreateInput(value: unknown): CreateScheduledUploadInput {
  if (!isRecord(value)) badRequest("A JSON request body is required.");
  if (
    typeof value.destinationId !== "string" ||
    !value.destinationId.trim() ||
    value.destinationId.length > 512
  ) {
    badRequest("A valid Google Drive destination is required.");
  }
  if (!Array.isArray(value.items))
    badRequest("A manifest item list is required.");
  if (
    typeof value.scheduledLocalTime !== "string" ||
    typeof value.timeZone !== "string" ||
    typeof value.utcOffset !== "string"
  ) {
    badRequest("The local time, IANA time zone, and UTC offset are required.");
  }

  const items = value.items as ScheduledUploadManifestEntryInput[];
  let manifest: ReturnType<typeof validateScheduledUploadManifest>;
  try {
    manifest = validateScheduledUploadManifest(items);
  } catch (error) {
    badRequest(
      error instanceof Error ? error.message : "The manifest is invalid.",
    );
  }

  return {
    destinationId: value.destinationId.trim(),
    scheduledLocalTime: value.scheduledLocalTime,
    timeZone: value.timeZone,
    utcOffset: value.utcOffset,
    items: manifest.items,
  };
}

function parseLocalTime(value: string): LocalDateTimeParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match)
    badRequest("Scheduled local time must use YYYY-MM-DDTHH:mm format.");
  const parts = match.slice(1).map(Number);
  const [year, month, day, hour, minute] = parts;
  if (
    year < 1000 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour > 23 ||
    minute > 59
  ) {
    badRequest("Scheduled local time is invalid.");
  }
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    badRequest("Scheduled local time is invalid.");
  }
  return { year, month, day, hour, minute };
}

function parseOffset(value: string) {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(value);
  if (!match) badRequest("UTC offset must use +HH:mm or -HH:mm format.");
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) {
    badRequest("UTC offset is invalid.");
  }
  const total = hours * 60 + minutes;
  return match[1] === "+" ? total : -total;
}

function formatter(timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-US-u-ca-iso8601-nu-latn", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    badRequest("A valid IANA time zone is required.");
  }
}

function partsAt(instant: number, timeZoneFormatter: Intl.DateTimeFormat) {
  const parts = Object.fromEntries(
    timeZoneFormatter
      .formatToParts(new Date(instant))
      .map(({ type, value }) => [type, value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function offsetAt(instant: number, timeZoneFormatter: Intl.DateTimeFormat) {
  const local = partsAt(instant, timeZoneFormatter);
  return (
    (Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
    ) -
      instant) /
    60_000
  );
}

function matchesLocalTime(
  instant: number,
  parts: LocalDateTimeParts,
  timeZoneFormatter: Intl.DateTimeFormat,
) {
  const actual = partsAt(instant, timeZoneFormatter);
  return (
    actual.year === parts.year &&
    actual.month === parts.month &&
    actual.day === parts.day &&
    actual.hour === parts.hour &&
    actual.minute === parts.minute &&
    actual.second === 0
  );
}

export function resolveScheduledInstant(
  scheduledLocalTime: string,
  timeZone: string,
  utcOffset: string,
  now = new Date(),
) {
  const local = parseLocalTime(scheduledLocalTime);
  const expectedOffset = parseOffset(utcOffset);
  const timeZoneFormatter = formatter(timeZone);
  const localAsUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
  );
  const candidateOffsets = new Set<number>();
  const scanRange = 36 * 60 * 60 * 1000;
  const scanStep = 30 * 60 * 1000;

  for (
    let instant = localAsUtc - scanRange;
    instant <= localAsUtc + scanRange;
    instant += scanStep
  ) {
    candidateOffsets.add(offsetAt(instant, timeZoneFormatter));
  }

  const candidates = new Map<number, number>();
  for (const offset of candidateOffsets) {
    const candidate = localAsUtc - offset * 60_000;
    if (matchesLocalTime(candidate, local, timeZoneFormatter)) {
      candidates.set(candidate, offset);
    }
  }
  if (candidates.size === 0) {
    badRequest("This local time does not exist in the selected time zone.");
  }
  if (candidates.size > 1) {
    badRequest(
      "This local time is ambiguous because of a daylight saving transition.",
    );
  }

  const [instant, actualOffset] = [...candidates.entries()][0];
  if (actualOffset !== expectedOffset) {
    badRequest(
      "The UTC offset does not match the selected time zone at this local time.",
    );
  }
  if (instant <= now.getTime()) {
    badRequest("Scheduled time must be in the future.");
  }
  return new Date(instant);
}

function itemToResponse(item: Record<string, unknown>) {
  return {
    id: item.id,
    path: item.manifestPath,
    kind: item.kind,
    size: String(item.size ?? 0),
    uploadedBytes: String(item.uploadedBytes ?? 0),
    status: item.status,
    contentType: item.contentType ?? null,
    stagedAt: item.stagedAt ?? null,
  };
}

function scheduleToResponse(schedule: Record<string, unknown>) {
  const items = Array.isArray(schedule.items) ? schedule.items : [];
  return {
    id: schedule.id,
    creatorEmail: schedule.creatorEmail,
    destinationId: schedule.destinationId,
    scheduledAt: schedule.scheduledAt,
    scheduledLocalTime: schedule.scheduledLocalTime,
    timeZone: schedule.scheduledTimeZone,
    utcOffset: schedule.scheduledUtcOffset,
    status: schedule.status,
    itemCount: schedule.itemCount,
    totalBytes: String(schedule.totalBytes ?? 0),
    stagedBytes: String(schedule.stagedBytes ?? 0),
    stageCompleteAt: schedule.stageCompleteAt ?? null,
    firstWriteAt: schedule.firstWriteAt ?? null,
    firstWriteAttemptAt: schedule.firstWriteAttemptAt ?? null,
    claimedAt: schedule.claimedAt ?? null,
    completedAt: schedule.completedAt ?? null,
    pollerLagMs:
      schedule.pollerLagMs === null || schedule.pollerLagMs === undefined
        ? null
        : String(schedule.pollerLagMs),
    leaseRecoveryCount: schedule.leaseRecoveryCount ?? 0,
    workerRetryCount: schedule.workerRetryCount ?? 0,
    retryAfter: schedule.retryAfter ?? null,
    lastErrorCode: schedule.lastErrorCode ?? null,
    lastErrorMessage: schedule.lastErrorMessage ?? null,
    cleanupStatus: schedule.cleanupStatus,
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt,
    items: items.map((item) => itemToResponse(item as Record<string, unknown>)),
  };
}

async function getActorUser(email: string) {
  return db.user.findUnique({ where: { email } });
}

async function isAdmin(email: string) {
  return (await resolveRole(email)) === "ADMIN";
}

async function getVisibleSchedule(scheduleId: string, email: string) {
  const schedule = await db.scheduledUpload.findUnique({
    where: { id: scheduleId },
    include: { items: { orderBy: { manifestPath: "asc" } } },
  });
  if (!schedule) notFound();
  const actor = await getActorUser(email);
  if (schedule.creatorId !== actor?.id && !(await isAdmin(email))) notFound();
  return schedule;
}

async function terminalCleanupPending(scheduleId: string) {
  const schedule = await db.scheduledUpload.findUnique({
    where: { id: scheduleId },
    select: { status: true, cleanupStatus: true },
  });
  return Boolean(
    schedule &&
      TERMINAL_STATUSES.has(schedule.status) &&
      schedule.cleanupStatus === "PENDING",
  );
}

export async function retryScheduledUploadCleanup(scheduleId: string) {
  if (!(await terminalCleanupPending(scheduleId))) return false;

  const activeWriters = await db.scheduledUploadItem.count({
    where: {
      scheduleId,
      uploadToken: { not: null },
      uploadLeaseUntil: { gt: new Date() },
    },
  });
  if (activeWriters > 0) return false;

  try {
    await privateScheduledUploadStorage.removeSchedule(scheduleId);
    await db.scheduledUpload.updateMany({
      where: {
        id: scheduleId,
        status: { in: [...TERMINAL_STATUS_VALUES] },
        cleanupStatus: "PENDING",
      },
      data: { cleanupStatus: "COMPLETE" },
    });
    return true;
  } catch {
    return false;
  }
}

export async function purgePendingScheduledUploadBlobs(limit = 100) {
  const pending = await db.scheduledUpload.findMany({
    where: {
      status: { in: [...TERMINAL_STATUS_VALUES] },
      cleanupStatus: "PENDING",
    },
    select: { id: true },
    take: Math.min(Math.max(limit, 1), 500),
    orderBy: { updatedAt: "asc" },
  });
  for (const schedule of pending)
    await retryScheduledUploadCleanup(schedule.id);
  return pending.length;
}

export async function canAccessScheduledUploadDestination(
  email: string,
  destinationId: string,
  role: "ADMIN" | "EDITOR" | "USER",
) {
  if (role === "ADMIN") return true;

  const cleanFolderId = destinationId.trim();
  if (!cleanFolderId) return false;
  const accessEmail = email.trim();
  const [hasExplicitAccess, isProtected] = await Promise.all([
    kv
      .sismember(`folder:access:${cleanFolderId}`, accessEmail)
      .then((result) => result === 1)
      .catch(() => false),
    db.protectedFolder
      .findUnique({
        where: { folderId: cleanFolderId },
        select: { folderId: true },
      })
      .then((folder) => folder !== null)
      .catch(() => true),
  ]);

  const isPrivate = getPrivateFolderIds().includes(cleanFolderId);
  return hasExplicitAccess || (!isPrivate && !isProtected);
}

export async function createScheduledUpload(
  value: unknown,
  actor: ScheduledUploadActor,
) {
  const email = actorEmail(actor);
  const accessEmail = actor.email.trim();
  const input = parseCreateInput(value);
  const role = await resolveRole(email);
  if (role !== "EDITOR" && role !== "ADMIN") {
    throw new ApiRouteError(403, "Editor or administrator access is required.");
  }
  const creator = await getActorUser(email);
  if (!creator)
    throw new ApiRouteError(403, "A registered Vaehor account is required.");
  if (
    !(await canAccessScheduledUploadDestination(
      accessEmail,
      input.destinationId,
      role,
    ))
  ) {
    throw new ApiRouteError(
      403,
      "You do not have access to the selected destination folder.",
    );
  }

  let scheduledAt: Date;
  try {
    scheduledAt = resolveScheduledInstant(
      input.scheduledLocalTime,
      input.timeZone,
      input.utcOffset,
    );
  } catch (error) {
    if (error instanceof ApiRouteError) throw error;
    badRequest("The scheduled local time is invalid.");
  }

  const manifest = validateScheduledUploadManifest(input.items);
  try {
    await privateScheduledUploadStorage.assertPackageCapacity(
      manifest.totalBytes,
    );
  } catch (error) {
    throw new ApiRouteError(
      507,
      error instanceof Error
        ? error.message
        : "Private staging capacity is unavailable.",
    );
  }

  const schedule = await db.scheduledUpload.create({
    data: {
      creatorId: creator.id,
      creatorEmail: email,
      creatorAccessEmail: accessEmail,
      destinationId: input.destinationId,
      scheduledAt,
      scheduledTimeZone: input.timeZone,
      scheduledLocalTime: input.scheduledLocalTime,
      scheduledUtcOffset: input.utcOffset,
      status: "STAGING",
      itemCount: manifest.items.length,
      totalBytes: BigInt(manifest.totalBytes),
      items: {
        create: manifest.items.map((item) => ({
          manifestPath: item.path,
          kind: item.kind === "file" ? "FILE" : "FOLDER",
          status: "PENDING",
          size: BigInt(item.size),
          sha256: item.sha256,
          contentType: item.contentType,
          storageKey:
            item.kind === "file" ? randomUUID().replaceAll("-", "") : null,
        })),
      },
    },
    include: { items: { orderBy: { manifestPath: "asc" } } },
  });
  return scheduleToResponse(schedule as unknown as Record<string, unknown>);
}

export async function listScheduledUploads(actor: ScheduledUploadActor) {
  const email = actorEmail(actor);
  const admin = await isAdmin(email);
  const user = admin ? null : await getActorUser(email);
  const schedules = await db.scheduledUpload.findMany({
    where: admin
      ? undefined
      : { creatorId: user?.id ?? "__no_matching_user__" },
    include: { items: { orderBy: { manifestPath: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  for (const schedule of schedules) {
    if (
      TERMINAL_STATUSES.has(schedule.status) &&
      schedule.cleanupStatus === "PENDING"
    ) {
      await retryScheduledUploadCleanup(schedule.id);
    }
  }
  return schedules.map((schedule) =>
    scheduleToResponse(schedule as unknown as Record<string, unknown>),
  );
}

export async function getScheduledUpload(
  scheduleId: string,
  actor: ScheduledUploadActor,
) {
  const email = actorEmail(actor);
  const schedule = await getVisibleSchedule(scheduleId, email);
  if (
    TERMINAL_STATUSES.has(schedule.status) &&
    schedule.cleanupStatus === "PENDING"
  ) {
    await retryScheduledUploadCleanup(scheduleId);
    const refreshed = await db.scheduledUpload.findUnique({
      where: { id: scheduleId },
      include: { items: { orderBy: { manifestPath: "asc" } } },
    });
    if (refreshed)
      return scheduleToResponse(
        refreshed as unknown as Record<string, unknown>,
      );
  }
  return scheduleToResponse(schedule as unknown as Record<string, unknown>);
}

async function setTerminalStatus(
  scheduleId: string,
  email: string,
  allowedStatuses: ScheduledUploadStatus[],
  targetStatus: "CANCELED" | "ABANDONED",
) {
  await getVisibleSchedule(scheduleId, email);
  const updated = await db.scheduledUpload.updateMany({
    where: { id: scheduleId, status: { in: allowedStatuses } },
    data: {
      status: targetStatus,
      cleanupStatus: "PENDING",
      lastErrorCode: null,
      lastErrorMessage: null,
      releaseLeaseToken: null,
      releaseLeaseUntil: null,
    },
  });
  if (updated.count !== 1)
    conflict("The scheduled upload can no longer be changed.");
  await retryScheduledUploadCleanup(scheduleId);
  return getScheduledUpload(scheduleId, { email });
}

export async function cancelScheduledUpload(
  scheduleId: string,
  actor: ScheduledUploadActor,
) {
  return setTerminalStatus(
    scheduleId,
    actorEmail(actor),
    ["STAGING", "WAITING"],
    "CANCELED",
  );
}

export async function cancelScheduledUploadAsAdmin(
  scheduleId: string,
  actor: ScheduledUploadActor,
) {
  const email = actorEmail(actor);
  if (!(await isAdmin(email))) notFound();
  await getVisibleSchedule(scheduleId, email);

  const updated = await db.scheduledUpload.updateMany({
    where: {
      id: scheduleId,
      status: {
        in: ["STAGING", "WAITING", "RELEASING", "PARTIAL", "NEEDS_ATTENTION"],
      },
      firstWriteAttemptAt: null,
    },
    data: {
      status: "CANCELED",
      cleanupStatus: "PENDING",
      lastErrorCode: null,
      lastErrorMessage: null,
      releaseLeaseToken: null,
      releaseLeaseUntil: null,
    },
  });
  if (updated.count !== 1) {
    conflict("The scheduled upload has already started writing to Drive.");
  }

  await db.scheduledUploadAdminAlert.updateMany({
    where: {
      scheduleId,
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
    },
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
      resolvedByEmail: email,
    },
  });
  await retryScheduledUploadCleanup(scheduleId);
  return getScheduledUpload(scheduleId, { email });
}

export async function abandonScheduledUpload(
  scheduleId: string,
  actor: ScheduledUploadActor,
) {
  return setTerminalStatus(
    scheduleId,
    actorEmail(actor),
    ["STAGING", "WAITING", "PARTIAL", "NEEDS_ATTENTION"],
    "ABANDONED",
  );
}

export async function updateScheduledUploadTime(
  scheduleId: string,
  value: unknown,
  actor: ScheduledUploadActor,
) {
  const email = actorEmail(actor);
  const schedule = await getVisibleSchedule(scheduleId, email);
  if (!["STAGING", "WAITING"].includes(schedule.status))
    conflict("Only a staging or waiting scheduled upload can be rescheduled.");
  if (!isRecord(value)) badRequest("A JSON request body is required.");
  if (
    typeof value.scheduledLocalTime !== "string" ||
    typeof value.timeZone !== "string" ||
    typeof value.utcOffset !== "string"
  ) {
    badRequest("The local time, IANA time zone, and UTC offset are required.");
  }
  const scheduledAt = resolveScheduledInstant(
    value.scheduledLocalTime,
    value.timeZone,
    value.utcOffset,
  );
  const updated = await db.scheduledUpload.updateMany({
    where: { id: scheduleId, status: { in: ["STAGING", "WAITING"] } },
    data: {
      scheduledAt,
      scheduledTimeZone: value.timeZone,
      scheduledLocalTime: value.scheduledLocalTime,
      scheduledUtcOffset: value.utcOffset,
      retryAfter: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    },
  });
  if (updated.count !== 1)
    conflict("The scheduled upload can no longer be rescheduled.");
  return getScheduledUpload(scheduleId, { email });
}

export async function retryScheduledUpload(
  scheduleId: string,
  actor: ScheduledUploadActor,
) {
  const email = actorEmail(actor);
  const schedule = await getVisibleSchedule(scheduleId, email);
  if (schedule.creatorEmail.toLowerCase().trim() !== email) {
    conflict("Only the schedule creator can retry this upload.");
  }
  const role = await resolveRole(email);
  if (role !== "EDITOR" && role !== "ADMIN") {
    conflict("The creator must regain editor access before retrying.");
  }
  const updated = await db.scheduledUpload.updateMany({
    where: { id: scheduleId, status: { in: ["PARTIAL", "NEEDS_ATTENTION"] } },
    data: {
      status: "WAITING",
      retryAfter: null,
      releaseLeaseToken: null,
      releaseLeaseUntil: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    },
  });
  if (updated.count !== 1)
    conflict("Only a partial or needs-attention schedule can be retried.");
  return getScheduledUpload(scheduleId, { email });
}

export async function stageScheduledUploadItem(input: {
  scheduleId: string;
  itemId: string;
  actor: ScheduledUploadActor;
  body: ReadableStream<Uint8Array> | null;
  contentLength?: string | null;
}) {
  const email = actorEmail(input.actor);
  const schedule = await getVisibleSchedule(input.scheduleId, email);
  if (schedule.status !== "STAGING")
    conflict("Files can only be staged before package commit.");
  const item = schedule.items.find((entry) => entry.id === input.itemId);
  if (!item || item.kind !== "FILE" || !item.storageKey) notFound();
  if (item.status === "STAGED") conflict("This file has already been staged.");
  const expectedSize = Number(item.size);
  if (input.contentLength !== undefined && input.contentLength !== null) {
    const declaredLength = Number(input.contentLength);
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength !== expectedSize
    ) {
      badRequest("Content-Length does not match the declared manifest size.");
    }
  }

  const token = randomUUID();
  const storageKey = randomUUID().replaceAll("-", "");
  const now = new Date();
  const claimed = await db.scheduledUploadItem.updateMany({
    where: {
      id: item.id,
      scheduleId: input.scheduleId,
      status: { in: ["PENDING", "STAGING"] },
      OR: [{ uploadLeaseUntil: null }, { uploadLeaseUntil: { lte: now } }],
      schedule: { status: "STAGING" },
    },
    data: {
      status: "STAGING",
      uploadedBytes: BigInt(0),
      storageKey,
      uploadToken: token,
      uploadLeaseUntil: new Date(now.getTime() + UPLOAD_LEASE_MS),
      attemptCount: { increment: 1 },
      lastErrorCode: null,
      lastErrorMessage: null,
    },
  });
  if (claimed.count !== 1)
    conflict("Another staging request is active for this file.");

  let lastProgressPersisted = 0;
  try {
    const written = await privateScheduledUploadStorage.writeStream({
      scheduleId: input.scheduleId,
      storageKey,
      body: input.body,
      expectedSize,
      expectedSha256: item.sha256 ?? undefined,
      onProgress: async (bytesWritten) => {
        if (bytesWritten - lastProgressPersisted < PROGRESS_PERSIST_BYTES)
          return;
        lastProgressPersisted = bytesWritten;
        await db.scheduledUploadItem.updateMany({
          where: { id: item.id, uploadToken: token },
          data: {
            uploadedBytes: BigInt(bytesWritten),
            uploadLeaseUntil: new Date(Date.now() + UPLOAD_LEASE_MS),
          },
        });
      },
    });

    await db.$transaction(async (tx) => {
      const finalized = await tx.scheduledUploadItem.updateMany({
        where: {
          id: item.id,
          scheduleId: input.scheduleId,
          uploadToken: token,
          schedule: { status: "STAGING" },
        },
        data: {
          status: "STAGED",
          uploadedBytes: BigInt(written.size),
          sha256: written.sha256,
          stagedAt: new Date(),
        },
      });
      if (finalized.count !== 1)
        conflict("The scheduled upload changed while this file was staging.");

      const updatedSchedule = await tx.scheduledUpload.updateMany({
        where: { id: input.scheduleId, status: "STAGING" },
        data: { stagedBytes: { increment: BigInt(written.size) } },
      });
      if (updatedSchedule.count !== 1)
        conflict("The scheduled upload changed while this file was staging.");

      const released = await tx.scheduledUploadItem.updateMany({
        where: {
          id: item.id,
          scheduleId: input.scheduleId,
          uploadToken: token,
          schedule: { status: "STAGING" },
        },
        data: { uploadToken: null, uploadLeaseUntil: null },
      });
      if (released.count !== 1)
        conflict("The scheduled upload changed while this file was staging.");
    });
    return {
      itemId: item.id,
      path: item.manifestPath,
      status: "STAGED",
      uploadedBytes: String(written.size),
      size: String(written.size),
      sha256: written.sha256,
    };
  } catch (error) {
    await privateScheduledUploadStorage
      .removeFile(input.scheduleId, storageKey)
      .catch(() => undefined);
    await db.scheduledUploadItem.updateMany({
      where: { id: item.id, uploadToken: token },
      data: {
        status: "PENDING",
        uploadedBytes: BigInt(0),
        uploadToken: null,
        uploadLeaseUntil: null,
        lastErrorCode: "STAGING_FAILED",
        lastErrorMessage:
          error instanceof Error
            ? error.message.slice(0, 500)
            : "File staging failed.",
      },
    });
    throw error;
  }
}

export async function commitScheduledUpload(
  scheduleId: string,
  actor: ScheduledUploadActor,
) {
  const email = actorEmail(actor);
  const schedule = await getVisibleSchedule(scheduleId, email);
  if (schedule.status !== "STAGING")
    conflict("Only a staging package can be committed.");
  if (schedule.items.length !== schedule.itemCount) {
    conflict("The schedule manifest is incomplete and cannot be committed.");
  }

  const complete = schedule.items.every(
    (item) =>
      item.kind === "FOLDER" ||
      (item.status === "STAGED" &&
        item.storageKey !== null &&
        item.stagedAt !== null &&
        Number(item.uploadedBytes) === Number(item.size)),
  );
  if (!complete)
    conflict("Every manifest file must be fully staged before commit.");

  for (const item of schedule.items) {
    if (item.kind === "FOLDER") continue;
    if (!item.sha256) {
      await db.scheduledUpload.updateMany({
        where: { id: scheduleId, status: "STAGING" },
        data: {
          lastErrorCode: "STAGE_VERIFICATION_FAILED",
          lastErrorMessage: "Staged file is missing its SHA-256 hash.",
        },
      });
      conflict("Staged file is missing its SHA-256 hash.");
    }
    const readable = await privateScheduledUploadStorage.verifyFile({
      scheduleId,
      storageKey: item.storageKey!,
      expectedSize: Number(item.size),
      expectedSha256: item.sha256 ?? "",
    });
    if (!readable) {
      await db.scheduledUpload.updateMany({
        where: { id: scheduleId, status: "STAGING" },
        data: {
          lastErrorCode: "STAGE_VERIFICATION_FAILED",
          lastErrorMessage: `Staged file failed verification: ${item.manifestPath}`,
        },
      });
      conflict(`Staged file failed verification: ${item.manifestPath}.`);
    }
  }

  const updated = await db.scheduledUpload.updateMany({
    where: { id: scheduleId, status: "STAGING" },
    data: {
      status: "WAITING",
      stagedBytes: schedule.totalBytes,
      stageCompleteAt: new Date(),
      lastErrorCode: null,
      lastErrorMessage: null,
    },
  });
  if (updated.count !== 1)
    conflict("The scheduled upload changed before commit completed.");
  return getScheduledUpload(scheduleId, { email });
}

export async function readScheduledUploadItemContent(
  scheduleId: string,
  itemId: string,
  actor: ScheduledUploadActor,
) {
  const email = actorEmail(actor);
  const schedule = await getVisibleSchedule(scheduleId, email);
  if (TERMINAL_STATUSES.has(schedule.status)) notFound();
  const item = schedule.items.find((entry) => entry.id === itemId);
  if (
    !item ||
    item.kind !== "FILE" ||
    item.status !== "STAGED" ||
    !item.storageKey
  )
    notFound();
  return {
    stream: await privateScheduledUploadStorage.readStream(
      scheduleId,
      item.storageKey,
    ),
    size: Number(item.size),
    contentType: item.contentType ?? "application/octet-stream",
    fileName: item.manifestPath.split("/").at(-1) ?? "download",
  };
}

export async function claimDueScheduledUploadForRelease(): Promise<ScheduledUploadReleaseClaim | null> {
  const leaseToken = randomUUID();
  const leaseMilliseconds = 30_000;
  return db.$transaction(async (tx) => {
    const claimed = await tx.$queryRaw<
      Array<{ id: string; leaseRecovered: boolean }>
    >`
      WITH candidate AS (
        SELECT
          "id",
          "status" AS "previousStatus",
          "releaseLeaseToken" AS "previousLeaseToken"
        FROM "ScheduledUpload"
        WHERE "status" IN ('WAITING', 'RELEASING', 'PARTIAL')
          AND "scheduledAt" <= statement_timestamp()
          AND ("retryAfter" IS NULL OR "retryAfter" <= statement_timestamp())
          AND (
            "releaseLeaseToken" IS NULL
            OR "releaseLeaseUntil" IS NULL
            OR "releaseLeaseUntil" <= statement_timestamp()
          )
        ORDER BY "scheduledAt" ASC, "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "ScheduledUpload" AS schedule
      SET
        "status" = 'RELEASING',
        "releaseLeaseToken" = ${leaseToken},
        "releaseLeaseUntil" = statement_timestamp() + (${leaseMilliseconds} * INTERVAL '1 millisecond'),
        "claimedAt" = COALESCE(schedule."claimedAt", statement_timestamp()),
        "pollerLagMs" = GREATEST(
          0,
          FLOOR(EXTRACT(EPOCH FROM (statement_timestamp() - schedule."scheduledAt")) * 1000)
        )::BIGINT,
        "leaseRecoveryCount" = schedule."leaseRecoveryCount" + CASE
          WHEN candidate."previousStatus" = 'RELEASING'
            AND candidate."previousLeaseToken" IS NOT NULL THEN 1
          ELSE 0
        END,
        "leaseRecoveredAt" = CASE
          WHEN candidate."previousStatus" = 'RELEASING'
            AND candidate."previousLeaseToken" IS NOT NULL THEN statement_timestamp()
          ELSE schedule."leaseRecoveredAt"
        END,
        "updatedAt" = statement_timestamp()
      FROM candidate
      WHERE schedule."id" = candidate."id"
      RETURNING
        schedule."id",
        (
          candidate."previousStatus" = 'RELEASING'
          AND candidate."previousLeaseToken" IS NOT NULL
        ) AS "leaseRecovered"
    `;
    if (!claimed[0]) return null;

    const schedule = await tx.scheduledUpload.findUnique({
      where: { id: claimed[0].id },
      include: { items: { orderBy: { manifestPath: "asc" } } },
    });
    if (!schedule) return null;

    const attempt = await tx.scheduledUploadAttempt.create({
      data: {
        scheduleId: schedule.id,
        kind: "RELEASE",
        status: "RUNNING",
      },
    });

    return {
      schedule: schedule as unknown as ScheduledUploadReleaseSchedule,
      leaseToken,
      attemptId: attempt.id,
      leaseRecovered: claimed[0].leaseRecovered,
    };
  });
}

export async function markScheduledUploadFirstWriteAttempt(
  scheduleId: string,
  leaseToken: string,
) {
  const updated = await db.$executeRaw`
    UPDATE "ScheduledUpload"
    SET
      "firstWriteAttemptAt" = COALESCE("firstWriteAttemptAt", statement_timestamp()),
      "updatedAt" = statement_timestamp()
    WHERE "id" = ${scheduleId}
      AND "status" = 'RELEASING'
      AND "releaseLeaseToken" = ${leaseToken}
  `;
  return Number(updated) === 1;
}

export async function recordScheduledUploadFirstWriteResponse(
  scheduleId: string,
  leaseToken: string,
) {
  const updated = await db.$executeRaw`
    UPDATE "ScheduledUpload"
    SET
      "firstWriteAt" = COALESCE("firstWriteAt", statement_timestamp()),
      "updatedAt" = statement_timestamp()
    WHERE "id" = ${scheduleId}
      AND "status" = 'RELEASING'
      AND "releaseLeaseToken" = ${leaseToken}
  `;
  return Number(updated) === 1;
}

export async function updateScheduledUploadReleaseItem(
  scheduleId: string,
  itemId: string,
  leaseToken: string,
  data: ScheduledUploadReleaseItemUpdate,
) {
  const updated = await db.scheduledUploadItem.updateMany({
    where: {
      id: itemId,
      scheduleId,
      schedule: {
        is: {
          id: scheduleId,
          status: "RELEASING",
          releaseLeaseToken: leaseToken,
        },
      },
    },
    data,
  });
  return updated.count === 1;
}

export async function finishScheduledUploadReleaseClaim(input: {
  scheduleId: string;
  leaseToken: string;
  attemptId: string;
  status: "RELEASING" | "PARTIAL" | "NEEDS_ATTENTION" | "COMPLETED";
  errorCode?: string | null;
  errorMessage?: string | null;
  retryAfter?: Date | null;
  adminAlertReason?: string | null;
}) {
  return db.$transaction(async (tx) => {
    const remaining =
      input.status === "COMPLETED"
        ? await tx.scheduledUploadItem.count({
            where: {
              scheduleId: input.scheduleId,
              status: { not: "COMPLETE" },
            },
          })
        : 1;
    if (input.status === "COMPLETED" && remaining !== 0) return false;

    const updated = await tx.$queryRaw<Array<{ roleRevocationCount: number }>>`
      UPDATE "ScheduledUpload"
      SET
        "status" = ${input.status}::"ScheduledUploadStatus",
        "releaseLeaseToken" = NULL,
        "releaseLeaseUntil" = NULL,
        "retryAfter" = ${input.retryAfter ?? null},
        "lastErrorCode" = ${input.errorCode ?? null},
        "lastErrorMessage" = ${input.errorMessage ?? null},
        "cleanupStatus" = CASE
          WHEN ${input.status} = 'COMPLETED' THEN 'PENDING'::"ScheduledUploadCleanupStatus"
          ELSE "cleanupStatus"
        END,
        "completedAt" = CASE
          WHEN ${input.status} = 'COMPLETED' THEN statement_timestamp()
          ELSE "completedAt"
        END,
        "workerRetryCount" = "workerRetryCount" + CASE
          WHEN ${input.retryAfter ?? null} IS NOT NULL THEN 1
          ELSE 0
        END,
        "roleRevocationCount" = "roleRevocationCount" + CASE
          WHEN ${input.adminAlertReason ?? null} IS NULL THEN 0
          ELSE 1
        END,
        "updatedAt" = statement_timestamp()
      WHERE "id" = ${input.scheduleId}
        AND "status" = 'RELEASING'
        AND "releaseLeaseToken" = ${input.leaseToken}
      RETURNING "roleRevocationCount"
    `;
    if (!updated[0]) return false;

    if (input.adminAlertReason) {
      await tx.scheduledUploadAdminAlert.create({
        data: {
          scheduleId: input.scheduleId,
          occurrence: updated[0].roleRevocationCount,
          reasonCode: input.adminAlertReason,
        },
      });
    }

    await tx.scheduledUploadAttempt.updateMany({
      where: { id: input.attemptId, scheduleId: input.scheduleId },
      data: {
        status: input.status,
        finishedAt: new Date(),
        retryAfter: input.retryAfter ?? null,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
      },
    });
    return true;
  });
}

export function getScheduledUploadApiLimits() {
  const limits = getScheduledUploadLimits();
  return {
    maxFileBytes: String(limits.maxFileBytes),
    maxPackageBytes: String(limits.maxPackageBytes),
    maxItems: limits.maxItems,
    reserveFreeBytes: String(limits.reserveFreeBytes),
  };
}

export async function readBoundedJson(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > PRIVATE_METADATA_BODY_LIMIT
    ) {
      throw new ApiRouteError(
        413,
        "The scheduled upload request body is too large.",
      );
    }
  }
  if (!request.body) badRequest("A JSON request body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > PRIVATE_METADATA_BODY_LIMIT) {
        throw new ApiRouteError(
          413,
          "The scheduled upload request body is too large.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const merged = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(merged),
    ) as unknown;
  } catch {
    badRequest("The scheduled upload request body must be valid JSON.");
  }
}
