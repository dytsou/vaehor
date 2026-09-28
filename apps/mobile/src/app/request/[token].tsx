import * as DocumentPicker from "expo-document-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  createPublicServerFetch,
  type ServerFetch,
} from "../../lib/api-client";
import { formatMobileFileSize } from "../../lib/mobile-formatters";
import { mobileThemeColors } from "../../lib/mobile-theme";
import { useMobilePreferences } from "../../lib/mobile-preferences";
import {
  deletePickedCacheFile,
  openDocumentPickerUploadFile,
} from "../../lib/native-upload-file";
import {
  FileRequestApiError,
  getPublicFileRequest,
  type PublicFileRequest,
} from "../../lib/request-api";
import { getActiveServer, preferencesStore } from "../../lib/servers";
import {
  runNativeFileRequestUpload,
  UploadHttpError,
} from "../../lib/upload-bridge";

type PickedRequestFile = {
  id: string;
  asset: DocumentPicker.DocumentPickerAsset;
};

async function pickRequestedFiles(options: {
  setPicking: (picking: boolean) => void;
  setError: (error: string | null) => void;
  addFiles: (files: PickedRequestFile[]) => void;
  setSuccess: (success: boolean) => void;
}): Promise<void> {
  options.setPicking(true);
  options.setError(null);
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.length) return;
    options.addFiles(
      result.assets.map((asset, index) => ({
        id: `${Date.now()}-${index}-${asset.name}`,
        asset,
      })),
    );
    options.setSuccess(false);
  } catch {
    options.setError(
      "The file picker could not open. Check the device's file access and retry.",
    );
  } finally {
    options.setPicking(false);
  }
}

function removeRequestedFile(options: {
  id: string;
  files: PickedRequestFile[];
  setFiles: (
    update: (files: PickedRequestFile[]) => PickedRequestFile[],
  ) => void;
  setCompletedIds: (update: (ids: Set<string>) => Set<string>) => void;
  setProgress: (
    update: (progress: Record<string, number>) => Record<string, number>,
  ) => void;
}): void {
  const file = options.files.find((item) => item.id === options.id);
  if (file) deletePickedCacheFile(file.asset.uri);
  options.setFiles((current) =>
    current.filter((item) => item.id !== options.id),
  );
  options.setCompletedIds((current) => {
    const next = new Set(current);
    next.delete(options.id);
    return next;
  });
  options.setProgress((current) => {
    const next = { ...current };
    delete next[options.id];
    return next;
  });
}

const CHUNK_UPLOAD_ERROR =
  "The server could not finish this upload. Check the link and connection, then retry.";

function requestLoadErrorMessage(cause: unknown): string {
  if (
    cause instanceof FileRequestApiError &&
    (cause.status === 404 || cause.status === 410)
  ) {
    return "This upload link is invalid, expired, or no longer active.";
  }
  return cause instanceof Error
    ? cause.message
    : "Could not load this upload request.";
}

function beginPublicRequestLoad(options: {
  token: string;
  originParam: string;
  controllerRef: { current: AbortController | null };
  fetchRef: { current: ServerFetch | null };
  setServerOrigin: (origin: string) => void;
  setRequestInfo: (info: PublicFileRequest) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string) => void;
}): () => void {
  let active = true;
  void (async () => {
    try {
      if (!options.token) throw new Error("This upload link is invalid.");
      const selected = options.originParam
        ? null
        : await getActiveServer(preferencesStore);
      const origin = options.originParam || selected?.url;
      if (!origin) {
        throw new Error("Open this link in Vaehor or choose a server first.");
      }
      const fetchImpl = createPublicServerFetch(origin);
      const info = await getPublicFileRequest(fetchImpl, options.token);
      if (!active) return;
      options.fetchRef.current = fetchImpl;
      options.setServerOrigin(new URL(origin).origin);
      options.setRequestInfo(info);
    } catch (cause) {
      if (active) options.setError(requestLoadErrorMessage(cause));
    } finally {
      if (active) options.setLoading(false);
    }
  })();
  return () => {
    active = false;
    options.controllerRef.current?.abort();
  };
}

function getRequestUploadFailure(cause: unknown): {
  message: string;
  stop: boolean;
} {
  if (
    cause instanceof UploadHttpError &&
    (cause.status === 403 || cause.status === 404 || cause.status === 410)
  ) {
    return {
      message:
        "This upload request has expired, been revoked, or cannot accept files.",
      stop: true,
    };
  }
  return {
    message: cause instanceof Error ? cause.message : CHUNK_UPLOAD_ERROR,
    stop: false,
  };
}

async function uploadPickedRequestFile(options: {
  fetchImpl: ServerFetch;
  token: string;
  picked: PickedRequestFile;
  signal: AbortSignal;
  onProgress: (percent: number) => void;
}): Promise<void> {
  await runNativeFileRequestUpload({
    fetchImpl: options.fetchImpl,
    file: openDocumentPickerUploadFile(options.picked.asset),
    token: options.token,
    signal: options.signal,
    onProgress: options.onProgress,
  });
  deletePickedCacheFile(options.picked.asset.uri);
}

