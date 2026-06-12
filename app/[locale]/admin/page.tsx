import { requireAdminSession } from "@/lib/admin-auth";
import { AdminDashboard } from "./AdminDashboard.client";
import { getAdminStats } from "@/lib/admin-stats";
import { getAppConfig } from "@/lib/app-config";
import { kv } from "@/lib/kv";
import { REDIS_KEYS } from "@/lib/constants";
import { db } from "@/lib/db";
import {
  parseAccessRequestRecord,
  type AccessRequestRecord,
} from "@/lib/link-payloads";
import {
  MANUAL_DRIVES_KEY,
  parseManualDriveRecords,
} from "@/lib/manual-drives";
import { sortStrings } from "@/lib/utils";

export default async function AdminPage() {
  const session = await requireAdminSession();

  const foldersWithAccessKey = "zee-index:user-access:folders";
  const getFolderAccessKey = (folderId: string) => `folder:access:${folderId}`;

  const [
    stats,
    config,
    adminEmails,
    editorEmails,
    protectedFolders,
    permissions,
    accessRequests,
    manualDrives,
  ] = await Promise.all([
    getAdminStats(),
    getAppConfig(),
    kv.smembers(REDIS_KEYS.ADMIN_USERS).then((v) => (v || []).filter(Boolean)),
    kv
      .smembers(REDIS_KEYS.ADMIN_EDITORS)
      .then((v) => (v || []).filter(Boolean)),
    db.protectedFolder.findMany().then((rows) => {
      const result: Record<string, { id: string; password: string }> = {};
      for (const row of rows) {
        result[row.folderId] = { id: "admin", password: "***REDACTED***" };
      }
      return result;
    }),
    kv.smembers(foldersWithAccessKey).then(async (folderIds) => {
      const result: Record<string, string[]> = {};
      for (const folderId of folderIds || []) {
        const emails = await kv.smembers(getFolderAccessKey(folderId));
        if (emails.length > 0) {
          result[folderId] = emails;
        }
      }
      return result;
    }),
    kv.smembers(REDIS_KEYS.ACCESS_REQUESTS).then((rows) => {
      const parsed = (rows || [])
        .map((r) => parseAccessRequestRecord(r))
        .filter((v): v is AccessRequestRecord => v !== null);
      parsed.sort((a, b) => b.timestamp - a.timestamp);
      return parsed;
    }),
    kv.get(MANUAL_DRIVES_KEY).then((v) => parseManualDriveRecords(v)),
  ]);

  return (
    <AdminDashboard
      sessionEmail={session.user.email || ""}
      initialData={{
        stats,
        config,
        adminEmails: sortStrings(adminEmails),
        editorEmails: sortStrings(editorEmails),
        protectedFolders,
        userAccessPermissions: permissions,
        accessRequests,
        manualDrives,
      }}
    />
  );
}
