import {
  ScheduledUploadStatus,
  type CreateScheduledUploadRequest,
  type ScheduledUpload,
  type ScheduledUploadAdminAlert,
  type ScheduledUploadSummary,
  type UpdateScheduledUploadTimeRequest,
} from "@vaehor/sdk";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ActiveMobileRouteSession } from "./route-session";
import { loadActiveRouteSession } from "./route-session";
import { listMobileDrives } from "../lib/file-api";
import { useMobilePreferences } from "../lib/mobile-preferences";
import {
  pickScheduledUploadDirectory,
  pickScheduledUploadFiles,
  type NativeScheduledUploadEntry,
  type NativeScheduledUploadSelection,
} from "../lib/native-upload-file";
import {
  createScheduledUploadApi,
  ScheduledUploadApiError,
  type ScheduledUploadApi,
} from "../lib/scheduled-upload-api";
import {
  canManageScheduledUploads,
  loadScheduledUploadDashboard,
} from "../lib/scheduled-upload-queries";
import {
  getDefaultScheduledLocalTime,
  getDeviceTimeZone,
  resolveScheduledUploadTime,
} from "../lib/scheduled-upload-time";

export type ScheduledUploadDrive = Readonly<{
  id: string;
  name: string;
  rootFolderId: string;
  isProtected?: boolean;
}>;

export type ScheduledUploadPicker = Readonly<{
  pickFiles: () => Promise<NativeScheduledUploadSelection | null>;
  pickDirectory: () => Promise<NativeScheduledUploadSelection | null>;
}>;

type Locale = "en" | "zh";

type ScheduledUploadsScreenProps = Readonly<{
  api: ScheduledUploadApi | null;
  role: string;
  drives: ScheduledUploadDrive[];
  picker?: ScheduledUploadPicker;
  locale?: Locale;
  theme?: "light" | "dark";
  bootstrapLoading?: boolean;
  bootstrapError?: string | null;
  onRetrySession?: () => void;
}>;

type Dashboard = Awaited<ReturnType<typeof loadScheduledUploadDashboard>>;

const COPY: Record<Locale, Record<string, string>> = {
  en: {
    title: "Scheduled uploads",
    back: "‹ Files",
    refresh: "Refresh",
    create: "New scheduled upload",
    createTitle: "Schedule a private Drive upload",
    files: "Add files",
    folder: "Add folder",
    destination: "Drive destination",
    date: "Schedule date",
    time: "Schedule time",
    keepOpen: "Keep this screen open until private staging is complete.",
    stage: "Stage and schedule",
    resume: "Resume private staging",
    cancelSelection: "Clear selection",
    noSchedules: "No scheduled uploads yet.",
    loadOlder: "Load older schedules",
    loadingOlder: "Loading older schedules…",
    showItems: "View items",
    hideItems: "Hide items",
    loadingItems: "Loading items…",
    staged: "privately staged",
    uploaded: "uploaded",
    adminEmpty: "No schedules need attention.",
    loading: "Loading scheduled uploads...",
    access: "Editor or admin access is required.",
    retry: "Retry",
    waiting: "Waiting",
    staging: "Staging privately",
    writing: "Writing to Drive",
    partial: "Partially complete",
    attention: "Needs attention",
    completed: "Completed",
    canceled: "Canceled",
    abandoned: "Abandoned",
    reschedule: "Reschedule",
    saveTime: "Save new time",
    cancel: "Cancel schedule",
    retryItems: "Retry remaining items",
    abandon: "Abandon remaining items",
    adminCancel: "Cancel for all users",
    acknowledge: "Acknowledge alert",
    resolve: "Resolve alert",
    owner: "Created by",
    destinationMissing: "No writable Drive destination is available.",
    noSelection: "Select one or more files or a folder.",
    waitingForServer:
      "The server has not confirmed complete private staging yet. Keep this screen open and retry.",
    stageProgress: "Staging privately",
    bytes: "bytes",
    file: "File",
    folderItem: "Folder",
    noDestination: "Choose a Drive destination before scheduling.",
  },
  zh: {
    title: "排程上傳",
    back: "‹ 檔案",
    refresh: "重新整理",
    create: "新增排程上傳",
    createTitle: "排程私人雲端硬碟上傳",
    files: "選擇檔案",
    folder: "選擇資料夾",
    destination: "雲端硬碟目的地",
    date: "排程日期",
    time: "排程時間",
    keepOpen: "私人暫存完成前請保持此畫面開啟。",
    stage: "暫存並排程",
    resume: "繼續私人暫存",
    cancelSelection: "清除選取內容",
    noSchedules: "目前沒有排程上傳。",
    loadOlder: "載入較早的排程",
    loadingOlder: "正在載入較早的排程…",
    showItems: "檢視檔案明細",
    hideItems: "收合檔案明細",
    loadingItems: "正在載入檔案明細…",
    staged: "已私人暫存",
    uploaded: "已上傳",
    adminEmpty: "目前沒有需要處理的排程。",
    loading: "正在載入排程上傳…",
    access: "需要編輯者或管理員權限。",
    retry: "重試",
    waiting: "等待中",
    staging: "私人暫存中",
    writing: "正在寫入雲端硬碟",
    partial: "部分完成",
    attention: "需要處理",
    completed: "已完成",
    canceled: "已取消",
    abandoned: "已放棄",
    reschedule: "重新排程",
    saveTime: "儲存新時間",
    cancel: "取消排程",
    retryItems: "重試剩餘項目",
    abandon: "放棄剩餘項目",
    adminCancel: "為所有使用者取消",
    acknowledge: "確認提醒",
    resolve: "結案提醒",
    owner: "建立者",
    destinationMissing: "沒有可寫入的雲端硬碟目的地。",
    noSelection: "請選擇一個以上的檔案或資料夾。",
    waitingForServer: "伺服器尚未確認私人暫存完成。請保持此畫面開啟後重試。",
    stageProgress: "私人暫存中",
    bytes: "位元組",
    file: "檔案",
    folderItem: "資料夾",
    noDestination: "請先選擇雲端硬碟目的地。",
  },
};

