export const ZEE_MOBILE_MESSAGE = "zee-mobile";

export type ZeeMobilePickUploadRequest = {
  type: typeof ZEE_MOBILE_MESSAGE;
  action: "upload/pick";
  requestId: string;
  parentId: string;
};

export type ZeeMobileUploadProgressMessage = {
  type: typeof ZEE_MOBILE_MESSAGE;
  action: "upload/progress";
  requestId: string;
  fileName: string;
  percent: number;
};

export type ZeeMobilePickDoneMessage = {
  type: typeof ZEE_MOBILE_MESSAGE;
  action: "upload/pick-done";
  requestId: string;
};

export type ZeeMobilePickErrorMessage = {
  type: typeof ZEE_MOBILE_MESSAGE;
  action: "upload/pick-error";
  requestId: string;
  error: string;
};

export type ZeeMobilePickScheduledUploadRequest =
  | {
      type: typeof ZEE_MOBILE_MESSAGE;
      action: "scheduled/pick-folder";
      mode: "create";
      requestId: string;
      destinationId: string;
      scheduledLocalTime: string;
      timeZone: string;
      utcOffset: string;
    }
  | {
      type: typeof ZEE_MOBILE_MESSAGE;
      action: "scheduled/pick-folder";
      mode: "resume";
      requestId: string;
      scheduleId: string;
    };

export type ZeeMobileScheduledUploadProgressMessage = {
  type: typeof ZEE_MOBILE_MESSAGE;
  action: "scheduled/progress";
  requestId: string;
  scheduleId?: string;
  phase: "scanning" | "staging" | "committing";
  path?: string;
  index?: number;
  total?: number;
};

export type ZeeMobileScheduledUploadDoneMessage = {
  type: typeof ZEE_MOBILE_MESSAGE;
  action: "scheduled/done";
  requestId: string;
  scheduleId: string;
};

export type ZeeMobileScheduledUploadErrorMessage = {
  type: typeof ZEE_MOBILE_MESSAGE;
  action: "scheduled/error";
  requestId: string;
  scheduleId?: string;
  error: string;
};

export type ZeeMobileLogoutMessage = {
  type: typeof ZEE_MOBILE_MESSAGE;
  action: "logout";
};

export type ZeeMobileMessage =
  | ZeeMobilePickUploadRequest
  | ZeeMobileUploadProgressMessage
  | ZeeMobilePickDoneMessage
  | ZeeMobilePickErrorMessage
  | ZeeMobilePickScheduledUploadRequest
  | ZeeMobileScheduledUploadProgressMessage
  | ZeeMobileScheduledUploadDoneMessage
  | ZeeMobileScheduledUploadErrorMessage
  | ZeeMobileLogoutMessage;