type UploadPendingRequestFilesOptions = Readonly<{
  fetchImpl: ServerFetch;
  token: string;
  files: PickedRequestFile[];
  completedIds: Set<string>;
  signal: AbortSignal;
  setCompletedIds: (ids: Set<string>) => void;
  setProgress: (id: string, percent: number) => void;
  setError: (error: string) => void;
}>;

async function uploadPendingRequestFile(
  options: UploadPendingRequestFilesOptions,
  picked: PickedRequestFile,
  done: Set<string>,
): Promise<boolean> {
  if (done.has(picked.id)) return false;
  if (options.signal.aborted) return true;
  try {
    await uploadPickedRequestFile({
      fetchImpl: options.fetchImpl,
      token: options.token,
      picked,
      signal: options.signal,
      onProgress: (percent) => options.setProgress(picked.id, percent),
    });
    done.add(picked.id);
    options.setCompletedIds(new Set(done));
    return false;
  } catch (cause) {
    if (options.signal.aborted) return true;
    const failure = getRequestUploadFailure(cause);
    options.setError(failure.message);
    return failure.stop;
  }
}

async function uploadPendingRequestFiles(
  options: UploadPendingRequestFilesOptions,
): Promise<Set<string>> {
  const done = new Set(options.completedIds);
  for (const picked of options.files) {
    const shouldStop = await uploadPendingRequestFile(options, picked, done);
    if (shouldStop) break;
  }
  return done;
}

function pickedFileProgressLabel(
  complete: boolean,
  percent: number | undefined,
): string {
  if (complete) return " · Uploaded";
  if (percent !== undefined) return ` · ${percent}%`;
  return "";
}

function requestUploadButtonLabel(
  uploading: boolean,
  completedCount: number,
): string {
  if (uploading) return "Uploading…";
  if (completedCount > 0) return "Retry remaining files";
  return "Start upload";
}

type RequestColors = ReturnType<typeof mobileThemeColors>;