const statusLabels: Record<ScheduledUpload["status"], keyof typeof COPY.en> = {
  [ScheduledUploadStatus.STAGING]: "staging",
  [ScheduledUploadStatus.WAITING]: "waiting",
  [ScheduledUploadStatus.RELEASING]: "writing",
  [ScheduledUploadStatus.PARTIAL]: "partial",
  [ScheduledUploadStatus.NEEDS_ATTENTION]: "attention",
  [ScheduledUploadStatus.COMPLETED]: "completed",
  [ScheduledUploadStatus.CANCELED]: "canceled",
  [ScheduledUploadStatus.ABANDONED]: "abandoned",
};

const DEFAULT_PICKER: ScheduledUploadPicker = {
  pickFiles: pickScheduledUploadFiles,
  pickDirectory: pickScheduledUploadDirectory,
};

function errorMessage(cause: unknown): string {
  if (cause instanceof ScheduledUploadApiError) {
    return `${cause.message} (HTTP ${cause.status})`;
  }
  if (cause instanceof Error) return cause.message;
  return "The server could not complete this request.";
}

function scheduleFields(localDateTime: string): { date: string; time: string } {
  const [date = "", time = ""] = localDateTime.split("T");
  return { date, time: time.slice(0, 5) };
}

function parseByteCount(value: string | number): number {
  const bytes = Number(value);
  return Number.isFinite(bytes) && bytes >= 0 ? bytes : 0;
}

function fileEntries(entries: readonly NativeScheduledUploadEntry[]) {
  return entries.filter((entry) => entry.kind === "file");
}

function summarizeSchedule(schedule: ScheduledUpload): ScheduledUploadSummary {
  const { items, ...summary } = schedule;
  const uploadedBytes = items
    .filter((item) => item.kind === "FILE")
    .reduce((total, item) => total + BigInt(item.uploadedBytes), 0n);
  return { ...summary, uploadedBytes: uploadedBytes.toString() };
}

async function readFileAsBlob(
  file: NonNullable<NativeScheduledUploadEntry["file"]>,
): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  const chunkSize = 1024 * 1024;
  let reads = Promise.resolve();
  for (let start = 0; start < file.size; start += chunkSize) {
    const end = Math.min(file.size, start + chunkSize);
    reads = reads.then(async () => {
      chunks.push(await file.readChunk(start, end));
    });
  }
  await reads;
  return new Blob(
    chunks.map((chunk) => {
      const copy = new Uint8Array(chunk.byteLength);
      copy.set(chunk);
      return copy.buffer;
    }),
    { type: file.mimeType },
  );
}

function mergeSelections(
  previous: NativeScheduledUploadSelection,
  next: NativeScheduledUploadSelection,
): NativeScheduledUploadSelection {
  const knownPaths = new Set(previous.entries.map((entry) => entry.path));
  const duplicate = next.entries.find((entry) => knownPaths.has(entry.path));
  if (duplicate) {
    next.release();
    throw new Error(`The selected path already exists: ${duplicate.path}`);
  }

  let released = false;
  return {
    entries: [...previous.entries, ...next.entries].sort((a, b) =>
      a.path.localeCompare(b.path),
    ),
    release: () => {
      if (released) return;
      released = true;
      previous.release();
      next.release();
    },
  };
}

