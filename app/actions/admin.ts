"use server";

import { requireAdminSession } from "@/lib/admin-auth";
import { getAdminStats } from "@/lib/admin-stats";
import {
  appConfigUpdateSchema,
  getAppConfig,
  updateAppConfig,
  type AppConfig,
  type AppConfigUpdate,
} from "@/lib/app-config";
import { getAnalyticsData } from "@/lib/analyticsTracker";
import { sortStrings } from "@/lib/utils";
import {
  getActivityLogs,
  getSecurityLogs,
  logActivity,
} from "@/lib/activityLogger";
import { REDIS_KEYS } from "@/lib/constants";
import { db } from "@/lib/db";
import { listSharedDrives, listSharedWithMeFolders } from "@/lib/drive";
import { EVENT_PIPELINE_KEYS } from "@/lib/events/pipeline";
import {
  accessRequestActionSchema,
  parseAccessRequestRecord,
  serializeAccessRequestRecord,
  type AccessRequestRecord,
} from "@/lib/link-payloads";
import {
  evaluateIncidentRules,
  incidentStatusSchema,
  listIncidents,
  updateIncidentStatus,
} from "@/lib/incident-monitor";
import { kv } from "@/lib/kv";
import {
  addManualDrive,
  MANUAL_DRIVES_KEY,
  manualDriveCreateSchema,
  manualDriveDeleteSchema,
  parseManualDriveRecords,
  removeManualDrive,
} from "@/lib/manual-drives";
import {
  getHealthServicesSnapshot,
  summarizeLatencies,
} from "@/lib/services/health-service";
import bcrypt from "bcryptjs";
import { revalidateTag } from "next/cache";
import { z } from "zod";

const emailSchema = z.object({
  email: z
    .string()
    .email("Invalid email format")
    .transform((v) => v.trim()),
});

export async function getAdminStatsAction() {
  await requireAdminSession();
  return getAdminStats();
}

export async function getAdminConfigAction(): Promise<AppConfig> {
  await requireAdminSession();
  return getAppConfig();
}

export async function updateAdminConfigAction(
  update: AppConfigUpdate,
): Promise<AppConfig> {
  await requireAdminSession();
  const parsed = appConfigUpdateSchema.parse(update);
  const next = await updateAppConfig(parsed);
  revalidateTag("admin-config", "max");
  return next;
}

export async function getAdminEmailsAction(): Promise<string[]> {
  await requireAdminSession();
  const admins = await kv.smembers(REDIS_KEYS.ADMIN_USERS);
  return sortStrings((admins || []).filter(Boolean));
}

export async function addAdminEmailAction(email: string) {
  await requireAdminSession();
  const parsed = emailSchema.parse({ email });
  await kv.sadd(REDIS_KEYS.ADMIN_USERS, parsed.email);
  revalidateTag("admin-users", "max");
  return { message: "Admin added", email: parsed.email };
}

export async function removeAdminEmailAction(email: string) {
  await requireAdminSession();
  const parsed = emailSchema.parse({ email });
  await kv.srem(REDIS_KEYS.ADMIN_USERS, parsed.email);
  revalidateTag("admin-users", "max");
  return { message: "Admin removed", email: parsed.email };
}

export async function getEditorEmailsAction(): Promise<string[]> {
  await requireAdminSession();
  const editors = await kv.smembers(REDIS_KEYS.ADMIN_EDITORS);
  return sortStrings((editors || []).filter(Boolean));
}

export async function addEditorEmailAction(email: string) {
  await requireAdminSession();
  const parsed = emailSchema.parse({ email });
  await kv.sadd(REDIS_KEYS.ADMIN_EDITORS, parsed.email);
  revalidateTag("admin-editors", "max");
  return { message: "Editor added", email: parsed.email };
}

export async function removeEditorEmailAction(email: string) {
  await requireAdminSession();
  const parsed = emailSchema.parse({ email });
  await kv.srem(REDIS_KEYS.ADMIN_EDITORS, parsed.email);
  revalidateTag("admin-editors", "max");
  return { message: "Editor removed", email: parsed.email };
}

const activityLogQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
});

export async function getActivityLogPageAction(input: {
  page?: number;
  limit?: number;
}) {
  await requireAdminSession();
  const { page, limit } = activityLogQuerySchema.parse(input);
  const offset = (page - 1) * limit;

  const totalLogs = await db.activityLog.count();
  const totalPages = Math.ceil(totalLogs / limit);
  const logs = await getActivityLogs(limit, offset);

  return {
    logs,
    totalPages,
    currentPage: page,
    totalLogs,
  };
}

export async function getSystemHealthAction() {
  await requireAdminSession();

  const startedAt = performance.now();
  const services = await getHealthServicesSnapshot({
    includeDriveQuota: true,
  });

  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;

  const errorsLast24h = await db.activityLog.count({
    where: { severity: "error", timestamp: { gte: now - oneDay } },
  });
  const errorsPrev24h = await db.activityLog.count({
    where: {
      severity: "error",
      timestamp: { gte: now - 2 * oneDay, lt: now - oneDay },
    },
  });

  const latency = summarizeLatencies(services, performance.now() - startedAt);
  const hasDependencyError = Object.values(services).some(
    (service) => service.status === "unhealthy",
  );

  const status: "ok" | "error" = hasDependencyError ? "error" : "ok";
  return {
    status,
    services,
    errorRate: {
      last24h: errorsLast24h,
      previous24h: errorsPrev24h,
      trendPercentage:
        errorsPrev24h > 0
          ? ((errorsLast24h - errorsPrev24h) / errorsPrev24h) * 100
          : 0,
    },
    latency,
    timestamp: new Date().toISOString(),
  };
}

const sanitizeString = (str: string) => str.replace(/<[^>]*>?/gm, "");

const protectedFolderSchema = z.object({
  folderId: z
    .string()
    .min(5, "Folder ID tidak valid.")
    .transform((val) => sanitizeString(val).trim()),
  id: z
    .string()
    .optional()
    .transform((val) => (val ? sanitizeString(val) : "admin")),
  password: z.string().min(1, "Password tidak boleh kosong."),
});

const protectedFolderDeleteSchema = z.object({
  folderId: z
    .string()
    .min(1, "Folder ID diperlukan.")
    .transform((v) => v.trim()),
});

export async function getProtectedFoldersAction() {
  await requireAdminSession();
  const folders = await db.protectedFolder.findMany();

  const sanitizedFolders: Record<string, { id: string; password: string }> = {};
  for (const folder of folders) {
    sanitizedFolders[folder.folderId] = {
      id: "admin",
      password: "***REDACTED***",
    };
  }

  return sanitizedFolders;
}

export async function protectFolderAction(input: {
  folderId: string;
  password: string;
  id?: string;
}) {
  await requireAdminSession();
  const validation = protectedFolderSchema.parse(input);

  const saltRounds = 10;
  const hashedPassword = await bcrypt.hash(validation.password, saltRounds);

  await db.protectedFolder.upsert({
    where: { folderId: validation.folderId },
    update: { password: hashedPassword },
    create: { folderId: validation.folderId, password: hashedPassword },
  });

  revalidateTag("protected-folders", "max");
  return {
    success: true,
    message: `Folder ${validation.folderId} berhasil dilindungi.`,
  };
}

export async function unprotectFolderAction(folderId: string) {
  await requireAdminSession();
  const parsed = protectedFolderDeleteSchema.parse({ folderId });

  await db.protectedFolder
    .delete({ where: { folderId: parsed.folderId } })
    .catch(() => {});

  revalidateTag("protected-folders", "max");
  return {
    success: true,
    message: `Perlindungan untuk folder ${parsed.folderId} telah dihapus.`,
  };
}

export async function getManualDrivesAction() {
  await requireAdminSession();
  return parseManualDriveRecords(await kv.get(MANUAL_DRIVES_KEY));
}

