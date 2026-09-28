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
import { listMobileDrives } from "../lib/file-api";
import { mobileThemeColors } from "../lib/mobile-theme";
import { useMobilePreferences } from "../lib/mobile-preferences";
import {
  createMobileFileRequest,
  deleteMobileFileRequest,
  listMobileFileRequests,
  type MobileFileRequest,
} from "../lib/request-api";
import {
  getActiveServer,
  preferencesStore,
  type ServerBookmark,
} from "../lib/servers";
import { loadBiometricServerSession } from "../lib/biometric-session";

const expirationOptions = [
  { label: "1 hour", hours: 1 },
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 168 },
  { label: "30 days", hours: 720 },
] as const;

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

  const refreshRequests = async (
    fetchImpl: ReturnType<typeof createServerFetch>,
  ) => {
    const result = await listMobileFileRequests(fetchImpl);
    setRequests(result.sort((a, b) => b.createdAt - a.createdAt));
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const selected = await getActiveServer(preferencesStore);
        if (!active) return;
        if (!selected) {
          router.replace("/");
          return;
        }
        const session = await loadBiometricServerSession(selected);
        if (!active) return;
        if (session.status !== "authenticated") {
          if (session.status === "missing") {
            router.replace("/");
          } else {
            setError(
              session.status === "biometrics-unavailable"
                ? "Biometric unlock is unavailable on this device. Return to the server screen to continue."
                : "Biometric unlock was not completed. Return to the server screen to continue.",
            );
          }
          return;
        }
        const fetchImpl = createServerFetch(selected.url, session.token);
        apiRef.current = fetchImpl;
        setApiReady(true);
        const drives = await listMobileDrives(fetchImpl);
        if (!active) return;
        setServer(selected);
        setRole(drives.role.toUpperCase());
        if (drives.role.toUpperCase() === "ADMIN")
          await refreshRequests(fetchImpl);
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load file requests.",
          );
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [router]);

  const handleCreate = async () => {
    const fetchImpl = apiRef.current;
    if (!fetchImpl || !folderId || !folderName || !title.trim()) return;
    setWorking(true);
    setError(null);
    try {
      await createMobileFileRequest(fetchImpl, {
        folderId,
        folderName,
        title: title.trim(),
        expiresIn,
      });
      await refreshRequests(fetchImpl);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not create this upload request.",
      );
    } finally {
      setWorking(false);
    }
  };

  const remove = async (request: MobileFileRequest) => {
    const fetchImpl = apiRef.current;
    if (!fetchImpl) return;
    setWorking(true);
    setError(null);
    try {
      await deleteMobileFileRequest(fetchImpl, request.token);
      setRequests((current) =>
        current.filter((entry) => entry.token !== request.token),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not delete this request.",
      );
    } finally {
      setWorking(false);
    }
  };

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
              apiRef.current && void refreshRequests(apiRef.current)
            }
          >
            <Text style={styles.action}>Refresh</Text>
          </Pressable>
        </View>

        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        {loading ? <ActivityIndicator color="#1f6f78" /> : null}
        {!loading && role !== "ADMIN" ? (
          <Text style={[styles.cardText, { color: colors.muted }]}>
            File request management requires an administrator account.
          </Text>
        ) : null}

        {!loading && role === "ADMIN" ? (
          <>
            <View
              style={[
                styles.card,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Create an upload request
              </Text>
              {folderId && folderName ? (
                <Text style={[styles.cardText, { color: colors.muted }]}>
                  Uploads will go to {folderName}.
                </Text>
              ) : (
                <Text style={[styles.cardText, { color: colors.muted }]}>
                  Open the destination folder in Files, then choose File
                  requests.
                </Text>
              )}
              <TextInput
                accessibilityLabel="Request title"
                value={title}
                onChangeText={setTitle}
                placeholder="Request title"
                placeholderTextColor={colors.muted}
                style={[
                  styles.input,
                  { color: colors.foreground, borderColor: colors.border },
                ]}
              />
              <Text style={[styles.label, { color: colors.foreground }]}>
                Link expires in
              </Text>
              <View style={styles.choiceRow}>
                {expirationOptions.map((option) => (
                  <ChoicePill
                    key={option.hours}
                    label={option.label}
                    selected={expiresIn === option.hours}
                    onPress={() => setExpiresIn(option.hours)}
                  />
                ))}
              </View>
              <Pressable
                accessibilityRole="button"
                style={[
                  styles.primaryButton,
                  (working || !folderId || !folderName || !title.trim()) &&
                    styles.disabled,
                ]}
                disabled={working || !folderId || !folderName || !title.trim()}
                onPress={() => void handleCreate()}
              >
                <Text style={styles.primaryButtonText}>
                  {working ? "Creating…" : "Create upload request"}
                </Text>
              </Pressable>
            </View>

            <View
              style={[
                styles.card,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Active requests
              </Text>
              {requests.map((request) => (
                <View
                  key={request.token}
                  style={[styles.requestCard, { borderColor: colors.border }]}
                >
                  <Text
                    style={[styles.requestTitle, { color: colors.foreground }]}
                  >
                    {request.title}
                  </Text>
                  <Text style={[styles.cardText, { color: colors.muted }]}>
                    Destination: {request.folderName}
                  </Text>
                  <Text style={[styles.cardText, { color: colors.muted }]}>
                    Expires {new Date(request.expiresAt).toLocaleString()}
                  </Text>
                  <View style={styles.choiceRow}>
                    <Pressable
                      style={styles.secondaryButton}
                      onPress={() => void shareRequest(request)}
                    >
                      <Text style={styles.secondaryButtonText}>Share…</Text>
                    </Pressable>
                    <Pressable
                      style={styles.secondaryButton}
                      disabled={working}
                      onPress={() => confirmRemove(request)}
                    >
                      <Text
                        style={[
                          styles.secondaryButtonText,
                          { color: "#b42318" },
                        ]}
                      >
                        Delete
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ))}
              {!requests.length ? (
                <Text style={[styles.cardText, { color: colors.muted }]}>
                  No active file requests.
                </Text>
              ) : null}
            </View>
          </>
        ) : null}
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
