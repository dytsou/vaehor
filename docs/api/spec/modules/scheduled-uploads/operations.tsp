import "@typespec/http";
import "@typespec/openapi";

import "./models.tsp";
import "../../models/common.tsp";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

namespace VaehorApi {
  @tag("Admin")
  @get
  @route("/admin/scheduled-uploads/alerts")
  @useAuth(SessionAuth)
  @doc("List durable administrator alerts for private scheduled uploads.")
  op listScheduledUploadAdminAlerts(
    @query status?: ScheduledUploadAdminAlertStatus,
  ): OkResponse<ScheduledUploadAdminAlertsResponse> | UnauthorizedErrorResponse;

  @tag("Admin")
  @post
  @route("/admin/scheduled-uploads/alerts/update")
  @useAuth(SessionAuth)
  @doc("Acknowledge or resolve one scheduled-upload administrator alert.")
  op updateScheduledUploadAdminAlert(
    @body body: UpdateScheduledUploadAdminAlertRequest,
  ):
    | OkResponse<UpdateScheduledUploadAdminAlertResponse>
    | UnauthorizedErrorResponse
    | NotFoundErrorResponse;

  @tag("Admin")
  @post
  @route("/admin/scheduled-uploads/cancel")
  @useAuth(SessionAuth)
  @doc("Cancel a paused private package before its first Drive write.")
  op cancelScheduledUploadAsAdmin(
    @body body: CancelScheduledUploadAsAdminRequest,
  ):
    | OkResponse<ScheduledUploadResponse>
    | UnauthorizedErrorResponse
    | NotFoundErrorResponse
    | ConflictErrorResponse;

  @tag("Scheduled Uploads")
  @get
  @route("/scheduled-uploads")
  @useAuth(SessionAuth)
  @doc("List scheduled uploads visible to the authenticated owner or administrator.")
  op listScheduledUploads():
    | OkResponse<ScheduledUploadListResponse>
    | UnauthorizedErrorResponse;

  @tag("Scheduled Uploads")
  @post
  @route("/scheduled-uploads")
  @useAuth(SessionAuth)
  @doc("Create a private staging package and schedule a future Drive write.")
  op createScheduledUpload(
    @body body: CreateScheduledUploadRequest,
  ):
    | CreatedResponse<ScheduledUploadCreateResponse>
    | BadRequestErrorResponse
    | UnauthorizedErrorResponse
    | ForbiddenErrorResponse
    | InsufficientStorageErrorResponse;

  @tag("Scheduled Uploads")
  @get
  @route("/scheduled-uploads/{scheduleId}")
  @useAuth(SessionAuth)
  op getScheduledUpload(
    @path scheduleId: string,
  ): OkResponse<ScheduledUploadResponse> | UnauthorizedErrorResponse | NotFoundErrorResponse;

  @tag("Scheduled Uploads")
  @patch
  @route("/scheduled-uploads/{scheduleId}")
  @useAuth(SessionAuth)
  @doc("Change a waiting upload's future local time, time zone, and offset.")
  op updateScheduledUploadTime(
    @path scheduleId: string,
    @body body: UpdateScheduledUploadTimeRequest,
  ):
    | OkResponse<ScheduledUploadResponse>
    | BadRequestErrorResponse
    | ConflictErrorResponse
    | UnauthorizedErrorResponse
    | NotFoundErrorResponse;

  @tag("Scheduled Uploads")
  @delete
  @route("/scheduled-uploads/{scheduleId}")
  @useAuth(SessionAuth)
  op cancelScheduledUpload(
    @path scheduleId: string,
  ): OkResponse<ScheduledUploadResponse> | ConflictErrorResponse | UnauthorizedErrorResponse | NotFoundErrorResponse;

  @tag("Scheduled Uploads")
  @post
  @route("/scheduled-uploads/{scheduleId}/commit")
  @useAuth(SessionAuth)
  @doc("Verify every staged byte and move a complete package into waiting state.")
  op commitScheduledUpload(
    @path scheduleId: string,
  ):
    | OkResponse<ScheduledUploadResponse>
    | ConflictErrorResponse
    | UnauthorizedErrorResponse
    | NotFoundErrorResponse;

  @tag("Scheduled Uploads")
  @post
  @route("/scheduled-uploads/{scheduleId}/retry")
  @useAuth(SessionAuth)
  op retryScheduledUpload(
    @path scheduleId: string,
  ): OkResponse<ScheduledUploadResponse> | ConflictErrorResponse | UnauthorizedErrorResponse | NotFoundErrorResponse;

  @tag("Scheduled Uploads")
  @post
  @route("/scheduled-uploads/{scheduleId}/abandon")
  @useAuth(SessionAuth)
  op abandonScheduledUpload(
    @path scheduleId: string,
  ): OkResponse<ScheduledUploadResponse> | ConflictErrorResponse | UnauthorizedErrorResponse | NotFoundErrorResponse;

  @tag("Scheduled Uploads")
  @get
  @route("/scheduled-uploads/{scheduleId}/items/{itemId}/content")
  @useAuth(SessionAuth)
  @doc("Read private staged content as an owner or administrator stream.")
  op readScheduledUploadItemContent(
    @path scheduleId: string,
    @path itemId: string,
  ): OkResponse<bytes> | UnauthorizedErrorResponse | NotFoundErrorResponse;

  @tag("Scheduled Uploads")
  @put
  @route("/scheduled-uploads/{scheduleId}/items/{itemId}/content")
  @useAuth(SessionAuth)
  @doc("Stream one file into private staging without buffering multipart form data.")
  op stageScheduledUploadItemContent(
    @path scheduleId: string,
    @path itemId: string,
    @body body: bytes,
  ):
    | OkResponse<ScheduledUploadItemStageResponse>
    | BadRequestErrorResponse
    | ConflictErrorResponse
    | PayloadTooLargeErrorResponse
    | UnauthorizedErrorResponse
    | NotFoundErrorResponse
    | InsufficientStorageErrorResponse;
}
