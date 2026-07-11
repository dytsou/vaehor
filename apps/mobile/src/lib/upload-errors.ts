import { UploadAuthError } from "./upload-bridge";

export function nativeUploadErrorMessage(error: unknown): string {
  if (error instanceof UploadAuthError) return "Session expired";
  if (error instanceof Error) return error.message;
  return "Upload failed";
}