export async function createManualDriveAction(input: unknown) {
  await requireAdminSession();
  const drives = await addManualDrive(manualDriveCreateSchema.parse(input));
  revalidateTag("manual-drives", "max");
  return { success: true, drives };
}

export async function deleteManualDriveAction(input: unknown) {
  await requireAdminSession();
  const drives = await removeManualDrive(
    manualDriveDeleteSchema.parse(input).id,
  );
  revalidateTag("manual-drives", "max");
  return { success: true, drives };
}

export async function scanDrivesAction() {
  await requireAdminSession();
  const [teamDrives, sharedFolders] = await Promise.all([
    listSharedDrives(),
    listSharedWithMeFolders(),
  ]);

  const formattedTeamDrives = teamDrives.map((d) => ({
    id: d.id,
    name: d.name,
    kind: "teamDrive" as const,
  }));

  const formattedSharedFolders = sharedFolders.map((f) => ({
    id: f.id,
    name: f.name,
    kind: "sharedFolder" as const,
    owner: f.owners?.[0]?.displayName || "Unknown",
  }));

  return [...formattedTeamDrives, ...formattedSharedFolders];
}

export async function getAdminAnalyticsAction() {
  await requireAdminSession();
  return getAnalyticsData();
}

const folderAccessSchema = z.object({
  folderId: z.string().min(5, "Folder ID tidak valid."),
  email: z.string().email("Format email tidak valid."),
});

const FOLDERS_WITH_ACCESS_KEY = "vaehor:user-access:folders";
const getFolderAccessKey = (folderId: string) => `folder:access:${folderId}`;

export async function getUserAccessPermissionsAction() {
  await requireAdminSession();

  const folderIds: string[] = await kv.smembers(FOLDERS_WITH_ACCESS_KEY);
  const permissions: Record<string, string[]> = {};

  for (const folderId of folderIds) {
    const emails: string[] = await kv.smembers(getFolderAccessKey(folderId));
    if (emails.length > 0) {
      permissions[folderId] = emails;
    }
  }

  return permissions;
}

export async function addUserAccessPermissionAction(input: {
  folderId: string;
  email: string;
}) {
  await requireAdminSession();
  const { folderId, email } = folderAccessSchema.parse(input);

  await kv.sadd(FOLDERS_WITH_ACCESS_KEY, folderId);
  await kv.sadd(getFolderAccessKey(folderId), email);

  revalidateTag("user-access", "max");
  return {
    success: true,
    message: `Akses untuk ${email} ke folder ${folderId} telah ditambahkan.`,
  };
}

export async function removeUserAccessPermissionAction(input: {
  folderId: string;
  email: string;
}) {
  await requireAdminSession();
  const { folderId, email } = folderAccessSchema.parse(input);

  await kv.srem(getFolderAccessKey(folderId), email);

  const remainingEmails = await kv.scard(getFolderAccessKey(folderId));
  if (remainingEmails === 0) {
    await kv.srem(FOLDERS_WITH_ACCESS_KEY, folderId);
  }

  revalidateTag("user-access", "max");
  return {
    success: true,
    message: `Akses untuk ${email} dari folder ${folderId} telah dihapus.`,
  };
}

export async function getAccessRequestsAction(): Promise<
  AccessRequestRecord[]
> {
  await requireAdminSession();

  const requests = await kv.smembers(REDIS_KEYS.ACCESS_REQUESTS);
  const parsedRequests = requests
    .map((requestEntry) => parseAccessRequestRecord(requestEntry))
    .filter(
      (requestEntry): requestEntry is AccessRequestRecord =>
        requestEntry !== null,
    );

  parsedRequests.sort((a, b) => b.timestamp - a.timestamp);
  return parsedRequests;
}