function RequestUploadContent(
  props: Readonly<{
    colors: RequestColors;
    loading: boolean;
    error: string | null;
    requestInfo: PublicFileRequest | null;
    picking: boolean;
    uploading: boolean;
    onPickFiles: () => Promise<void>;
    files: PickedRequestFile[];
    completedIds: Set<string>;
    progress: Record<string, number>;
    onRemoveFile: (id: string) => void;
    onStartUpload: () => Promise<void>;
    onCancelUpload: () => void;
    success: boolean;
  }>,
) {
  return (
    <>
      {props.loading ? (
        <ActivityIndicator color="#1f6f78" size="large" />
      ) : null}
      {props.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {props.error}
        </Text>
      ) : null}
      {!props.loading && props.requestInfo ? (
        <>
          <View
            style={[
              styles.card,
              {
                backgroundColor: props.colors.surface,
                borderColor: props.colors.border,
              },
            ]}
          >
            <Text
              style={[styles.sectionTitle, { color: props.colors.foreground }]}
            >
              Send files to {props.requestInfo.folderName}
            </Text>
            <Text style={[styles.cardText, { color: props.colors.muted }]}>
              Anyone with this link can upload files to this folder until{" "}
              {new Date(props.requestInfo.expiresAt).toLocaleString()}.
            </Text>
            <Pressable
              accessibilityRole="button"
              style={[
                styles.primaryButton,
                (props.picking || props.uploading) && styles.disabled,
              ]}
              disabled={props.picking || props.uploading}
              onPress={() => void props.onPickFiles()}
            >
              <Text style={styles.primaryButtonText}>
                {props.picking ? "Opening files…" : "Choose files from device"}
              </Text>
            </Pressable>
          </View>

          {props.files.map((picked) => {
            const complete = props.completedIds.has(picked.id);
            const percent = props.progress[picked.id];
            return (
              <View
                key={picked.id}
                style={[
                  styles.fileCard,
                  {
                    backgroundColor: props.colors.surface,
                    borderColor: props.colors.border,
                  },
                ]}
              >
                <View style={styles.fileInfo}>
                  <Text
                    style={[
                      styles.fileName,
                      { color: props.colors.foreground },
                    ]}
                    numberOfLines={1}
                  >
                    {picked.asset.name}
                  </Text>
                  <Text
                    style={[styles.cardText, { color: props.colors.muted }]}
                  >
                    {formatSize(picked.asset.size)}
                    {pickedFileProgressLabel(complete, percent)}
                  </Text>
                  {percent !== undefined && !complete ? (
                    <View
                      style={[
                        styles.progressTrack,
                        { backgroundColor: props.colors.border },
                      ]}
                    >
                      <View
                        style={[styles.progressFill, { width: `${percent}%` }]}
                      />
                    </View>
                  ) : null}
                </View>
                {!props.uploading ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => props.onRemoveFile(picked.id)}
                  >
                    <Text style={styles.removeText}>Remove</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}

          {props.files.length > 0 ? (
            <View style={styles.choiceRow}>
              <Pressable
                accessibilityRole="button"
                style={[
                  styles.primaryButton,
                  styles.flexButton,
                  props.uploading && styles.disabled,
                ]}
                disabled={props.uploading}
                onPress={() => void props.onStartUpload()}
              >
                <Text style={styles.primaryButtonText}>
                  {requestUploadButtonLabel(
                    props.uploading,
                    props.completedIds.size,
                  )}
                </Text>
              </Pressable>
              {props.uploading ? (
                <Pressable
                  accessibilityRole="button"
                  style={styles.secondaryButton}
                  onPress={props.onCancelUpload}
                >
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {props.success ? (
            <Text style={styles.success}>
              Upload complete. The files have been sent.
            </Text>
          ) : null}
        </>
      ) : null}
    </>
  );
}

export default function PublicFileRequestRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    token?: string;
    serverOrigin?: string;
  }>();
  const { theme } = useMobilePreferences();
  const colors = useMemo(() => mobileThemeColors(theme === "dark"), [theme]);
  const fetchRef = useRef<ServerFetch | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const [requestInfo, setRequestInfo] = useState<PublicFileRequest | null>(
    null,
  );
  const [serverOrigin, setServerOrigin] = useState("");
  const [files, setFiles] = useState<PickedRequestFile[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [completedIds, setCompletedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const token = typeof params.token === "string" ? params.token : "";
  const originParam =
    typeof params.serverOrigin === "string" ? params.serverOrigin : "";

  useEffect(
    () =>
      beginPublicRequestLoad({
        token,
        originParam,
        controllerRef,
        fetchRef,
        setServerOrigin,
        setRequestInfo,
        setLoading,
        setError,
      }),
    [originParam, token],
  );

  const pickFiles = () =>
    pickRequestedFiles({
      setPicking,
      setError,
      addFiles: (added) => setFiles((current) => [...current, ...added]),
      setSuccess,
    });

  const removePickedFile = (id: string) =>
    removeRequestedFile({
      id,
      files,
      setFiles,
      setCompletedIds,
      setProgress,
    });

  const startUpload = async () => {
    const fetchImpl = fetchRef.current;
    if (!fetchImpl || !requestInfo || !files.length) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setUploading(true);
    setError(null);
    setSuccess(false);
    try {
      const done = await uploadPendingRequestFiles({
        fetchImpl,
        token,
        files,
        completedIds,
        signal: controller.signal,
        setCompletedIds,
        setProgress: (id, percent) =>
          setProgress((current) => ({ ...current, [id]: percent })),
        setError,
      });
      if (
        !controller.signal.aborted &&
        files.every((file) => done.has(file.id))
      ) {
        setFiles([]);
        setCompletedIds(new Set());
        setProgress({});
        setSuccess(true);
      }
    } finally {
      controllerRef.current = null;
      setUploading(false);
    }
  };

  const cancelUpload = () => controllerRef.current?.abort();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.canGoBack() ? router.back() : router.replace("/")
            }
          >
            <Text style={styles.action}>‹ Back</Text>
          </Pressable>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {requestInfo?.title ?? "Upload files"}
            </Text>
            {serverOrigin ? (
              <Text style={[styles.subtitle, { color: colors.muted }]}>
                {serverOrigin}
              </Text>
            ) : null}
          </View>
        </View>

        <RequestUploadContent
          colors={colors}
          loading={loading}
          error={error}
          requestInfo={requestInfo}
          picking={picking}
          uploading={uploading}
          onPickFiles={pickFiles}
          files={files}
          completedIds={completedIds}
          progress={progress}
          onRemoveFile={removePickedFile}
          onStartUpload={startUpload}
          onCancelUpload={cancelUpload}
          success={success}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function formatSize(size?: number) {
  if (!Number.isFinite(size) || size === undefined || size < 0)
    return "Size unavailable";
  return formatMobileFileSize(size);
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 18, paddingBottom: 40, gap: 14 },
  header: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerText: { flex: 1 },
  title: { fontSize: 21, fontWeight: "700" },
  subtitle: { fontSize: 12, marginTop: 3 },
  action: { color: "#1f6f78", fontWeight: "600" },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 11 },
  sectionTitle: { fontSize: 17, fontWeight: "700" },
  cardText: { fontSize: 13, lineHeight: 19 },
  primaryButton: {
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#1f6f78",
    paddingHorizontal: 16,
  },
  primaryButtonText: { color: "#ffffff", fontWeight: "700" },
  secondaryButton: {
    minHeight: 46,
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  secondaryButtonText: { color: "#1f6f78", fontWeight: "600" },
  disabled: { opacity: 0.5 },
  choiceRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  flexButton: { flex: 1 },
  fileCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  fileInfo: { flex: 1, gap: 4 },
  fileName: { fontSize: 14, fontWeight: "600" },
  removeText: { color: "#b42318", fontSize: 13, fontWeight: "600" },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
    marginTop: 3,
  },
  progressFill: { height: 4, backgroundColor: "#1f6f78" },
  error: { color: "#b42318", fontSize: 13 },
  success: {
    color: "#166534",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
});
