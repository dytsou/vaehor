import {
  getAbandonScheduledUploadUrl,
  getCancelScheduledUploadAsAdminUrl,
  getCancelScheduledUploadUrl,
  getCommitScheduledUploadUrl,
  getCreateScheduledUploadUrl,
  getGetScheduledUploadUrl,
  getListScheduledUploadAdminAlertsUrl,
  getListScheduledUploadsUrl,
  getRetryScheduledUploadUrl,
  getStageScheduledUploadItemContentUrl,
  getUpdateScheduledUploadAdminAlertUrl,
  getUpdateScheduledUploadTimeUrl,
  type CancelScheduledUploadAsAdminRequest,
  type CreateScheduledUploadRequest,
  type ListScheduledUploadsParams,
  type ListScheduledUploadAdminAlertsParams,
  type ScheduledUploadAdminAlertsResponse,
  type ScheduledUploadCreateResponse,
  type ScheduledUploadItemStageResponse,
  type ScheduledUploadListResponse,
  type ScheduledUploadResponse,
  type UpdateScheduledUploadAdminAlertRequest,
  type UpdateScheduledUploadAdminAlertResponse,
  type UpdateScheduledUploadTimeRequest,
} from "@vaehor/sdk";
import type { ServerFetch } from "./api-client";

export class ScheduledUploadApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "ScheduledUploadApiError";
  }
}

export type ScheduledUploadApi = ReturnType<typeof createScheduledUploadApi>;

function messageFromErrorBody(body: unknown, status: number): string {
  if (typeof body === "string" && body.trim()) return body;
  if (body && typeof body === "object") {
    const payload = body as { message?: unknown; error?: unknown };
    if (typeof payload.message === "string") return payload.message;
    if (typeof payload.error === "string") return payload.error;
  }
  return `The server could not complete this request (HTTP ${status}).`;
}

async function readErrorBody(response: Response): Promise<unknown> {
  const raw = await response.text().catch(() => "");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

async function request<T>(
  fetchImpl: ServerFetch,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetchImpl(path, init);
  if (!response.ok) {
    const body = await readErrorBody(response);
    throw new ScheduledUploadApiError(
      response.status,
      messageFromErrorBody(body, response.status),
      body,
    );
  }

  if ([204, 205, 304].includes(response.status)) return undefined as T;
  return (await response.json()) as T;
}

function jsonRequest(body: unknown, method = "POST"): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function createScheduledUploadApi(fetchImpl: ServerFetch) {
  return {
    list: (params: ListScheduledUploadsParams = {}) =>
      request<ScheduledUploadListResponse>(
        fetchImpl,
        getListScheduledUploadsUrl(params),
      ),
    get: (scheduleId: string) =>
      request<ScheduledUploadResponse>(
        fetchImpl,
        getGetScheduledUploadUrl(scheduleId),
      ),
    listAdminAlerts: (params: ListScheduledUploadAdminAlertsParams = {}) =>
      request<ScheduledUploadAdminAlertsResponse>(
        fetchImpl,
        getListScheduledUploadAdminAlertsUrl(params),
      ),
    create: (body: CreateScheduledUploadRequest) =>
      request<ScheduledUploadCreateResponse>(
        fetchImpl,
        getCreateScheduledUploadUrl(),
        jsonRequest(body),
      ),
    stage: (scheduleId: string, itemId: string, body: Blob) =>
      request<ScheduledUploadItemStageResponse>(
        fetchImpl,
        getStageScheduledUploadItemContentUrl(scheduleId, itemId),
        {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body,
        },
      ),
    commit: (scheduleId: string) =>
      request<ScheduledUploadResponse>(
        fetchImpl,
        getCommitScheduledUploadUrl(scheduleId),
        { method: "POST" },
      ),
    updateTime: (scheduleId: string, body: UpdateScheduledUploadTimeRequest) =>
      request<ScheduledUploadResponse>(
        fetchImpl,
        getUpdateScheduledUploadTimeUrl(scheduleId),
        jsonRequest(body, "PATCH"),
      ),
    cancel: (scheduleId: string) =>
      request<ScheduledUploadResponse>(
        fetchImpl,
        getCancelScheduledUploadUrl(scheduleId),
        { method: "DELETE" },
      ),
    retry: (scheduleId: string) =>
      request<ScheduledUploadResponse>(
        fetchImpl,
        getRetryScheduledUploadUrl(scheduleId),
        { method: "POST" },
      ),
    abandon: (scheduleId: string) =>
      request<ScheduledUploadResponse>(
        fetchImpl,
        getAbandonScheduledUploadUrl(scheduleId),
        { method: "POST" },
      ),
    acknowledgeAdminAlert: (
      alertId: string,
      status: UpdateScheduledUploadAdminAlertRequest["status"] = "ACKNOWLEDGED",
    ) =>
      request<UpdateScheduledUploadAdminAlertResponse>(
        fetchImpl,
        getUpdateScheduledUploadAdminAlertUrl(),
        jsonRequest({
          alertId,
          status,
        } satisfies UpdateScheduledUploadAdminAlertRequest),
      ),
    cancelAsAdmin: (scheduleId: string) => {
      const body = { scheduleId } satisfies CancelScheduledUploadAsAdminRequest;
      return request<ScheduledUploadResponse>(
        fetchImpl,
        getCancelScheduledUploadAsAdminUrl(),
        jsonRequest(body),
      );
    },
  };
}