export async function handleAccessRequestAction(input: unknown) {
  const session = await requireAdminSession();
  const { action, requestData } = accessRequestActionSchema.parse(input);

  const allRequests = await kv.smembers(REDIS_KEYS.ACCESS_REQUESTS);
  let targetToRemove: string | null = null;

  for (const requestEntry of allRequests) {
    const parsed = parseAccessRequestRecord(requestEntry);
    if (!parsed) continue;
    if (
      parsed.folderId === requestData.folderId &&
      parsed.email === requestData.email &&
      parsed.timestamp === requestData.timestamp
    ) {
      targetToRemove = requestEntry;
      break;
    }
  }

  if (action === "approve") {
    await kv.sadd(FOLDERS_WITH_ACCESS_KEY, requestData.folderId);
    await kv.sadd(getFolderAccessKey(requestData.folderId), requestData.email);

    await logActivity("ADMIN_ADDED", {
      itemName: requestData.folderName,
      userEmail: session.user?.email,
      targetUser: requestData.email,
      status: "success",
      metadata: {
        source: "access_request_approval",
        folderId: requestData.folderId,
        targetUser: requestData.email,
      },
    });
  }

  try {
    if (targetToRemove) {
      await kv.srem(REDIS_KEYS.ACCESS_REQUESTS, targetToRemove);
    } else {
      await kv.srem(
        REDIS_KEYS.ACCESS_REQUESTS,
        serializeAccessRequestRecord(requestData),
      );
    }
  } catch {}

  try {
    await kv.srem(REDIS_KEYS.ACCESS_REQUESTS, "[object Object]");
  } catch {}

  revalidateTag("access-requests", "max");
  return { success: true };
}

export async function getSecurityLogsAction() {
  await requireAdminSession();
  return getSecurityLogs(20);
}

const incidentListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.union([incidentStatusSchema, z.literal("all")]).default("all"),
});

const incidentPatchSchema = z.object({
  id: z.string().min(1),
  status: incidentStatusSchema,
});

export async function listIncidentsAction(input: unknown) {
  await requireAdminSession();
  const query = incidentListQuerySchema.parse(input);
  return listIncidents({
    limit: query.limit,
    offset: query.offset,
    status: query.status,
  });
}

export async function updateIncidentStatusAction(input: unknown) {
  const session = await requireAdminSession();
  const body = incidentPatchSchema.parse(input);

  const updated = await updateIncidentStatus({
    id: body.id,
    status: body.status,
    actor: session.user.email || undefined,
  });

  if (!updated) {
    throw new Error("Incident tidak ditemukan.");
  }

  revalidateTag("incidents", "max");
  return { success: true, incident: updated };
}

export async function evaluateIncidentsAction() {
  await requireAdminSession();
  const summary = await evaluateIncidentRules();
  revalidateTag("incidents", "max");
  return { success: true, summary };
}

const logsQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
});

const LOGS_PER_PAGE = 50;

export async function getLiveLogsAction(input: unknown) {
  await requireAdminSession();
  const { offset } = logsQuerySchema.parse(input);

  const rawLogs = await kv.zrange<unknown>(
    EVENT_PIPELINE_KEYS.activityLog,
    offset,
    offset + LOGS_PER_PAGE - 1,
    { rev: true },
  );

  const logs = rawLogs
    .map((entry) => {
      try {
        return typeof entry === "string" ? JSON.parse(entry) : entry;
      } catch (e) {
        console.error("Gagal mem-parsing entri log:", entry, e);
        return null;
      }
    })
    .filter((log): log is Record<string, unknown> => log !== null);

  return {
    logs,
    hasMore: logs.length === LOGS_PER_PAGE,
  };
}

export async function getAuditLogsAction() {
  await requireAdminSession();
  return getActivityLogs(100);
}

export async function clearAuditLogsAction() {
  await requireAdminSession();
  await Promise.all([
    db.activityLog.deleteMany(),
    kv.del(EVENT_PIPELINE_KEYS.activityLog, EVENT_PIPELINE_KEYS.eventStream),
    kv.del("recent_events"),
  ]);
  revalidateTag("audit-logs", "max");
  return { message: "Logs cleared" };
}
