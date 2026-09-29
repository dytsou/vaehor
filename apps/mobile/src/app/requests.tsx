import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChoicePill } from "../components/choice-pill";
import { createServerFetch } from "../lib/api-client";
import { mobileThemeColors } from "../lib/mobile-theme";
import { useMobilePreferences } from "../lib/mobile-preferences";
import {
  createMobileFileRequest,
  deleteMobileFileRequest,
  listMobileFileRequests,
  type MobileFileRequest,
} from "../lib/request-api";
import type { ServerBookmark } from "../lib/servers";
import { loadActiveRouteSession } from "./route-session";

const expirationOptions = [
  { label: "1 hour", hours: 1 },
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 168 },
  { label: "30 days", hours: 720 },
] as const;

type RequestsFetch = ReturnType<typeof createServerFetch>;

async function refreshRequests(
  fetchImpl: RequestsFetch,
  setRequests: (requests: MobileFileRequest[]) => void,
): Promise<void> {
  const result = await listMobileFileRequests(fetchImpl);
  const sortedRequests = [...result].sort((a, b) => b.createdAt - a.createdAt);
  setRequests(sortedRequests);
}

async function createUploadRequestAction(options: {
  fetchImpl: RequestsFetch | null;
  folderId: string;
  folderName: string;
  title: string;
  expiresIn: (typeof expirationOptions)[number]["hours"];
  setRequests: (requests: MobileFileRequest[]) => void;
  setWorking: (working: boolean) => void;
  setError: (error: string | null) => void;
}): Promise<void> {
  const { fetchImpl, folderId, folderName, title, expiresIn } = options;
  if (!fetchImpl || !folderId || !folderName || !title.trim()) return;
  options.setWorking(true);
  options.setError(null);
  try {
    await createMobileFileRequest(fetchImpl, {
      folderId,
      folderName,
      title: title.trim(),
      expiresIn,
    });
    await refreshRequests(fetchImpl, options.setRequests);
  } catch (cause) {
    options.setError(
      cause instanceof Error
        ? cause.message
        : "Could not create this upload request.",
    );
  } finally {
    options.setWorking(false);
  }
}

async function removeUploadRequestAction(options: {
  fetchImpl: RequestsFetch | null;
  request: MobileFileRequest;
  setRequests: (
    update: (requests: MobileFileRequest[]) => MobileFileRequest[],
  ) => void;
  setWorking: (working: boolean) => void;
  setError: (error: string | null) => void;
}): Promise<void> {
  const { fetchImpl, request } = options;
  if (!fetchImpl) return;
  options.setWorking(true);
  options.setError(null);
  try {
    await deleteMobileFileRequest(fetchImpl, request.token);
    options.setRequests((current) =>
      current.filter((entry) => entry.token !== request.token),
    );
  } catch (cause) {
    options.setError(
      cause instanceof Error ? cause.message : "Could not delete this request.",
    );
  } finally {
    options.setWorking(false);
  }
}

type RequestsColors = ReturnType<typeof mobileThemeColors>;

