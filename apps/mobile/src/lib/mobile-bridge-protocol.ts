/** Keep in sync with lib/mobile-bridge.ts message protocol. */
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

export type ZeeMobileLogoutMessage = {
  type: typeof ZEE_MOBILE_MESSAGE;
  action: "logout";
};

export type ZeeMobileMessage =
  | ZeeMobilePickUploadRequest
  | ZeeMobileUploadProgressMessage
  | ZeeMobilePickDoneMessage
  | ZeeMobilePickErrorMessage
  | ZeeMobileLogoutMessage;