function button(
  label: string,
  onPress: () => void,
  colors: { accent: string; border: string; foreground: string; muted: string },
  disabled = false,
  selected = false,
) {
  return (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { borderColor: selected ? colors.accent : colors.border },
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          { color: selected ? colors.accent : colors.foreground },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function updateDashboardWithSchedule(
  current: Dashboard | null,
  schedule: ScheduledUpload,
): Dashboard | null {
  if (!current) return current;
  return {
    ...current,
    schedules: [
      summarizeSchedule(schedule),
      ...current.schedules.filter((item) => item.id !== schedule.id),
    ],
  };
}

interface StagingContext {
  api: ScheduledUploadApi;
  active: { schedule: ScheduledUpload; stagedPaths: Set<string> };
  copy: Record<string, string>;
  clearSelection: () => void;
  setNewUploadOpen: (open: boolean) => void;
  setScheduleDetails: React.Dispatch<
    React.SetStateAction<Record<string, ScheduledUpload>>
  >;
  setDashboard: React.Dispatch<React.SetStateAction<Dashboard | null>>;
  refresh: () => void;
  setNotice: (notice: string | null) => void;
}

async function refreshActiveStagingSession(
  context: StagingContext,
): Promise<{ schedule: ScheduledUpload; stagedPaths: Set<string> } | null> {
  const { api, active, copy, clearSelection, setNewUploadOpen, setScheduleDetails, setDashboard, refresh, setNotice } = context;
  const latest = (await api.get(active.schedule.id)).schedule;
  active.schedule = latest;
  for (const item of latest.items) {
    if (item.kind === "FILE" && item.status === "STAGED") {
      active.stagedPaths.add(item.path);
    }
  }
  if (latest.status === ScheduledUploadStatus.WAITING) {
    clearSelection();
    setNewUploadOpen(false);
    setScheduleDetails((current) => ({
      ...current,
      [latest.id]: latest,
    }));
    setDashboard((current) => updateDashboardWithSchedule(current, latest));
    refresh();
    setNotice(copy.waiting);
    return null;
  }
  return active;
}

async function createNewSchedule(
  api: ScheduledUploadApi,
  scheduleTime: CreateScheduledUploadRequest,
  selection: NativeScheduledUploadSelection,
  copy: Record<string, string>,
  setStagingScheduleId: (id: string) => void,
): Promise<{ schedule: ScheduledUpload; stagedPaths: Set<string> }> {
  const manifest: CreateScheduledUploadRequest = {
    ...scheduleTime,
    items: [...selection.entries]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map(({ path, kind, size, contentType }) => ({
        path,
        kind,
        size,
        ...(contentType ? { contentType } : {}),
      })),
  };
  const created = await api.create(manifest);
  return {
    schedule: created.schedule,
    stagedPaths: new Set(),
  };
}

async function stageFiles(
  api: ScheduledUploadApi,
  activeSchedule: { schedule: ScheduledUpload; stagedPaths: Set<string> },
  files: NativeScheduledUploadEntry[],
  loadFileBlob: (entry: NativeScheduledUploadEntry) => Promise<Blob>,
  copy: Record<string, string>,
  setStagingPath: (path: string | null) => void,
  setNotice: (notice: string | null) => void,
) {
  const itemsByPath = new Map<
    string,
    (typeof activeSchedule.schedule.items)[number]
  >();
  for (const item of activeSchedule.schedule.items) {
    if (!itemsByPath.has(item.path)) itemsByPath.set(item.path, item);
  }
  let staging = Promise.resolve();
  for (const [index, entry] of files.entries()) {
    if (activeSchedule.stagedPaths.has(entry.path)) continue;
    staging = staging.then(async () => {
      setStagingPath(entry.path);
      const item = itemsByPath.get(entry.path);
      if (!item) {
        throw new Error(
          `The server did not accept ${entry.path} into this schedule.`,
        );
      }
      await api.stage(
        activeSchedule.schedule.id,
        item.id,
        await loadFileBlob(entry),
      );
      activeSchedule.stagedPaths.add(entry.path);
      setNotice(
        `${copy.stageProgress}: ${Math.min(index + 1, files.length)} / ${files.length}`,
      );
    });
  }
  await staging;
}

interface CommitContext {
  api: ScheduledUploadApi;
  activeSchedule: { schedule: ScheduledUpload; stagedPaths: Set<string> };
  copy: Record<string, string>;
  clearSelection: () => void;
  setNewUploadOpen: (open: boolean) => void;
  setScheduleDetails: React.Dispatch<
    React.SetStateAction<Record<string, ScheduledUpload>>
  >;
  setDashboard: React.Dispatch<React.SetStateAction<Dashboard | null>>;
  refresh: () => void;
  setNotice: (notice: string | null) => void;
  setStagingScheduleId: (id: string | null) => void;
  stagingRef: React.MutableRefObject<{
    schedule: ScheduledUpload;
    stagedPaths: Set<string>;
  } | null>;
}

async function commitSchedule(context: CommitContext) {
  const { api, activeSchedule, copy, clearSelection, setNewUploadOpen, setScheduleDetails, setDashboard, refresh, setNotice, setStagingScheduleId, stagingRef } = context;
  const committed = await api.commit(activeSchedule.schedule.id);
  if (committed.schedule.status !== ScheduledUploadStatus.WAITING) {
    activeSchedule.schedule = committed.schedule;
    stagingRef.current = { ...activeSchedule };
    setStagingScheduleId(activeSchedule.schedule.id);
    throw new Error(copy.waitingForServer);
  }

  clearSelection();
  setNewUploadOpen(false);
  setScheduleDetails((current) => ({
    ...current,
    [committed.schedule.id]: committed.schedule,
  }));
  setDashboard((current) =>
    updateDashboardWithSchedule(current, committed.schedule),
  );
  refresh();
  setNotice(copy.waiting);
}

export function ScheduledUploadsScreen({
  api,
  role,
  drives,
  picker = DEFAULT_PICKER,
  locale = "en",
  theme = "light",
  bootstrapLoading = false,
  bootstrapError = null,
  onRetrySession,
}: ScheduledUploadsScreenProps) {
  const router = useRouter();
  const copy = COPY[locale];
  const isAdmin = role.toUpperCase() === "ADMIN";
  const canManage = canManageScheduledUploads(role);
  const colors =
    theme === "dark"
      ? {
          background: "#111820",
          card: "#1C2732",
          foreground: "#F4F7F8",
          muted: "#AAB8C4",
          border: "#3C4A56",
          accent: "#74D2CB",
          danger: "#FF8B8B",
        }
      : {
          background: "#F4F7F8",
          card: "#FFFFFF",
          foreground: "#17252D",
          muted: "#52636D",
          border: "#D5E0E4",
          accent: "#1F6F78",
          danger: "#A52B2B",
        };
  const defaultTime = useMemo(() => {
    const [date = "", time = ""] = getDefaultScheduledLocalTime().split("T");
    return { date, time };
  }, []);
  const timeZone = useMemo(() => getDeviceTimeZone(), []);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [scheduleDetails, setScheduleDetails] = useState<
    Record<string, ScheduledUpload>
  >({});
  const [expandedScheduleId, setExpandedScheduleId] = useState<string | null>(
    null,
  );
  const [detailsLoadingId, setDetailsLoadingId] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [newUploadOpen, setNewUploadOpen] = useState(false);
  const [date, setDate] = useState(defaultTime.date);
  const [time, setTime] = useState(defaultTime.time);
  const [destinationId, setDestinationId] = useState(
    drives[0]?.rootFolderId ?? "",
  );
  const [selection, setSelection] =
    useState<NativeScheduledUploadSelection | null>(null);
  const selectionRef = useRef<NativeScheduledUploadSelection | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [stagingScheduleId, setStagingScheduleId] = useState<string | null>(
    null,
  );
  const [stagingPath, setStagingPath] = useState<string | null>(null);
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const stagingRef = useRef<{
    schedule: ScheduledUpload;
    stagedPaths: Set<string>;
  } | null>(null);

  useEffect(() => {
    return () => {
      selectionRef.current?.release();
      selectionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (
      drives.length &&
      !drives.some((drive) => drive.rootFolderId === destinationId)
    ) {
      setDestinationId(drives[0].rootFolderId);
    }
  }, [destinationId, drives]);

  useEffect(() => {
    if (bootstrapLoading || bootstrapError || !api || !canManage) return;
    let active = true;
    setListLoading(true);
    setListError(null);
    void loadScheduledUploadDashboard(api, role)
      .then((result) => {
        if (active) {
          setDashboard((current) => {
            if (!current) return result;
            const firstPageIds = new Set(
              result.schedules.map((schedule) => schedule.id),
            );
            const olderSchedules = current.schedules.filter(
              (schedule) => !firstPageIds.has(schedule.id),
            );
            return {
              ...result,
              schedules: [...result.schedules, ...olderSchedules],
              nextCursor:
                olderSchedules.length > 0
                  ? current.nextCursor
                  : result.nextCursor,
            };
          });
        }
      })
      .catch((cause: unknown) => {
        if (active) setListError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setListLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, bootstrapError, bootstrapLoading, canManage, refreshVersion, role]);

  const refresh = useCallback(() => {
    setNotice(null);
    setRefreshVersion((value) => value + 1);
  }, []);

  const loadOlderSchedules = async () => {
    if (!api || !dashboard?.nextCursor || listLoading) return;
    setListLoading(true);
    setListError(null);
    try {
      const nextPage = await api.list({ cursor: dashboard.nextCursor });
      setDashboard((current) => {
        if (!current) return current;
        const existingIds = new Set(
          current.schedules.map((schedule) => schedule.id),
        );
        return {
          ...current,
          schedules: [
            ...current.schedules,
            ...nextPage.items.filter(
              (schedule) => !existingIds.has(schedule.id),
            ),
          ],
          nextCursor: nextPage.nextCursor,
        };
      });
    } catch (cause) {
      setListError(errorMessage(cause));
    } finally {
      setListLoading(false);
    }
  };

  const toggleScheduleDetails = async (scheduleId: string) => {
    if (expandedScheduleId === scheduleId) {
      setExpandedScheduleId(null);
      return;
    }
    if (scheduleDetails[scheduleId]) {
      setExpandedScheduleId(scheduleId);
      return;
    }
    if (!api) return;
    setDetailsLoadingId(scheduleId);
    setActionError(null);
    try {
      const response = await api.get(scheduleId);
      setScheduleDetails((current) => ({
        ...current,
        [scheduleId]: response.schedule,
      }));
      setExpandedScheduleId(scheduleId);
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      setDetailsLoadingId(null);
    }
  };

  const setCurrentSelection = useCallback(
    (next: NativeScheduledUploadSelection | null) => {
      const previous = selectionRef.current;
      if (next && previous) {
        const combined = mergeSelections(previous, next);
        selectionRef.current = combined;
        setSelection(combined);
      } else {
        if (previous && previous !== next) previous.release();
        selectionRef.current = next;
        setSelection(next);
      }
    },
    [],
  );

  const addSelection = useCallback(
    async (pick: () => Promise<NativeScheduledUploadSelection | null>) => {
      setPickerError(null);
      setActionError(null);
      try {
        const picked = await pick();
        if (picked) setCurrentSelection(picked);
      } catch (cause) {
        setPickerError(errorMessage(cause));
      }
    },
    [setCurrentSelection],
  );

  const clearSelection = useCallback(() => {
    selectionRef.current?.release();
    selectionRef.current = null;
    setSelection(null);
    setStagingPath(null);
    setStagingScheduleId(null);
    stagingRef.current = null;
  }, []);

  const loadFileBlob = useCallback(
    async (entry: NativeScheduledUploadEntry) => {
      if (!entry.file)
        throw new Error(`Could not open ${entry.path}. Select it again.`);
      return entry.file.body ?? readFileAsBlob(entry.file);
    },
    [],
  );

  const stageAndSchedule = useCallback(async () => {
    if (!api) return;
    if (!selection || selection.entries.length === 0) {
      setActionError(copy.noSelection);
      return;
    }
    if (!destinationId) {
      setActionError(copy.noDestination);
      return;
    }

    setWorking(true);
    setActionError(null);
    setNotice(null);
    try {
      const scheduleTime = resolveScheduledUploadTime(date, time, timeZone);
      let active = stagingRef.current;

      if (active) {
        const refreshed = await refreshActiveStagingSession({
          api,
          active,
          copy,
          clearSelection,
          setNewUploadOpen,
          setScheduleDetails,
          setDashboard,
          refresh,
          setNotice,
        });
        if (!refreshed) return;
        active = refreshed;
      }

      if (!active) {
        active = await createNewSchedule(
          api,
          { destinationId, ...scheduleTime, items: [] },
          selection,
          copy,
          setStagingScheduleId,
        );
        stagingRef.current = active;
      }

      const files = fileEntries(selection.entries);
      if (!active) throw new Error(copy.waitingForServer);

      await stageFiles(
        api,
        active,
        files,
        loadFileBlob,
        copy,
        setStagingPath,
        setNotice,
      );

      await commitSchedule({
        api,
        activeSchedule: active,
        copy,
        clearSelection,
        setNewUploadOpen,
        setScheduleDetails,
        setDashboard,
        refresh,
        setNotice,
        setStagingScheduleId,
        stagingRef,
      });
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      setWorking(false);
      setStagingPath(null);
    }
  }, [
    api,
    clearSelection,
    copy.noDestination,
    copy.noSelection,
    copy.stageProgress,
    copy.waiting,
    copy.waitingForServer,
    date,
    destinationId,
    loadFileBlob,
    refresh,
    selection,
    setStagingScheduleId,
    stagingRef,
    time,
    timeZone,
  ]);

  const runMutation = useCallback(
    async (action: () => Promise<unknown>) => {
      setWorking(true);
      setActionError(null);
      setNotice(null);
      try {
        await action();
        refresh();
      } catch (cause) {
        setActionError(errorMessage(cause));
      } finally {
        setWorking(false);
      }
    },
    [refresh],
  );

  const saveReschedule = useCallback(
    (scheduleId: string) => {
      if (!api) return;
      void runMutation(async () => {
        const nextTime: UpdateScheduledUploadTimeRequest =
          resolveScheduledUploadTime(date, time, timeZone);
        await api.updateTime(scheduleId, nextTime);
        setReschedulingId(null);
      });
    },
    [api, date, runMutation, time, timeZone],
  );

  const body = (content: ReactNode) => (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.background }]}
    >
      <ScrollView
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.topRow}>
          <Pressable accessibilityRole="button" onPress={() => router.back()}>
            <Text style={[styles.link, { color: colors.accent }]}>
              {copy.back}
            </Text>
          </Pressable>
          <Text style={[styles.pageTitle, { color: colors.foreground }]}>
            {copy.title}
          </Text>
          {canManage
            ? button(copy.refresh, refresh, colors, listLoading || working)
            : null}
        </View>
        {content}
      </ScrollView>
    </SafeAreaView>
  );

  if (bootstrapLoading) {
    return body(
      <View style={styles.centerState}>
        <ActivityIndicator color={colors.accent} />
        <Text style={[styles.muted, { color: colors.muted }]}>
          {copy.loading}
        </Text>
      </View>,
    );
  }

  if (bootstrapError) {
    return body(
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text
          accessibilityRole="alert"
          style={[styles.error, { color: colors.danger }]}
        >
          {bootstrapError}
        </Text>
        {onRetrySession ? button(copy.retry, onRetrySession, colors) : null}
      </View>,
    );
  }

  if (!canManage) {
    return body(
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={[styles.bodyText, { color: colors.foreground }]}>
          {copy.access}
        </Text>
      </View>,
    );
  }

  if (listLoading && dashboard === null) {
    return body(
      <View style={styles.centerState}>
        <ActivityIndicator color={colors.accent} />
        <Text style={[styles.muted, { color: colors.muted }]}>
          {copy.loading}
        </Text>
      </View>,
    );
  }

  if (listError) {
    return body(
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text
          accessibilityRole="alert"
          style={[styles.error, { color: colors.danger }]}
        >
          {listError}
        </Text>
        {button(copy.retry, refresh, colors, listLoading)}
      </View>,
    );
  }

  const schedules = dashboard?.schedules ?? [];
  const adminAlerts = dashboard?.adminAlerts ?? [];
  const stageButtonLabel = stagingScheduleId ? copy.resume : copy.stage;

  return body(
    <>
      {actionError ? (
        <Text
          accessibilityRole="alert"
          style={[styles.error, { color: colors.danger }]}
        >
          {actionError}
        </Text>
      ) : null}
      {pickerError ? (
        <Text
          accessibilityRole="alert"
          style={[styles.error, { color: colors.danger }]}
        >
          {pickerError}
        </Text>
      ) : null}
      {notice ? (
        <Text style={[styles.notice, { color: colors.accent }]}>{notice}</Text>
      ) : null}

      {!newUploadOpen
        ? button(copy.create, () => setNewUploadOpen(true), colors)
        : null}

      {newUploadOpen ? (
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            {copy.createTitle}
          </Text>
          <Text style={[styles.fieldLabel, { color: colors.muted }]}>
            {copy.destination}
          </Text>
          {drives.length === 0 ? (
            <Text style={[styles.muted, { color: colors.muted }]}>
              {copy.destinationMissing}
            </Text>
          ) : (
            <View style={styles.wrapRow}>
              {drives.map((drive) =>
                button(
                  drive.name,
                  () => setDestinationId(drive.rootFolderId),
                  colors,
                  Boolean(drive.isProtected),
                  destinationId === drive.rootFolderId,
                ),
              )}
            </View>
          )}
          <Text style={[styles.fieldLabel, { color: colors.muted }]}>
            {copy.date}
          </Text>
          <TextInput
            accessibilityLabel={copy.date}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.muted}
            style={[
              styles.input,
              { color: colors.foreground, borderColor: colors.border },
            ]}
            value={date}
          />
          <Text style={[styles.fieldLabel, { color: colors.muted }]}>
            {copy.time}
          </Text>
          <TextInput
            accessibilityLabel={copy.time}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setTime}
            placeholder="HH:mm"
            placeholderTextColor={colors.muted}
            style={[
              styles.input,
              { color: colors.foreground, borderColor: colors.border },
            ]}
            value={time}
          />
          <Text style={[styles.muted, { color: colors.muted }]}>
            {timeZone}
          </Text>
          <View style={styles.wrapRow}>
            {button(
              copy.files,
              () => void addSelection(picker.pickFiles),
              colors,
              working || Boolean(stagingScheduleId),
            )}
            {button(
              copy.folder,
              () => void addSelection(picker.pickDirectory),
              colors,
              working || Boolean(stagingScheduleId),
            )}
            {selection
              ? button(
                  copy.cancelSelection,
                  clearSelection,
                  colors,
                  working || Boolean(stagingScheduleId),
                )
              : null}
          </View>
          {selection ? (
            <View style={styles.selectionList}>
              {selection.entries.map((entry) => {
                const kindLabel = entry.kind === "folder" ? copy.folderItem : copy.file;
                return (
                  <View key={entry.path} style={styles.fileRow}>
                    <Text style={[styles.bodyText, { color: colors.foreground }]}>
                      {entry.path}
                    </Text>
                    <Text style={[styles.muted, { color: colors.muted }]}>
                      {kindLabel} ·{" "}
                      {entry.size} {copy.bytes}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}
          <Text style={[styles.muted, { color: colors.muted }]}>
            {copy.keepOpen}
          </Text>
          {stagingPath ? (
            <Text style={[styles.notice, { color: colors.accent }]}>
              {copy.stageProgress}: {stagingPath}
            </Text>
          ) : null}
          {button(
            stageButtonLabel,
            () => void stageAndSchedule(),
            colors,
            working || !selection || !destinationId,
          )}
        </View>
      ) : null}

      {isAdmin
        ? adminAlerts.map((alert) => (
            <AdminAlertCard
              key={alert.id}
              alert={alert}
              colors={colors}
              copy={copy}
              disabled={working}
              onAcknowledge={() =>
                api &&
                void runMutation(() =>
                  api.acknowledgeAdminAlert(alert.id, "ACKNOWLEDGED"),
                )
              }
              onResolve={() =>
                api &&
                void runMutation(() =>
                  api.acknowledgeAdminAlert(alert.id, "RESOLVED"),
                )
              }
            />
          ))
        : null}

      {schedules.length === 0 && adminAlerts.length === 0 ? (
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.bodyText, { color: colors.foreground }]}>
            {isAdmin ? copy.adminEmpty : copy.noSchedules}
          </Text>
        </View>
      ) : null}

      {schedules.map((schedule) => (
        <ScheduleCard
          key={schedule.id}
          api={api}
          schedule={schedule}
          details={scheduleDetails[schedule.id]}
          detailsExpanded={expandedScheduleId === schedule.id}
          detailsLoading={detailsLoadingId === schedule.id}
          onToggleDetails={() => void toggleScheduleDetails(schedule.id)}
          role={role}
          colors={colors}
          copy={copy}
          date={date}
          time={time}
          working={working}
          rescheduling={reschedulingId === schedule.id}
          onReschedule={() => {
            setReschedulingId(schedule.id);
            const fields = scheduleFields(schedule.scheduledLocalTime);
            setDate(fields.date);
            setTime(fields.time);
          }}
          onSaveReschedule={() => saveReschedule(schedule.id)}
          onCancelReschedule={() => setReschedulingId(null)}
          onDateChange={setDate}
          onTimeChange={setTime}
          onMutation={runMutation}
          onAdminCancel={() =>
            api && void runMutation(() => api.cancelAsAdmin(schedule.id))
          }
          locale={locale}
        />
      ))}
      {dashboard?.nextCursor
        ? button(
            listLoading ? copy.loadingOlder : copy.loadOlder,
            () => void loadOlderSchedules(),
            colors,
            listLoading || working,
          )
        : null}
    </>,
  );
}

function AdminAlertCard({
  alert,
  colors,
  copy,
  disabled,
  onAcknowledge,
  onResolve,
}: Readonly<{
  alert: ScheduledUploadAdminAlert;
  colors: {
    accent: string;
    border: string;
    card: string;
    foreground: string;
    muted: string;
    danger: string;
  };
  copy: Record<string, string>;
  disabled: boolean;
  onAcknowledge: () => void;
  onResolve: () => void;
}>) {
  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
        {alert.reasonCode}
      </Text>
      <Text style={[styles.muted, { color: colors.muted }]}>
        {alert.schedule.creatorEmail} · {alert.schedule.status} ·{" "}
        {alert.schedule.scheduledAt}
      </Text>
      {button(copy.acknowledge, onAcknowledge, colors, disabled)}
      {button(copy.resolve, onResolve, colors, disabled)}
    </View>
  );
}

function ScheduleCard({
  api,
  schedule,
  details,
  detailsExpanded,
  detailsLoading,
  onToggleDetails,
  role,
  colors,
  copy,
  date,
  time,
  working,
  rescheduling,
  onReschedule,
  onSaveReschedule,
  onCancelReschedule,
  onDateChange,
  onTimeChange,
  onMutation,
  onAdminCancel,
  locale,
}: Readonly<{
  api: ScheduledUploadApi | null;
  schedule: ScheduledUploadSummary;
  details?: ScheduledUpload;
  detailsExpanded: boolean;
  detailsLoading: boolean;
  onToggleDetails: () => void;
  role: string;
  colors: {
    accent: string;
    border: string;
    card: string;
    foreground: string;
    muted: string;
    danger: string;
  };
  copy: Record<string, string>;
  date: string;
  time: string;
  working: boolean;
  rescheduling: boolean;
  onReschedule: () => void;
  onSaveReschedule: () => void;
  onCancelReschedule: () => void;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
  onMutation: (action: () => Promise<unknown>) => Promise<void>;
  onAdminCancel: () => void;
  locale: Locale;
}>) {
  const isAdmin = role.toUpperCase() === "ADMIN";
  const statusLabel =
    COPY[locale][statusLabels[schedule.status]] ?? schedule.status;
  const beforeFirstWrite = !schedule.firstWriteAt;
  const ownerActions = !isAdmin && role.toUpperCase() === "EDITOR";
  const canUpdateBeforeRelease =
    ownerActions &&
    beforeFirstWrite &&
    (schedule.status === ScheduledUploadStatus.STAGING ||
      schedule.status === ScheduledUploadStatus.WAITING ||
      schedule.status === ScheduledUploadStatus.NEEDS_ATTENTION);
  const canRetry =
    ownerActions &&
    (schedule.status === ScheduledUploadStatus.PARTIAL ||
      schedule.status === ScheduledUploadStatus.NEEDS_ATTENTION);
  const canAdminCancel =
    isAdmin &&
    beforeFirstWrite &&
    schedule.status !== ScheduledUploadStatus.CANCELED &&
    schedule.status !== ScheduledUploadStatus.ABANDONED;
  let detailsButtonLabel = copy.showItems;
  if (detailsLoading) detailsButtonLabel = copy.loadingItems;
  else if (detailsExpanded) detailsButtonLabel = copy.hideItems;

  const isStaging = schedule.status === ScheduledUploadStatus.STAGING;
  const transferredBytes = isStaging ? schedule.stagedBytes : schedule.uploadedBytes;
  const transferredLabel = isStaging ? copy.staged : copy.uploaded;

  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      <View style={styles.statusRow}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          {statusLabel}
        </Text>
        <Text style={[styles.muted, { color: colors.muted }]}>
          {schedule.scheduledLocalTime} · {schedule.timeZone}
        </Text>
      </View>
      {isAdmin ? (
        <Text style={[styles.muted, { color: colors.muted }]}>
          {copy.owner}: {schedule.creatorEmail}
        </Text>
      ) : null}
      <Text style={[styles.muted, { color: colors.muted }]}>
        {parseByteCount(transferredBytes)} /{" "}
        {parseByteCount(schedule.totalBytes)} {copy.bytes} {transferredLabel}
      </Text>
      {schedule.lastErrorMessage ? (
        <Text style={[styles.error, { color: colors.danger }]}>
          {schedule.lastErrorMessage}
        </Text>
      ) : null}
      {button(
        detailsButtonLabel,
        onToggleDetails,
        colors,
        working || detailsLoading,
      )}
      {detailsExpanded && details
        ? details.items.map((item) => (
            <View key={item.id} style={styles.fileRow}>
              <Text style={[styles.bodyText, { color: colors.foreground }]}>
                {item.path}
              </Text>
              <Text style={[styles.muted, { color: colors.muted }]}>
                {item.status} · {parseByteCount(item.uploadedBytes)} /{" "}
                {parseByteCount(item.size)} {copy.bytes}
              </Text>
            </View>
          ))
        : null}
      {rescheduling ? (
        <View style={styles.rescheduleBox}>
          <TextInput
            accessibilityLabel={copy.date}
            onChangeText={onDateChange}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.muted}
            style={[
              styles.input,
              { color: colors.foreground, borderColor: colors.border },
            ]}
            value={date}
          />
          <TextInput
            accessibilityLabel={copy.time}
            onChangeText={onTimeChange}
            placeholder="HH:mm"
            placeholderTextColor={colors.muted}
            style={[
              styles.input,
              { color: colors.foreground, borderColor: colors.border },
            ]}
            value={time}
          />
          {button(copy.saveTime, onSaveReschedule, colors, working)}
          {button(copy.cancelSelection, onCancelReschedule, colors, working)}
        </View>
      ) : null}
      {canUpdateBeforeRelease && !rescheduling
        ? button(copy.reschedule, onReschedule, colors, working)
        : null}
      {canUpdateBeforeRelease
        ? button(
            copy.cancel,
            () => api && void onMutation(() => api.cancel(schedule.id)),
            colors,
            working,
          )
        : null}
      {canRetry
        ? button(
            copy.retryItems,
            () => api && void onMutation(() => api.retry(schedule.id)),
            colors,
            working,
          )
        : null}
      {canRetry
        ? button(
            copy.abandon,
            () => api && void onMutation(() => api.abandon(schedule.id)),
            colors,
            working,
          )
        : null}
      {canAdminCancel
        ? button(copy.adminCancel, onAdminCancel, colors, working)
        : null}
    </View>
  );
}