function RequestsAdminPanel(
  props: Readonly<{
    colors: RequestsColors;
    folderId: string;
    folderName: string;
    title: string;
    setTitle: (title: string) => void;
    expiresIn: (typeof expirationOptions)[number]["hours"];
    setExpiresIn: (
      expiresIn: (typeof expirationOptions)[number]["hours"],
    ) => void;
    working: boolean;
    onCreate: () => void;
    requests: MobileFileRequest[];
    onShare: (request: MobileFileRequest) => void;
    onConfirmRemove: (request: MobileFileRequest) => void;
  }>,
) {
  return (
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
        <Text style={[styles.sectionTitle, { color: props.colors.foreground }]}>
          Create an upload request
        </Text>
        {props.folderId && props.folderName ? (
          <Text style={[styles.cardText, { color: props.colors.muted }]}>
            Uploads will go to {props.folderName}.
          </Text>
        ) : (
          <Text style={[styles.cardText, { color: props.colors.muted }]}>
            Open the destination folder in Files, then choose File requests.
          </Text>
        )}
        <TextInput
          accessibilityLabel="Request title"
          value={props.title}
          onChangeText={props.setTitle}
          placeholder="Request title"
          placeholderTextColor={props.colors.muted}
          style={[
            styles.input,
            {
              color: props.colors.foreground,
              borderColor: props.colors.border,
            },
          ]}
        />
        <Text style={[styles.label, { color: props.colors.foreground }]}>
          Link expires in
        </Text>
        <View style={styles.choiceRow}>
          {expirationOptions.map((option) => (
            <ChoicePill
              key={option.hours}
              label={option.label}
              selected={props.expiresIn === option.hours}
              onPress={() => props.setExpiresIn(option.hours)}
            />
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          style={[
            styles.primaryButton,
            (props.working ||
              !props.folderId ||
              !props.folderName ||
              !props.title.trim()) &&
              styles.disabled,
          ]}
          disabled={
            props.working ||
            !props.folderId ||
            !props.folderName ||
            !props.title.trim()
          }
          onPress={props.onCreate}
        >
          <Text style={styles.primaryButtonText}>
            {props.working ? "Creating…" : "Create upload request"}
          </Text>
        </Pressable>
      </View>

      <View
        style={[
          styles.card,
          {
            backgroundColor: props.colors.surface,
            borderColor: props.colors.border,
          },
        ]}
      >
        <Text style={[styles.sectionTitle, { color: props.colors.foreground }]}>
          Active requests
        </Text>
        {props.requests.map((request) => (
          <View
            key={request.token}
            style={[styles.requestCard, { borderColor: props.colors.border }]}
          >
            <Text
              style={[styles.requestTitle, { color: props.colors.foreground }]}
            >
              {request.title}
            </Text>
            <Text style={[styles.cardText, { color: props.colors.muted }]}>
              Destination: {request.folderName}
            </Text>
            <Text style={[styles.cardText, { color: props.colors.muted }]}>
              Expires {new Date(request.expiresAt).toLocaleString()}
            </Text>
            <View style={styles.choiceRow}>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => props.onShare(request)}
              >
                <Text style={styles.secondaryButtonText}>Share…</Text>
              </Pressable>
              <Pressable
                style={styles.secondaryButton}
                disabled={props.working}
                onPress={() => props.onConfirmRemove(request)}
              >
                <Text
                  style={[styles.secondaryButtonText, { color: "#b42318" }]}
                >
                  Delete
                </Text>
              </Pressable>
            </View>
          </View>
        ))}
        {!props.requests.length ? (
          <Text style={[styles.cardText, { color: props.colors.muted }]}>
            No active file requests.
          </Text>
        ) : null}
      </View>
    </>
  );
}

function RequestsRouteContent(
  props: Readonly<{
    colors: RequestsColors;
    error: string | null;
    loading: boolean;
    role: string;
    folderId: string;
    folderName: string;
    title: string;
    setTitle: (title: string) => void;
    expiresIn: (typeof expirationOptions)[number]["hours"];
    setExpiresIn: (
      expiresIn: (typeof expirationOptions)[number]["hours"],
    ) => void;
    working: boolean;
    onCreate: () => void;
    requests: MobileFileRequest[];
    onShare: (request: MobileFileRequest) => void;
    onConfirmRemove: (request: MobileFileRequest) => void;
  }>,
) {
  return (
    <>
      {props.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {props.error}
        </Text>
      ) : null}
      {props.loading ? <ActivityIndicator color="#1f6f78" /> : null}
      {!props.loading && props.role !== "ADMIN" ? (
        <Text style={[styles.cardText, { color: props.colors.muted }]}>
          File request management requires an administrator account.
        </Text>
      ) : null}
      {!props.loading && props.role === "ADMIN" ? (
        <RequestsAdminPanel
          colors={props.colors}
          folderId={props.folderId}
          folderName={props.folderName}
          title={props.title}
          setTitle={props.setTitle}
          expiresIn={props.expiresIn}
          setExpiresIn={props.setExpiresIn}
          working={props.working}
          onCreate={props.onCreate}
          requests={props.requests}
          onShare={props.onShare}
          onConfirmRemove={props.onConfirmRemove}
        />
      ) : null}
    </>
  );
}

function useRequestsRouteSession(options: {
  router: ReturnType<typeof useRouter>;
  apiRef: { current: RequestsFetch | null };
  setApiReady: (ready: boolean) => void;
  setServer: (server: ServerBookmark | null) => void;
  setRole: (role: string) => void;
  setRequests: (requests: MobileFileRequest[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}): void {
  const {
    router,
    apiRef,
    setApiReady,
    setServer,
    setRole,
    setRequests,
    setLoading,
    setError,
  } = options;
  useEffect(() => {
    let active = true;
    void loadActiveRouteSession({
      isActive: () => active,
      redirectToServer: () => router.replace("/"),
      setError,
    })
      .then(async (routeSession) => {
        if (!active || !routeSession) return;
        apiRef.current = routeSession.fetchImpl;
        setApiReady(true);
        setServer(routeSession.server);
        setRole(routeSession.role);
        if (routeSession.role === "ADMIN") {
          await refreshRequests(routeSession.fetchImpl, setRequests);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load file requests.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    apiRef,
    router,
    setApiReady,
    setError,
    setLoading,
    setRequests,
    setRole,
    setServer,
  ]);
}

export default function RequestsRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    folderId?: string;
    folderName?: string;
  }>();
  const { theme } = useMobilePreferences();
  const colors = useMemo(() => mobileThemeColors(theme === "dark"), [theme]);
  const apiRef = useRef<ReturnType<typeof createServerFetch> | null>(null);
  const [apiReady, setApiReady] = useState(false);
  const [server, setServer] = useState<ServerBookmark | null>(null);
  const [role, setRole] = useState("USER");
  const [requests, setRequests] = useState<MobileFileRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("File upload request");
  const [expiresIn, setExpiresIn] =
    useState<(typeof expirationOptions)[number]["hours"]>(168);

  const folderId = typeof params.folderId === "string" ? params.folderId : "";
  const folderName =
    typeof params.folderName === "string" ? params.folderName : "";

  useRequestsRouteSession({
    router,
    apiRef,
    setApiReady,
    setServer,
    setRole,
    setRequests,
    setLoading,
    setError,
  });

  const handleCreate = () =>
    createUploadRequestAction({
      fetchImpl: apiRef.current,
      folderId,
      folderName,
      title,
      expiresIn,
      setRequests,
      setWorking,
      setError,
    });

  const remove = (request: MobileFileRequest) =>
    removeUploadRequestAction({
      fetchImpl: apiRef.current,
      request,
      setRequests,
      setWorking,
      setError,
    });

  const confirmRemove = (request: MobileFileRequest) => {
    Alert.alert(
      "Delete upload request?",
      `“${request.title}” will stop accepting uploads.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void remove(request),
        },
      ],
    );
  };

  const shareRequest = async (request: MobileFileRequest) => {
    if (!server) return;
    const publicUrl = new URL(
      `/request/${request.token}`,
      server.url,
    ).toString();
    const appUrl = Linking.createURL(`/request/${request.token}`, {
      scheme: "vaehor",
      queryParams: { serverOrigin: server.url },
    });
    await Share.share({ message: `${publicUrl}\n\nOpen in Vaehor: ${appUrl}` });
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Pressable accessibilityRole="button" onPress={() => router.back()}>
            <Text style={styles.action}>‹ Files</Text>
          </Pressable>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              File requests
            </Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>
              {server?.label ?? "Server"}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={working || loading || !apiReady}
            onPress={() =>
              apiRef.current &&
              void refreshRequests(apiRef.current, setRequests)
            }
          >
            <Text style={styles.action}>Refresh</Text>
          </Pressable>
        </View>

        <RequestsRouteContent
          colors={colors}
          error={error}
          loading={loading}
          role={role}
          folderId={folderId}
          folderName={folderName}
          title={title}
          setTitle={setTitle}
          expiresIn={expiresIn}
          setExpiresIn={setExpiresIn}
          working={working}
          onCreate={handleCreate}
          requests={requests}
          onShare={shareRequest}
          onConfirmRemove={confirmRemove}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 18, paddingBottom: 40, gap: 14 },
  header: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  headerText: { flex: 1 },
  title: { fontSize: 21, fontWeight: "700" },
  subtitle: { fontSize: 13, marginTop: 2 },
  action: { color: "#1f6f78", fontWeight: "600" },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 11 },
  sectionTitle: { fontSize: 17, fontWeight: "700" },
  label: { fontSize: 14, fontWeight: "600" },
  cardText: { fontSize: 13, lineHeight: 19 },
  choiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
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
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  secondaryButtonText: { color: "#1f6f78", fontWeight: "600" },
  disabled: { opacity: 0.5 },
  requestCard: { borderTopWidth: 1, paddingTop: 12, gap: 4 },
  requestTitle: { fontSize: 15, fontWeight: "600" },
  error: { color: "#b42318", fontSize: 13 },
});
