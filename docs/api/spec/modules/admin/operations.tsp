import "@typespec/http";
import "@typespec/openapi";

import "./models.tsp";
import "../../models/common.tsp";
import "../../models/domain.tsp";
import "../../models/requests.tsp";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

namespace VaehorApi {
  @tag("Admin")
  @tag("Health")
  @get
  @route("/admin/system-health")
  @doc("Returns measured dependency health, latency summary, and 24h error counts for the admin dashboard.")
  @useAuth(SessionAuth)
  op getAdminSystemHealth(
  ): OkResponse<AdminSystemHealthResponse> | UnauthorizedErrorResponse;

  @tag("Admin")
  @get
  @route("/admin/config")
  @doc("Get current application configuration.")
  @useAuth(SessionAuth)
  op getConfig(): OkResponse<AppConfig> | UnauthorizedErrorResponse;

  @tag("Admin")
  @post
  @route("/admin/config")
  @doc("Update application configuration (Admin only).")
  op updateConfig(
    @body body: AppConfig,
  ): OkResponse<AppConfig> | UnauthorizedErrorResponse;

  @tag("Admin")
  @get
  @route("/admin/users")
  @doc("Get list of admin email addresses.")
  @useAuth(SessionAuth)
  op listAdmins(): OkResponse<string[]> | UnauthorizedErrorResponse;

  @tag("Admin")
  @post
  @route("/admin/users")
  @doc("Add a new admin user.")
  op addAdmin(
    @body body: EmailRequest,
  ): EmptyOkResponse | UnauthorizedErrorResponse;

  @tag("Admin")
  @delete
  @route("/admin/users")
  @doc("Remove an admin user.")
  op removeAdmin(
    @body body: EmailRequest,
  ): EmptyOkResponse | UnauthorizedErrorResponse;

  @tag("Admin")
  @get
  @route("/admin/editors")
  @doc("Get list of editor email addresses.")
  @useAuth(SessionAuth)
  op listEditors(): OkResponse<string[]> | UnauthorizedErrorResponse;

  @tag("Admin")
  @post
  @route("/admin/editors")
  @doc("Add a new editor user.")
  op addEditor(
    @body body: EmailRequest,
  ): EmptyOkResponse | UnauthorizedErrorResponse;

  @tag("Admin")
  @delete
  @route("/admin/editors")
  @doc("Remove an editor user.")
  op removeEditor(
    @body body: EmailRequest,
  ): EmptyOkResponse | UnauthorizedErrorResponse;

  @tag("Admin")
  @get
  @route("/admin/activity-log")
  @doc("Get system activity logs.")
  op getActivityLogs(
    @query limit?: int32,
    @query offset?: int32,
  ): OkResponse<ActivityLog[]> | UnauthorizedErrorResponse;

  // --- Admin: stats / cache / logs / analytics / incidents / audit / drives ---

  @tag("Admin")
  @get
  @route("/admin/stats")
  @useAuth(SessionAuth)
  op getAdminStats(): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Admin")
  @get
  @route("/admin/cache-stats")
  @useAuth(SessionAuth)
  op getAdminCacheStats(): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Admin")
  @get
  @route("/admin/logs")
  @useAuth(SessionAuth)
  op getAdminLogs(): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Admin")
  @get
  @route("/admin/logs/security")
  @useAuth(SessionAuth)
  op getAdminSecurityLogs(): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Admin")
  @get
  @route("/admin/analytics")
  @useAuth(SessionAuth)
  op getAdminAnalytics(): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Admin")
  @get
  @route("/admin/analytics/enhanced")
  @useAuth(SessionAuth)
  op getAdminAnalyticsEnhanced(
  ): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Admin")
  @post
  @route("/admin/analytics/track")
  op trackAdminAnalytics(@body body: unknown): EmptyOkResponse;

  @tag("Admin")
  @get
  @route("/admin/incidents")
  @useAuth(SessionAuth)
  op getAdminIncidents(): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Admin")
  @post
  @route("/admin/incidents/evaluate")
  @useAuth(SessionAuth)
  op evaluateAdminIncidents(
    @body body: unknown,
  ): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Admin")
  @get
  @route("/admin/audit")
  @useAuth(SessionAuth)
  op getAdminAudit(): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Admin")
  @delete
  @route("/admin/audit")
  @useAuth(SessionAuth)
  op clearAdminAudit(): EmptyOkResponse | UnauthorizedErrorResponse;

  @tag("Admin")
  @get
  @route("/admin/drives/scan")
  @useAuth(SessionAuth)
  op scanAdminDrives(): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Admin")
  @get
  @route("/admin/protected-folders")
  @useAuth(SessionAuth)
  op listProtectedFolders(): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Admin")
  @post
  @route("/admin/protected-folders")
  @useAuth(SessionAuth)
  op updateProtectedFolders(
    @body body: unknown,
  ): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Admin")
  @delete
  @route("/admin/protected-folders")
  @useAuth(SessionAuth)
  op deleteProtectedFolder(
    @body body: unknown,
  ): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Admin")
  @get
  @route("/admin/access-requests")
  @useAuth(SessionAuth)
  op listAccessRequests(): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Admin")
  @get
  @route("/admin/user-access")
  @useAuth(SessionAuth)
  op getUserAccess(
    @query email?: string,
  ): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Admin")
  @post
  @route("/admin/user-password")
  @useAuth(SessionAuth)
  op rotateUserPassword(
    @body body: unknown,
  ): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Admin")
  @get
  @route("/admin/manual-drives")
  @useAuth(SessionAuth)
  op listAdminManualDrives(): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Admin")
  @post
  @route("/admin/manual-drives")
  @useAuth(SessionAuth)
  op addAdminManualDrive(
    @body body: unknown,
  ): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Admin")
  @delete
  @route("/admin/manual-drives")
  @useAuth(SessionAuth)
  op deleteAdminManualDrive(
    @body body: unknown,
  ): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Admin")
  @post
  @route("/clearcache")
  @useAuth(SessionAuth)
  op clearCache(
    @body body: unknown,
  ): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Admin")
  @get
  @route("/events")
  @useAuth(SessionAuth)
  op getEvents(): OkResponse<unknown> | UnauthorizedErrorResponse;
}
