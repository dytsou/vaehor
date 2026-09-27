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

const CHUNK_UPLOAD_ERROR =
  "The server could not finish this upload. Check the link and connection, then retry.";

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

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (!token) throw new Error("This upload link is invalid.");
        const selected = originParam
          ? null
          : await getActiveServer(preferencesStore);
        const origin = originParam || selected?.url;
        if (!origin)
          throw new Error("Open this link in Vaehor or choose a server first.");
        const fetchImpl = createPublicServerFetch(origin);
        const info = await getPublicFileRequest(fetchImpl, token);
        if (!active) return;
        fetchRef.current = fetchImpl;
        setServerOrigin(new URL(origin).origin);
        setRequestInfo(info);
      } catch (cause) {
        if (!active) return;
        if (
          cause instanceof FileRequestApiError &&
          (cause.status === 404 || cause.status === 410)
        ) {
          setError(
            "This upload link is invalid, expired, or no longer active.",
          );
        } else {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load this upload request.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      controllerRef.current?.abort();
    };
  }, [originParam, token]);

  const pickFiles = async () => {
    setPicking(true);
    setError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const added = result.assets.map((asset, index) => ({
        id: `${Date.now()}-${index}-${asset.name}`,
        asset,
      }));
      setFiles((current) => [...current, ...added]);
      setSuccess(false);
    } catch {
      setError(
        "The file picker could not open. Check the device's file access and retry.",
      );
    } finally {
      setPicking(false);
    }
  };

  const removePickedFile = (id: string) => {
    const file = files.find((item) => item.id === id);
    if (file) deletePickedCacheFile(file.asset.uri);
    setFiles((current) => current.filter((item) => item.id !== id));
    setCompletedIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setProgress((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const startUpload = async () => {
    const fetchImpl = fetchRef.current;
    if (!fetchImpl || !requestInfo || !files.length) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setUploading(true);
    setError(null);
    setSuccess(false);
    const done = new Set(completedIds);

    for (const picked of files) {
      if (done.has(picked.id)) continue;
      if (controller.signal.aborted) break;
      try {
        const nativeFile = openDocumentPickerUploadFile(picked.asset);
        await runNativeFileRequestUpload({
          fetchImpl,
          file: nativeFile,
          token,
          signal: controller.signal,
          onProgress: (percent) =>
            setProgress((current) => ({ ...current, [picked.id]: percent })),
        });
        done.add(picked.id);
        setCompletedIds(new Set(done));
        deletePickedCacheFile(picked.asset.uri);
      } catch (cause) {
        if (controller.signal.aborted) break;
        if (
          cause instanceof UploadHttpError &&
          (cause.status === 403 || cause.status === 404 || cause.status === 410)
        ) {
          setError(
            "This upload request has expired, been revoked, or cannot accept files.",
          );
          break;
        } else {
          setError(cause instanceof Error ? cause.message : CHUNK_UPLOAD_ERROR);
        }
      }
    }

    controllerRef.current = null;
    setUploading(false);
    if (
      !controller.signal.aborted &&
      files.every((file) => done.has(file.id))
    ) {
      setFiles([]);
      setCompletedIds(new Set());
      setProgress({});
      setSuccess(true);
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

        {loading ? <ActivityIndicator color="#1f6f78" size="large" /> : null}
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        {!loading && requestInfo ? (
          <>
            <View
              style={[
                styles.card,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Send files to {requestInfo.folderName}
              </Text>
              <Text style={[styles.cardText, { color: colors.muted }]}>
                Anyone with this link can upload files to this folder until{" "}
                {new Date(requestInfo.expiresAt).toLocaleString()}.
              </Text>
              <Pressable
                accessibilityRole="button"
                style={[
                  styles.primaryButton,
                  (picking || uploading) && styles.disabled,
                ]}
                disabled={picking || uploading}
                onPress={() => void pickFiles()}
              >
                <Text style={styles.primaryButtonText}>
                  {picking ? "Opening files…" : "Choose files from device"}
                </Text>
              </Pressable>
            </View>

            {files.map((picked) => {
              const complete = completedIds.has(picked.id);
              const percent = progress[picked.id];
              return (
                <View
                  key={picked.id}
                  style={[
                    styles.fileCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <View style={styles.fileInfo}>
                    <Text
                      style={[styles.fileName, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
                      {picked.asset.name}
                    </Text>
                    <Text style={[styles.cardText, { color: colors.muted }]}>
                      {formatSize(picked.asset.size)}
                      {complete
                        ? " · Uploaded"
                        : percent !== undefined
                          ? ` · ${percent}%`
                          : ""}
                    </Text>
                    {percent !== undefined && !complete ? (
                      <View
                        style={[
                          styles.progressTrack,
                          { backgroundColor: colors.border },
                        ]}
                      >
                        <View
                          style={[
                            styles.progressFill,
                            { width: `${percent}%` },
                          ]}
                        />
                      </View>
                    ) : null}
                  </View>
                  {!uploading ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => removePickedFile(picked.id)}
                    >
                      <Text style={styles.removeText}>Remove</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}

            {files.length > 0 ? (
              <View style={styles.choiceRow}>
                <Pressable
                  accessibilityRole="button"
                  style={[
                    styles.primaryButton,
                    styles.flexButton,
                    uploading && styles.disabled,
                  ]}
                  disabled={uploading}
                  onPress={() => void startUpload()}
                >
                  <Text style={styles.primaryButtonText}>
                    {uploading
                      ? "Uploading…"
                      : completedIds.size
                        ? "Retry remaining files"
                        : "Start upload"}
                  </Text>
                </Pressable>
                {uploading ? (
                  <Pressable
                    accessibilityRole="button"
                    style={styles.secondaryButton}
                    onPress={cancelUpload}
                  >
                    <Text style={styles.secondaryButtonText}>Cancel</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {success ? (
              <Text style={styles.success}>
                Upload complete. The files have been sent.
              </Text>
            ) : null}
          </>
        ) : null}
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