export default function ScheduledUploadsRoute() {
  const router = useRouter();
  const { locale, theme } = useMobilePreferences();
  const [session, setSession] = useState<ActiveMobileRouteSession | null>(null);
  const [drives, setDrives] = useState<ScheduledUploadDrive[]>([]);
  const [role, setRole] = useState("USER");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const loadSession = useCallback(async () => {
    const currentGeneration = ++generation.current;
    const isActive = () => generation.current === currentGeneration;
    setLoading(true);
    setError(null);
    try {
      const activeSession = await loadActiveRouteSession({
        isActive,
        redirectToServer: () => router.replace("/"),
        setError: (message) => {
          if (isActive()) setError(message);
        },
      });
      if (!isActive()) return;
      if (!activeSession) {
        setLoading(false);
        return;
      }

      const response = await listMobileDrives(activeSession.fetchImpl);
      if (!isActive()) return;
      setSession(activeSession);
      setRole(activeSession.role);
      setDrives(
        response.drives
          .filter((drive) => !drive.isProtected)
          .map((drive) => ({
            id: drive.id,
            name: drive.name,
            rootFolderId: drive.id,
            isProtected: drive.isProtected,
          })),
      );
    } catch (cause) {
      if (isActive()) setError(errorMessage(cause));
    } finally {
      if (isActive()) setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadSession();
    return () => {
      generation.current += 1;
    };
  }, [loadSession]);

  const api = useMemo(
    () => (session ? createScheduledUploadApi(session.fetchImpl) : null),
    [session],
  );

  return (
    <ScheduledUploadsScreen
      api={api}
      role={role}
      drives={drives}
      locale={locale === "zh" ? "zh" : "en"}
      theme={theme}
      bootstrapLoading={loading}
      bootstrapError={error}
      onRetrySession={() => void loadSession()}
    />
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  page: { padding: 18, gap: 12, paddingBottom: 36 },
  topRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  pageTitle: { flex: 1, fontSize: 20, fontWeight: "700" },
  link: { fontSize: 16, fontWeight: "600" },
  card: { borderRadius: 14, padding: 16, gap: 12, backgroundColor: "#FFFFFF" },
  centerState: {
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
  },
  sectionTitle: { fontSize: 17, fontWeight: "700" },
  fieldLabel: { fontSize: 13, fontWeight: "600", marginTop: 4 },
  bodyText: { fontSize: 15, lineHeight: 21 },
  muted: { fontSize: 13, lineHeight: 19 },
  notice: { fontSize: 14, fontWeight: "600" },
  error: { fontSize: 14, lineHeight: 20 },
  button: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  buttonText: { fontSize: 14, fontWeight: "600" },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
  wrapRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  selectionList: { gap: 8, marginVertical: 4 },
  fileRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#D5E0E4",
    paddingTop: 8,
    gap: 2,
  },
  rescheduleBox: { gap: 8 },
  statusRow: { gap: 3 },
});
