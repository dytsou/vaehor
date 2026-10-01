import "@typespec/http";

import "../../models/common.tsp";

using TypeSpec.Http;

namespace VaehorApi {
  enum ScheduledUploadStatus {
    staging: "STAGING",
    waiting: "WAITING",
    releasing: "RELEASING",
    partial: "PARTIAL",
    needsAttention: "NEEDS_ATTENTION",
    completed: "COMPLETED",
    canceled: "CANCELED",
    abandoned: "ABANDONED",
  }

  enum ScheduledUploadItemKind {
    file: "FILE",
    folder: "FOLDER",
  }

  enum ScheduledUploadItemStatus {
    pending: "PENDING",
    staging: "STAGING",
    staged: "STAGED",
    uploading: "UPLOADING",
    complete: "COMPLETE",
    failed: "FAILED",
  }

  enum ScheduledUploadAdminAlertStatus {
    open: "OPEN",
    acknowledged: "ACKNOWLEDGED",
    resolved: "RESOLVED",
  }

  enum ScheduledUploadAdminEmailStatus {
    pending: "PENDING",
    sending: "SENDING",
    sent: "SENT",
    failed: "FAILED",
  }

  model ScheduledUploadManifestItem {
    path: string;
    kind: "file" | "folder";
    size: int64;
    sha256?: string;
    contentType?: string;
  }

  model CreateScheduledUploadRequest {
    destinationId: string;
    scheduledLocalTime: string;
    timeZone: string;
    utcOffset: string;
    items: ScheduledUploadManifestItem[];
  }

  model UpdateScheduledUploadTimeRequest {
    scheduledLocalTime: string;
    timeZone: string;
    utcOffset: string;
  }

  model ScheduledUploadItem {
    id: string;
    path: string;
    kind: ScheduledUploadItemKind;
    size: string;
    uploadedBytes: string;
    status: ScheduledUploadItemStatus;
    contentType?: string | null;
    stagedAt?: utcDateTime | null;
  }

  model ScheduledUpload {
    id: string;
    creatorEmail: string;
    destinationId: string;
    scheduledAt: utcDateTime;
    scheduledLocalTime: string;
    timeZone: string;
    utcOffset: string;
    status: ScheduledUploadStatus;
    itemCount: int32;
    totalBytes: string;
    stagedBytes: string;
    stageCompleteAt?: utcDateTime | null;
    firstWriteAt?: utcDateTime | null;
    retryAfter?: utcDateTime | null;
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
    cleanupStatus: "NONE" | "PENDING" | "COMPLETE";
    createdAt: utcDateTime;
    updatedAt: utcDateTime;
    items: ScheduledUploadItem[];
  }

  model ScheduledUploadLimits {
    maxFileBytes: string;
    maxPackageBytes: string;
    maxItems: int32;
    reserveFreeBytes: string;
  }

  model ScheduledUploadListResponse {
    items: ScheduledUpload[];
    limits: ScheduledUploadLimits;
  }

  model ScheduledUploadCreateResponse {
    schedule: ScheduledUpload;
    limits: ScheduledUploadLimits;
  }

  model ScheduledUploadResponse {
    schedule: ScheduledUpload;
  }

  model ScheduledUploadAdminAlertSchedule {
    id: string;
    creatorEmail: string;
    scheduledAt: utcDateTime;
    status: ScheduledUploadStatus;
  }

  model ScheduledUploadAdminAlert {
    id: string;
    scheduleId: string;
    occurrence: int32;
    reasonCode: string;
    status: ScheduledUploadAdminAlertStatus;
    emailStatus: ScheduledUploadAdminEmailStatus;
    emailAttempts: int32;
    emailRetryAfter?: utcDateTime | null;
    emailLastError?: string | null;
    acknowledgedAt?: utcDateTime | null;
    acknowledgedByEmail?: string | null;
    resolvedAt?: utcDateTime | null;
    resolvedByEmail?: string | null;
    createdAt: utcDateTime;
    updatedAt: utcDateTime;
    schedule: ScheduledUploadAdminAlertSchedule;
  }

  model ScheduledUploadAdminAlertsResponse {
    alerts: ScheduledUploadAdminAlert[];
  }

  model UpdateScheduledUploadAdminAlertRequest {
    alertId: string;
    status: "ACKNOWLEDGED" | "RESOLVED";
  }

  model UpdateScheduledUploadAdminAlertResponse {
    alert: ScheduledUploadAdminAlert;
  }

  model CancelScheduledUploadAsAdminRequest {
    scheduleId: string;
  }

  model ScheduledUploadItemStageResponse {
    item: {
      itemId: string;
      path: string;
      status: ScheduledUploadItemStatus;
      uploadedBytes: string;
      size: string;
      sha256: string;
    };
  }

  model CreatedResponse<T> {
    @statusCode statusCode: 201;
    @body body: T;
  }

  model BadRequestErrorResponse {
    @statusCode statusCode: 400;
    @body body: Error;
  }

  model ConflictErrorResponse {
    @statusCode statusCode: 409;
    @body body: Error;
  }

  model InsufficientStorageErrorResponse {
    @statusCode statusCode: 507;
    @body body: Error;
  }
}
