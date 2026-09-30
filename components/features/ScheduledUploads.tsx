"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
} from "react";
import {
  abandonScheduledUpload,
  cancelScheduledUpload,
  commitScheduledUpload,
  createScheduledUpload,
  getScheduledUpload,
  listScheduledUploads,
  retryScheduledUpload,
  stageScheduledUploadItemContent,
  updateScheduledUploadTime,
  type ScheduledUpload,
  type ScheduledUploadAdminAlert,
  type ScheduledUploadLimits,
  type ScheduledUploadManifestItem,
} from "@/packages/sdk/src/orval";
import { useAppStore } from "@/lib/store";
import {
  getZeeMobileBridge,
  isZeeMobileBridgeAvailable,
  type ZeeMobileScheduledUploadOptions,
  type ZeeMobileScheduledUploadProgress,
} from "@/lib/mobile-bridge";
import { useTranslations } from "next-intl";

interface ScheduledUploadsProps {
  destinationId: string;
  destinationName: string;
}

interface UploadProgress {
  scheduleId: string;
  index: number;
  total: number;
  path: string;
}

function getFilePath(file: File) {
  const relativePath =
    (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
    file.name;
  const segments = relativePath
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean);
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("The selected file has an unsafe relative path.");
  }
  return segments.join("/");
}

function createManifest(files: readonly File[]): ScheduledUploadManifestItem[] {
  const items = new Map<string, ScheduledUploadManifestItem>();
  for (const file of files) {
    const filePath = getFilePath(file);
    if (!filePath || items.has(filePath)) {
      throw new Error("Each selected file must have a unique relative path.");
    }
    const segments = filePath.split("/").filter(Boolean);
    for (let index = 1; index < segments.length; index += 1) {
      const folderPath = segments.slice(0, index).join("/");
      if (items.get(folderPath)?.kind === "file") {
        throw new Error("A selected file path is also used as a folder.");
      }
      if (!items.has(folderPath)) {
        items.set(folderPath, { path: folderPath, kind: "folder", size: 0 });
      }
    }
    items.set(filePath, {
      path: filePath,
      kind: "file",
      size: file.size,
      ...(file.type ? { contentType: file.type } : {}),
    });
  }
  return [...items.values()].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
    return left.path.localeCompare(right.path);
  });
}

function formatLocalDateTime(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return year + "-" + month + "-" + day + "T" + hour + ":" + minute;
}

function parseLocalDateTime(value: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || formatLocalDateTime(date) !== value) {
    return null;
  }
  return date;
}

function getUtcOffset(date: Date) {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offset);
  const hours = String(Math.floor(absoluteMinutes / 60)).padStart(2, "0");
  const minutes = String(absoluteMinutes % 60).padStart(2, "0");
  return sign + hours + ":" + minutes;
}

function apiError(data: unknown, fallback: string) {
  if (typeof data === "object" && data !== null) {
    if ("error" in data && typeof data.error === "string") return data.error;
    if ("message" in data && typeof data.message === "string")
      return data.message;
  }
  return fallback;
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatBytes(bytes: number, locale: string) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return (
    new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value) +
    " " +
    units[exponent]
  );
}

const folderPickerAttributes = {
  webkitdirectory: "",
  directory: "",
} as InputHTMLAttributes<HTMLInputElement> & {
  webkitdirectory?: string;
  directory?: string;
};

