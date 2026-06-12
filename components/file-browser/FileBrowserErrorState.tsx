"use client";

import SetupRequired from "@/components/file-browser/SetupRequired";
import { ShieldAlert } from "lucide-react";
import type { RequestError } from "@/lib/errors";

interface FileBrowserErrorStateProps {
  error: RequestError;
  lockedFolderLabel: string;
  errorTitle: string;
  errorMessage: string;
}

function isCriticalAuthError(message: string): boolean {
  return (
    message.includes("Sesi Google Drive kadaluarsa") ||
    message.includes("Aplikasi belum dikonfigurasi")
  );
}

function setupRequiredType(message: string): "expired" | "config" {
  return message.includes("kadaluarsa") ? "expired" : "config";
}

export default function FileBrowserErrorState({
  error,
  lockedFolderLabel,
  errorTitle,
  errorMessage,
}: FileBrowserErrorStateProps) {
  if (isCriticalAuthError(error.message)) {
    return (
      <SetupRequired
        message={error.message}
        type={setupRequiredType(error.message)}
      />
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground w-full gap-4">
      <div className="p-4 bg-destructive/10 rounded-full text-destructive">
        <ShieldAlert className="w-8 h-8" />
      </div>
      <div className="text-center">
        <h3 className="text-lg font-semibold text-foreground">
          {error.status === 401 ? lockedFolderLabel : errorTitle}
        </h3>
        <p className="text-sm max-w-md mt-1">{error.message || errorMessage}</p>
      </div>
    </div>
  );
}
