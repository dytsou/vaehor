import type {
  ScheduledUploadAdminAlert,
  ScheduledUploadListResponse,
} from "@vaehor/sdk";
import type { ScheduledUploadApi } from "./scheduled-upload-api";

export const scheduledUploadQueryKeys = {
  root: ["scheduled-uploads"] as const,
  dashboard: (role: string) =>
    [
      ...scheduledUploadQueryKeys.root,
      "dashboard",
      role.toUpperCase(),
    ] as const,
};

export function canManageScheduledUploads(role: string): boolean {
  return ["EDITOR", "ADMIN"].includes(role.toUpperCase());
}

export type ScheduledUploadDashboard = Readonly<{
  schedules: ScheduledUploadListResponse["items"];
  adminAlerts: ScheduledUploadAdminAlert[];
  nextCursor: ScheduledUploadListResponse["nextCursor"];
}>;

export async function loadScheduledUploadDashboard(
  api: ScheduledUploadApi,
  role: string,
): Promise<ScheduledUploadDashboard> {
  const normalizedRole = role.toUpperCase();
  if (!canManageScheduledUploads(normalizedRole)) {
    throw new Error("Editor or admin access is required.");
  }

  const [schedules, adminAlerts] = await Promise.all([
    api.list(),
    normalizedRole === "ADMIN"
      ? api.listAdminAlerts({ status: "OPEN" })
      : Promise.resolve({ alerts: [] }),
  ]);

  return {
    schedules: schedules.items,
    adminAlerts: adminAlerts.alerts,
    nextCursor: schedules.nextCursor,
  };
}