export default function ScheduledUploads({
  destinationId,
  destinationName,
}: Readonly<ScheduledUploadsProps>) {
  const t = useTranslations("ScheduledUploads");
  const user = useAppStore((state) => state.user);
  const fetchUser = useAppStore((state) => state.fetchUser);
  const filePickerRef = useRef<HTMLInputElement>(null);
  const folderPickerRef = useRef<HTMLInputElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [scheduledLocalTime, setScheduledLocalTime] = useState("");
  const [schedules, setSchedules] = useState<ScheduledUpload[]>([]);
  const [alerts, setAlerts] = useState<ScheduledUploadAdminAlert[]>([]);
  const [limits, setLimits] = useState<ScheduledUploadLimits | null>(null);
  const [rescheduleValues, setRescheduleValues] = useState<
    Record<string, string>
  >({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [nativeProgress, setNativeProgress] =
    useState<ZeeMobileScheduledUploadProgress | null>(null);
  const [nativeBridgeAvailable, setNativeBridgeAvailable] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const isAdmin = user?.role === "ADMIN";
  const canScheduleUploads = isAdmin || user?.role === "EDITOR";
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const formatLocale = Intl.DateTimeFormat().resolvedOptions().locale || "en";
  const manifest = useMemo(() => {
    try {
      return { items: createManifest(selectedFiles), error: "" };
    } catch (manifestError) {
      return {
        items: [] as ScheduledUploadManifestItem[],
        error: errorText(manifestError, t("invalidSelection")),
      };
    }
  }, [selectedFiles, t]);
  const localDueDate = parseLocalDateTime(scheduledLocalTime);
  const duePreview =
    localDueDate && localDueDate.getTime() > Date.now() ? localDueDate : null;
  const minimumTime = formatLocalDateTime(new Date(Date.now() + 60_000));

  const reload = useCallback(async () => {
    try {
      const response = await listScheduledUploads();
      if (response.status !== 200) {
        throw new Error(apiError(response.data, t("loadFailed")));
      }
      setSchedules(response.data.items);
      setLimits(response.data.limits);
    } catch (loadError) {
      setError(errorText(loadError, t("loadFailed")));
    }

    if (isAdmin) {
      try {
        const response = await fetch(
          "/api/admin/scheduled-uploads/alerts?status=OPEN",
          { cache: "no-store" },
        );
        const data = (await response.json()) as {
          alerts?: ScheduledUploadAdminAlert[];
          error?: string;
        };
        if (!response.ok) throw new Error(data.error || t("alertsLoadFailed"));
        setAlerts(data.alerts ?? []);
      } catch (alertError) {
        setError(errorText(alertError, t("alertsLoadFailed")));
      }
    } else {
      setAlerts([]);
    }
    setLoading(false);
  }, [isAdmin, t]);

  useEffect(() => {
    if (!user) fetchUser();
  }, [fetchUser, user]);

  useEffect(() => {
    setNativeBridgeAvailable(isZeeMobileBridgeAvailable());
  }, []);

  useEffect(() => {
    if (!user || !canScheduleUploads) {
      setLoading(false);
      return;
    }
    void reload();
    const timer = window.setInterval(() => void reload(), 15_000);
    return () => window.clearInterval(timer);
  }, [canScheduleUploads, reload, user]);

  const addSelectedFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (nextFiles.length === 0) return;
    const merged = new Map(
      selectedFiles.map((file) => [getFilePath(file), file]),
    );
    for (const file of nextFiles) {
      const filePath = getFilePath(file);
      if (merged.has(filePath) && merged.get(filePath) !== file) {
        setError(t("invalidSelection"));
        return;
      }
      merged.set(filePath, file);
    }
    setSelectedFiles(
      [...merged.values()].sort((left, right) =>
        getFilePath(left).localeCompare(getFilePath(right)),
      ),
    );
    setError("");
    setNotice("");
  };

  const removeSelectedFile = (filePath: string) => {
    setSelectedFiles((current) =>
      current.filter((file) => getFilePath(file) !== filePath),
    );
  };

  const stageAndCommit = async (
    schedule: ScheduledUpload,
    files: readonly File[],
  ) => {
    setBusyId(schedule.id);
    setError("");
    setNotice("");
    try {
      const details = await getScheduledUpload(schedule.id);
      if (details.status !== 200) {
        throw new Error(apiError(details.data, t("loadFailed")));
      }
      const current = details.data.schedule;
      if (current.status !== "STAGING") {
        throw new Error(t("scheduleNoLongerStaging"));
      }

      const fileMap = new Map(files.map((file) => [getFilePath(file), file]));
      const fileItems = current.items.filter((item) => item.kind === "FILE");
      const filePaths = new Set(fileItems.map((item) => item.path));
      const hasUnexpectedFile = [...fileMap.keys()].some(
        (filePath) => !filePaths.has(filePath),
      );
      if (
        hasUnexpectedFile ||
        fileItems.some(
          (item) => item.status !== "STAGED" && !fileMap.has(item.path),
        )
      ) {
        throw new Error(t("selectMatchingFiles"));
      }

      const pendingItems = fileItems.filter((item) => item.status !== "STAGED");
      for (let index = 0; index < pendingItems.length; index += 1) {
        const item = pendingItems[index]!;
        const file = fileMap.get(item.path);
        if (!file) throw new Error(t("selectMatchingFiles"));
        setProgress({
          scheduleId: schedule.id,
          index: index + 1,
          total: pendingItems.length,
          path: item.path,
        });
        const response = await stageScheduledUploadItemContent(
          schedule.id,
          item.id,
          file,
        );
        if (response.status !== 200) {
          throw new Error(apiError(response.data, t("stageFailed")));
        }
      }

      setProgress({
        scheduleId: schedule.id,
        index: pendingItems.length,
        total: pendingItems.length,
        path: "",
      });
      const committed = await commitScheduledUpload(schedule.id);
      if (committed.status !== 200) {
        throw new Error(apiError(committed.data, t("commitFailed")));
      }
      setNotice(t("privatePackageWaiting"));
      setSelectedFiles([]);
    } catch (stageError) {
      setError(errorText(stageError, t("stageFailed")));
    } finally {
      setProgress(null);
      await reload();
      setBusyId(null);
    }
  };

  const createAndStage = async () => {
    if (!destinationId || !canScheduleUploads) return;
    if (manifest.error) {
      setError(manifest.error);
      return;
    }
    if (manifest.items.length === 0) {
      setError(t("selectFilesFirst"));
      return;
    }
    if (!duePreview) {
      setError(t("chooseFutureTime"));
      return;
    }
    setBusyId("creating");
    setError("");
    setNotice("");
    try {
      const response = await createScheduledUpload({
        destinationId,
        scheduledLocalTime,
        timeZone,
        utcOffset: getUtcOffset(duePreview),
        items: manifest.items,
      });
      if (response.status !== 201) {
        throw new Error(apiError(response.data, t("createFailed")));
      }
      const schedule = response.data.schedule;
      await stageAndCommit(schedule, selectedFiles);
    } catch (createError) {
      setError(errorText(createError, t("createFailed")));
      setBusyId(null);
      await reload();
    }
  };

  const runNativeFolderUpload = async (
    options: ZeeMobileScheduledUploadOptions,
    activeId: string,
  ) => {
    const bridge = getZeeMobileBridge();
    if (!bridge) {
      setError(t("nativeUnavailable"));
      return;
    }
    setBusyId(activeId);
    setNativeProgress(null);
    setError("");
    setNotice("");
    try {
      await bridge.pickAndStageScheduledUpload(options, setNativeProgress);
      setNotice(t("privatePackageWaiting"));
      setSelectedFiles([]);
    } catch (nativeError) {
      setError(errorText(nativeError, t("stageFailed")));
    } finally {
      setNativeProgress(null);
      await reload();
      setBusyId(null);
    }
  };

  const createAndStageOnDevice = async () => {
    if (!destinationId || !canScheduleUploads) return;
    if (!duePreview) {
      setError(t("chooseFutureTime"));
      return;
    }
    await runNativeFolderUpload(
      {
        mode: "create",
        destinationId,
        scheduledLocalTime,
        timeZone,
        utcOffset: getUtcOffset(duePreview),
      },
      "creating-native",
    );
  };

  const resumeStaging = async (schedule: ScheduledUpload) => {
    if (nativeBridgeAvailable && selectedFiles.length === 0) {
      await runNativeFolderUpload(
        { mode: "resume", scheduleId: schedule.id },
        schedule.id,
      );
      return;
    }
    if (selectedFiles.length === 0) {
      setError(t("selectFilesToResume"));
      return;
    }
    await stageAndCommit(schedule, selectedFiles);
  };

  const cancelSchedule = async (schedule: ScheduledUpload) => {
    if (!window.confirm(t("cancelConfirm"))) return;
    setBusyId(schedule.id);
    setError("");
    try {
      if (isAdmin) {
        const response = await fetch("/api/admin/scheduled-uploads/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scheduleId: schedule.id }),
        });
        const data = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(data.error || t("cancelFailed"));
      } else {
        const response = await cancelScheduledUpload(schedule.id);
        if (response.status !== 200) {
          throw new Error(apiError(response.data, t("cancelFailed")));
        }
      }
      setNotice(t("scheduleCanceled"));
    } catch (cancelError) {
      setError(errorText(cancelError, t("cancelFailed")));
    } finally {
      await reload();
      setBusyId(null);
    }
  };

  const reschedule = async (schedule: ScheduledUpload) => {
    const value =
      rescheduleValues[schedule.id] ??
      formatLocalDateTime(new Date(schedule.scheduledAt));
    const date = parseLocalDateTime(value);
    if (!date || date.getTime() <= Date.now()) {
      setError(t("chooseFutureTime"));
      return;
    }
    setBusyId(schedule.id);
    setError("");
    try {
      const response = await updateScheduledUploadTime(schedule.id, {
        scheduledLocalTime: value,
        timeZone,
        utcOffset: getUtcOffset(date),
      });
      if (response.status !== 200) {
        throw new Error(apiError(response.data, t("rescheduleFailed")));
      }
      setNotice(t("rescheduleSaved"));
    } catch (rescheduleError) {
      setError(errorText(rescheduleError, t("rescheduleFailed")));
    } finally {
      await reload();
      setBusyId(null);
    }
  };

  const retrySchedule = async (schedule: ScheduledUpload) => {
    setBusyId(schedule.id);
    setError("");
    try {
      const response = await retryScheduledUpload(schedule.id);
      if (response.status !== 200) {
        throw new Error(apiError(response.data, t("retryFailed")));
      }
      setNotice(t("retryStarted"));
    } catch (retryError) {
      setError(errorText(retryError, t("retryFailed")));
    } finally {
      await reload();
      setBusyId(null);
    }
  };

  const abandonSchedule = async (schedule: ScheduledUpload) => {
    if (!window.confirm(t("abandonConfirm"))) return;
    setBusyId(schedule.id);
    setError("");
    try {
      const response = await abandonScheduledUpload(schedule.id);
      if (response.status !== 200) {
        throw new Error(apiError(response.data, t("abandonFailed")));
      }
      setNotice(t("scheduleAbandoned"));
    } catch (abandonError) {
      setError(errorText(abandonError, t("abandonFailed")));
    } finally {
      await reload();
      setBusyId(null);
    }
  };

  const acknowledgeAlert = async (alert: ScheduledUploadAdminAlert) => {
    setBusyId("alert-" + alert.id);
    setError("");
    try {
      const response = await fetch(
        "/api/admin/scheduled-uploads/alerts/update",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            alertId: alert.id,
            status: "ACKNOWLEDGED",
          }),
        },
      );
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || t("acknowledgeFailed"));
      setNotice(t("alertAcknowledged"));
    } catch (alertError) {
      setError(errorText(alertError, t("acknowledgeFailed")));
    } finally {
      await reload();
      setBusyId(null);
    }
  };

  const cancelAlertSchedule = async (alert: ScheduledUploadAdminAlert) => {
    const schedule = schedules.find((item) => item.id === alert.scheduleId);
    if (schedule) await cancelSchedule(schedule);
  };

  const statusLabel = (status: ScheduledUpload["status"]) => {
    const labels: Record<ScheduledUpload["status"], string> = {
      STAGING: t("statusStaging"),
      WAITING: t("statusWaiting"),
      RELEASING: t("statusReleasing"),
      PARTIAL: t("statusPartial"),
      NEEDS_ATTENTION: t("statusNeedsAttention"),
      COMPLETED: t("statusCompleted"),
      CANCELED: t("statusCanceled"),
      ABANDONED: t("statusAbandoned"),
    };
    return labels[status];
  };

  const itemStatusLabel = (
    status: ScheduledUpload["items"][number]["status"],
  ) => {
    const labels: Record<ScheduledUpload["items"][number]["status"], string> = {
      PENDING: t("itemPending"),
      STAGING: t("itemStaging"),
      STAGED: t("itemStaged"),
      UPLOADING: t("itemUploading"),
      COMPLETE: t("itemComplete"),
      FAILED: t("itemFailed"),
    };
    return labels[status];
  };

  const editorRequired = user && !canScheduleUploads;
  const nativeProgressText = nativeProgress
    ? nativeProgress.phase === "scanning"
      ? t("nativeScanning", { path: nativeProgress.path ?? "" })
      : nativeProgress.phase === "staging"
        ? t("nativeStaging", {
            index: nativeProgress.index ?? 0,
            total: nativeProgress.total ?? 0,
            path: nativeProgress.path ?? "",
          })
        : t("nativeCommitting")
    : "";

  return (
    <main className="mx-auto w-full max-w-5xl space-y-8 pb-12">
      <header className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          Vaehor
        </p>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {t("title")}
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          {t("intro")}
        </p>
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm leading-6">
          <strong className="font-semibold">{t("privacyTitle")}</strong>{" "}
          {t("privacyNote")}
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm"
        >
          {notice}
        </div>
      )}
      {nativeProgress && (
        <div
          role="status"
          className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm"
        >
          {nativeProgressText}
        </div>
      )}

      {editorRequired && (
        <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          {t("editorRequired")}
        </div>
      )}

      {canScheduleUploads && (
        <section className="rounded-xl border bg-card p-5 shadow-sm sm:p-7">
          <div className="mb-6 flex flex-col gap-2">
            <h2 className="text-lg font-semibold">{t("createTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("createIntro")}</p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <span className="text-sm font-medium">{t("destination")}</span>
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                {destinationId
                  ? destinationName || destinationId
                  : t("chooseDestination")}
              </div>
              {destinationId && (
                <p className="break-all text-xs text-muted-foreground">
                  {destinationId}
                </p>
              )}
            </div>
            <label className="space-y-2">
              <span className="text-sm font-medium">{t("dueTime")}</span>
              <input
                type="datetime-local"
                min={minimumTime}
                value={scheduledLocalTime}
                onChange={(event) => setScheduledLocalTime(event.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              {duePreview ? (
                <p className="text-xs text-muted-foreground">
                  {t("timePreview")}:{" "}
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone,
                  }).format(duePreview)}{" "}
                  ({timeZone}, {getUtcOffset(duePreview)})
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t("timeZone")}: {timeZone}
                </p>
              )}
            </label>
          </div>

          <div className="mt-6 space-y-3">
            <div>
              <h3 className="text-sm font-semibold">{t("filesTitle")}</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {t("filesHelp")}
              </p>
            </div>
            {nativeBridgeAvailable && (
              <div className="space-y-3">
                <p className="text-xs leading-5 text-muted-foreground">
                  {t("mobileFolderHelp")}
                </p>
                <button
                  type="button"
                  onClick={() => void createAndStageOnDevice()}
                  disabled={
                    busyId !== null ||
                    !destinationId ||
                    !scheduledLocalTime ||
                    !duePreview
                  }
                  className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
                >
                  {busyId === "creating-native"
                    ? t("creating")
                    : t("chooseNativeFolder")}
                </button>
              </div>
            )}
            <input
              ref={filePickerRef}
              type="file"
              multiple
              className="sr-only"
              onChange={addSelectedFiles}
              aria-label={t("chooseFiles")}
            />
            <input
              ref={folderPickerRef}
              type="file"
              multiple
              className="sr-only"
              onChange={addSelectedFiles}
              aria-label={t("chooseFolder")}
              {...folderPickerAttributes}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => filePickerRef.current?.click()}
                className="inline-flex items-center rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
              >
                {t("chooseFiles")}
              </button>
              <button
                type="button"
                onClick={() => folderPickerRef.current?.click()}
                className="inline-flex items-center rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
              >
                {t("chooseFolder")}
              </button>
              {selectedFiles.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedFiles([])}
                  className="inline-flex items-center rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
                >
                  {t("clearSelection")}
                </button>
              )}
            </div>

            {selectedFiles.length > 0 && (
              <div className="rounded-lg border">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-sm">
                  <span className="font-medium">
                    {t("selectionSummary", {
                      count: selectedFiles.length,
                      size: formatBytes(
                        selectedFiles.reduce((sum, file) => sum + file.size, 0),
                        formatLocale,
                      ),
                    })}
                  </span>
                  {manifest.error && (
                    <span className="text-destructive">{manifest.error}</span>
                  )}
                </div>
                <ul className="max-h-48 divide-y overflow-auto">
                  {selectedFiles.map((file) => (
                    <li
                      key={getFilePath(file)}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    >
                      <span
                        className="min-w-0 flex-1 truncate"
                        title={getFilePath(file)}
                      >
                        {getFilePath(file)}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatBytes(file.size, formatLocale)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeSelectedFile(getFilePath(file))}
                        className="shrink-0 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                        aria-label={t("removeFile", {
                          name: getFilePath(file),
                        })}
                      >
                        {t("remove")}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button
              type="button"
              onClick={createAndStage}
              disabled={
                busyId !== null ||
                !destinationId ||
                !scheduledLocalTime ||
                !duePreview ||
                selectedFiles.length === 0 ||
                Boolean(manifest.error)
              }
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            >
              {busyId === "creating" ? t("creating") : t("createAndStage")}
            </button>

            {limits && (
              <p className="text-xs text-muted-foreground">
                {t("limits", {
                  file: formatBytes(Number(limits.maxFileBytes), formatLocale),
                  package: formatBytes(
                    Number(limits.maxPackageBytes),
                    formatLocale,
                  ),
                  items: limits.maxItems,
                })}
              </p>
            )}
          </div>
        </section>
      )}

      {isAdmin && (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{t("adminInbox")}</h2>
              <p className="text-sm text-muted-foreground">
                {t("adminInboxHelp")}
              </p>
            </div>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">
              {alerts.length}
            </span>
          </div>
          {alerts.length === 0 ? (
            <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
              {t("noAlerts")}
            </div>
          ) : (
            <div className="space-y-3">
              {alerts.map((alert) => (
                <article
                  key={alert.id}
                  className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium">{t("roleRevokedTitle")}</p>
                    <p className="text-sm text-muted-foreground">
                      {alert.schedule.creatorEmail} · {alert.reasonCode}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(alert.schedule.scheduledAt).toLocaleString(
                        formatLocale,
                      )}
                      {" · "}
                      {statusLabel(alert.schedule.status)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void acknowledgeAlert(alert)}
                      disabled={busyId !== null}
                      className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
                    >
                      {t("acknowledge")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void cancelAlertSchedule(alert)}
                      disabled={
                        busyId !== null ||
                        !schedules.some((item) => item.id === alert.scheduleId)
                      }
                      className="rounded-md border border-destructive/30 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/5 disabled:opacity-50"
                    >
                      {t("adminCancel")}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{t("mySchedules")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("mySchedulesHelp")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void reload()}
            disabled={loading || busyId !== null}
            className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            {t("refresh")}
          </button>
        </div>

        {loading ? (
          <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
            {t("loading")}
          </div>
        ) : schedules.length === 0 ? (
          <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
            {t("noSchedules")}
          </div>
        ) : (
          <div className="space-y-4">
            {schedules.map((schedule) => {
              const fileItems = schedule.items.filter(
                (item) => item.kind === "FILE",
              );
              const transferredBytes =
                schedule.status === "STAGING"
                  ? Number(schedule.stagedBytes)
                  : fileItems.reduce(
                      (total, item) => total + Number(item.uploadedBytes),
                      0,
                    );
              const totalBytes = Number(schedule.totalBytes);
              const progressPercent =
                totalBytes > 0
                  ? Math.min(
                      100,
                      Math.round((transferredBytes / totalBytes) * 100),
                    )
                  : schedule.status === "STAGING"
                    ? 0
                    : 100;
              const ownsSchedule = schedule.creatorEmail === user?.email;
              const canReschedule =
                ownsSchedule &&
                (schedule.status === "STAGING" ||
                  schedule.status === "WAITING");
              const canCancel =
                schedule.status === "STAGING" || schedule.status === "WAITING";
              const canRetry =
                ownsSchedule &&
                (schedule.status === "PARTIAL" ||
                  schedule.status === "NEEDS_ATTENTION");

              return (
                <article
                  key={schedule.id}
                  className="overflow-hidden rounded-xl border bg-card shadow-sm"
                >
                  <div className="space-y-4 p-4 sm:p-5">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">
                            {statusLabel(schedule.status)}
                          </h3>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                            {schedule.itemCount} {t("items")}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {t("scheduledFor")}: {schedule.scheduledLocalTime} ·{" "}
                          {schedule.timeZone} ({schedule.utcOffset})
                        </p>
                        {isAdmin && (
                          <p className="text-xs text-muted-foreground">
                            {t("creator")}: {schedule.creatorEmail}
                          </p>
                        )}
                      </div>
                      <div className="text-sm font-medium tabular-nums">
                        {formatBytes(totalBytes, formatLocale)}
                      </div>
                    </div>

                    <div
                      className="h-2 overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-label={t("uploadProgress")}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={progressPercent}
                    >
                      <div
                        className="h-full rounded-full bg-primary transition-[width]"
                        style={{ width: progressPercent + "%" }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(transferredBytes, formatLocale)} /{" "}
                      {formatBytes(totalBytes, formatLocale)}
                    </p>

                    {schedule.lastErrorMessage && (
                      <p className="rounded-md bg-destructive/5 px-3 py-2 text-sm text-destructive">
                        {schedule.lastErrorMessage}
                      </p>
                    )}
                    {progress?.scheduleId === schedule.id && (
                      <p role="status" className="text-sm text-primary">
                        {t("stagingFile", {
                          index: progress.index,
                          total: progress.total,
                          path: progress.path,
                        })}
                      </p>
                    )}

                    <ul className="max-h-40 divide-y overflow-auto rounded-lg border">
                      {schedule.items.map((item) => (
                        <li
                          key={item.id}
                          className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                        >
                          <span
                            className="min-w-0 flex-1 truncate"
                            title={item.path}
                          >
                            {item.path}
                          </span>
                          <span className="shrink-0 text-muted-foreground">
                            {item.kind === "FOLDER"
                              ? t("folder")
                              : formatBytes(Number(item.size), formatLocale)}
                          </span>
                          <span className="shrink-0 rounded bg-muted px-2 py-0.5">
                            {itemStatusLabel(item.status)}
                          </span>
                        </li>
                      ))}
                    </ul>

                    {(canReschedule ||
                      canCancel ||
                      canRetry ||
                      schedule.status === "STAGING") && (
                      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                        {schedule.status === "STAGING" && (
                          <button
                            type="button"
                            onClick={() => void resumeStaging(schedule)}
                            disabled={
                              busyId !== null ||
                              (!nativeBridgeAvailable &&
                                selectedFiles.length === 0)
                            }
                            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                          >
                            {nativeBridgeAvailable && selectedFiles.length === 0
                              ? t("continueOnDevice")
                              : t("continueStaging")}
                          </button>
                        )}
                        {canReschedule && (
                          <>
                            <input
                              type="datetime-local"
                              min={minimumTime}
                              value={
                                rescheduleValues[schedule.id] ??
                                formatLocalDateTime(
                                  new Date(schedule.scheduledAt),
                                )
                              }
                              onChange={(event) =>
                                setRescheduleValues((current) => ({
                                  ...current,
                                  [schedule.id]: event.target.value,
                                }))
                              }
                              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                              aria-label={t("rescheduleTime")}
                            />
                            <button
                              type="button"
                              onClick={() => void reschedule(schedule)}
                              disabled={busyId !== null}
                              className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
                            >
                              {t("reschedule")}
                            </button>
                          </>
                        )}
                        {canRetry && (
                          <button
                            type="button"
                            onClick={() => void retrySchedule(schedule)}
                            disabled={busyId !== null}
                            className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
                          >
                            {t("retry")}
                          </button>
                        )}
                        {canRetry && (
                          <button
                            type="button"
                            onClick={() => void abandonSchedule(schedule)}
                            disabled={busyId !== null}
                            className="rounded-md border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
                          >
                            {t("abandon")}
                          </button>
                        )}
                        {canCancel && (
                          <button
                            type="button"
                            onClick={() => void cancelSchedule(schedule)}
                            disabled={busyId !== null}
                            className="rounded-md border border-destructive/30 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/5 disabled:opacity-50"
                          >
                            {t("cancel")}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
