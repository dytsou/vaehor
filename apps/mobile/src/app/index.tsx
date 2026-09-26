import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as Network from "expo-network";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  clearSessionForServer,
  loadSessionForServer,
  recordBiometricFailure,
  resetBiometricFailures,
} from "../lib/session-store";
import {
  addServer,
  defaultLabelForOrigin,
  getActiveServer,
  preferencesStore,
  removeServer,
  switchActiveServer,
  type ServerBookmark,
} from "../lib/servers";
import { isBiometricAvailable, promptBiometricUnlock } from "../lib/biometrics";
import { startGoogleOAuth } from "../lib/oauth";

export default function ServerSelectionRoute() {
  const theme = useColorScheme();
  const colors = themeColors(theme === "dark");
  const params = useLocalSearchParams<{
    connected?: string;
    authError?: string;
    shareOrigin?: string;
    sharePath?: string;
  }>();
  const [servers, setServers] = useState<ServerBookmark[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [originInput, setOriginInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [needsBiometricUnlock, setNeedsBiometricUnlock] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeServer = useMemo(
    () => servers.find((server) => server.id === activeId) ?? null,
    [servers, activeId],
  );

  const refreshNetwork = useCallback(async () => {
    try {
      const state = await Network.getNetworkStateAsync();
      setOffline(
        state.isConnected === false || state.isInternetReachable === false,
      );
    } catch {
      setOffline(false);
    }
  }, []);

  const loadServerState = useCallback(async (promptForBiometrics: boolean) => {
    const [nextServers, selected] = await Promise.all([
      preferencesStore.getServers(),
      getActiveServer(preferencesStore),
    ]);
    const nextActive = selected ?? null;
    if (nextActive && !(await preferencesStore.getActiveId())) {
      await switchActiveServer(preferencesStore, nextActive.id);
    }
    setServers(nextServers);
    setActiveId(nextActive?.id ?? null);
    setSessionToken(null);
    setNeedsBiometricUnlock(false);

    if (!nextActive) return;
    const token = await loadSessionForServer(nextActive.url);
    if (!token) return;
    if (nextActive.biometricsEnabled && promptForBiometrics) {
      const available = await isBiometricAvailable();
      if (!available) {
        setNeedsBiometricUnlock(true);
        setError(
          "Biometrics are unavailable. Sign in again or enable them in device settings.",
        );
        return;
      }
      const unlocked = await promptBiometricUnlock(
        `Unlock ${nextActive.label}`,
      );
      if (!unlocked) {
        await recordBiometricFailure(nextActive.url);
        setNeedsBiometricUnlock(true);
        setError(
          "Biometric unlock did not succeed. Try again or sign in again.",
        );
        return;
      }
      await resetBiometricFailures(nextActive.url);
    }
    setSessionToken(token);
    setNeedsBiometricUnlock(false);
  }, []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      await refreshNetwork();
      try {
        await loadServerState(true);
      } catch {
        if (mounted) setError("Could not load saved servers. Please retry.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    const subscription = Network.addNetworkStateListener((state) => {
      setOffline(
        state.isConnected === false || state.isInternetReachable === false,
      );
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [loadServerState, refreshNetwork]);

  useEffect(() => {
    if (params.connected) {
      setError(null);
      void loadServerState(false);
    }
    if (params.authError)
      setError("Sign-in could not be completed. Please try again.");
    if (params.shareOrigin && params.sharePath) {
      setError("Shared link is ready. Continue from the shared-link screen.");
    }
  }, [
    loadServerState,
    params.authError,
    params.connected,
    params.shareOrigin,
    params.sharePath,
  ]);

  const chooseServer = async (server: ServerBookmark) => {
    setWorking(true);
    setError(null);
    try {
      await switchActiveServer(preferencesStore, server.id);
      await loadServerState(true);
    } catch {
      setError("Could not switch servers. Please try again.");
    } finally {
      setWorking(false);
    }
  };

  const handleAddServer = async () => {
    setWorking(true);
    setError(null);
    try {
      await addServer(preferencesStore, {
        url: originInput,
        label: labelInput,
      });
      setOriginInput("");
      setLabelInput("");
      await loadServerState(false);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "invalid_url";
      setError(
        code === "unreachable"
          ? "The server could not be reached. Check the address and try again."
          : "Enter a valid HTTPS server address.",
      );
    } finally {
      setWorking(false);
    }
  };

  const handleSignIn = async () => {
    if (!activeServer) return;
    setWorking(true);
    setError(null);
    try {
      const completed = await startGoogleOAuth(activeServer.url);
      if (!completed) return;
      await loadServerState(false);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      setError(
        message.includes("oauth_state")
          ? "Could not start sign-in with this server. Please retry."
          : message.includes("timeout") || message.includes("AbortError")
            ? "The server took too long to respond. Check your connection and retry."
            : "Sign-in failed. Check the server address and try again.",
      );
    } finally {
      setWorking(false);
    }
  };

  const handleUnlock = async () => {
    if (!activeServer) return;
    setWorking(true);
    setError(null);
    try {
      await loadServerState(true);
    } catch {
      setError("Could not unlock this server. Please try again.");
    } finally {
      setWorking(false);
    }
  };

  const handleToggleBiometrics = async () => {
    if (!activeServer) return;
    setWorking(true);
    setError(null);
    try {
      const nextValue = !activeServer.biometricsEnabled;
      if (nextValue) {
        if (!(await isBiometricAvailable())) {
          throw new Error("biometrics_unavailable");
        }
        if (!(await promptBiometricUnlock("Confirm biometric unlock"))) {
          throw new Error("biometrics_denied");
        }
      }
      const updated = servers.map((server) =>
        server.id === activeServer.id
          ? { ...server, biometricsEnabled: nextValue }
          : server,
      );
      await preferencesStore.setServers(updated);
      setServers(updated);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message === "biometrics_unavailable"
          ? "Set up Face ID or fingerprint unlock on this device first."
          : "Biometric settings were not changed.",
      );
    } finally {
      setWorking(false);
    }
  };

  const handleLogout = async () => {
    if (!activeServer) return;
    setWorking(true);
    setError(null);
    try {
      await clearSessionForServer(activeServer.url);
      setSessionToken(null);
      setNeedsBiometricUnlock(false);
    } catch {
      setError("Could not sign out. Please try again.");
    } finally {
      setWorking(false);
    }
  };

  const confirmRemoveServer = (server: ServerBookmark) => {
    Alert.alert(
      "Remove server?",
      `This removes ${server.label} and clears its saved session.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => void handleRemoveServer(server),
        },
      ],
    );
  };

  const handleRemoveServer = async (server: ServerBookmark) => {
    setWorking(true);
    setError(null);
    try {
      await removeServer(preferencesStore, server.id);
      await loadServerState(false);
    } catch {
      setError("Could not remove this server. Please try again.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>v</Text>
          </View>
          <View>
            <Text style={[styles.brandName, { color: colors.foreground }]}>
              Vaehor
            </Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>
              Your files, on your server
            </Text>
          </View>
        </View>

        {offline ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Offline · Reconnect to reach your servers
            </Text>
          </View>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        {loading ? <ActivityIndicator color="#1f6f78" size="large" /> : null}

        {!loading ? (
          <>
            <View style={styles.sectionHeading}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Servers
              </Text>
              <Text style={[styles.count, { color: colors.muted }]}>
                {servers.length}
              </Text>
            </View>
            {servers.map((server) => {
              const selected = server.id === activeId;
              return (
                <View
                  key={server.id}
                  style={[
                    styles.serverCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: selected ? "#1f6f78" : colors.border,
                    },
                  ]}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={styles.serverButton}
                    disabled={working}
                    onPress={() => void chooseServer(server)}
                  >
                    <Text
                      style={[styles.serverLabel, { color: colors.foreground }]}
                    >
                      {server.label}
                    </Text>
                    <Text style={[styles.serverUrl, { color: colors.muted }]}>
                      {server.url}
                    </Text>
                    {selected ? (
                      <Text style={styles.activeLabel}>Selected</Text>
                    ) : null}
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${server.label}`}
                    style={styles.removeButton}
                    disabled={working}
                    onPress={() => confirmRemoveServer(server)}
                  >
                    <Text style={styles.removeText}>Remove</Text>
                  </Pressable>
                </View>
              );
            })}

            {activeServer ? (
              <View
                style={[
                  styles.activeCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[styles.activeTitle, { color: colors.foreground }]}
                >
                  {activeServer.label}
                </Text>
                <Text style={[styles.serverUrl, { color: colors.muted }]}>
                  {activeServer.url}
                </Text>
                {sessionToken ? (
                  <>
                    <Text style={styles.connected}>Signed in securely</Text>
                    <Pressable
                      style={styles.secondaryButton}
                      disabled={working}
                      onPress={() => void handleToggleBiometrics()}
                    >
                      <Text style={styles.secondaryButtonText}>
                        {activeServer.biometricsEnabled
                          ? "Turn off biometric unlock"
                          : "Enable biometric unlock"}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={styles.secondaryButton}
                      disabled={working}
                      onPress={() => void handleLogout()}
                    >
                      <Text style={styles.secondaryButtonText}>
                        Sign out of this server
                      </Text>
                    </Pressable>
                  </>
                ) : needsBiometricUnlock ? (
                  <Pressable
                    style={styles.primaryButton}
                    disabled={working}
                    onPress={() => void handleUnlock()}
                  >
                    <Text style={styles.primaryButtonText}>
                      {working ? "Unlocking…" : "Unlock this server"}
                    </Text>
                  </Pressable>
                ) : (
                  <Pressable
                    style={styles.primaryButton}
                    disabled={working || offline}
                    onPress={() => void handleSignIn()}
                  >
                    <Text style={styles.primaryButtonText}>
                      {working
                        ? "Opening secure sign-in…"
                        : "Continue with Google"}
                    </Text>
                  </Pressable>
                )}
              </View>
            ) : null}

            <View
              style={[
                styles.addCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Add a self-hosted server
              </Text>
              <TextInput
                accessibilityLabel="Server address"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="https://files.example.com"
                placeholderTextColor={colors.muted}
                value={originInput}
                onChangeText={setOriginInput}
                style={[
                  styles.input,
                  { color: colors.foreground, borderColor: colors.border },
                ]}
              />
              <TextInput
                accessibilityLabel="Server name"
                autoCapitalize="words"
                placeholder={
                  originInput
                    ? defaultLabelForOrigin(originInput)
                    : "Name (optional)"
                }
                placeholderTextColor={colors.muted}
                value={labelInput}
                onChangeText={setLabelInput}
                style={[
                  styles.input,
                  { color: colors.foreground, borderColor: colors.border },
                ]}
              />
              <Pressable
                style={[
                  styles.primaryButton,
                  (working || offline || !originInput.trim()) &&
                    styles.disabled,
                ]}
                disabled={working || offline || !originInput.trim()}
                onPress={() => void handleAddServer()}
              >
                <Text style={styles.primaryButtonText}>
                  {working ? "Checking server…" : "Add server"}
                </Text>
              </Pressable>
            </View>
          </>
        ) : null}

        <Text style={[styles.footer, { color: colors.muted }]}>
          Credentials stay on this device and are kept separate for each server.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function themeColors(dark: boolean) {
  return dark
    ? {
        background: "#10191d",
        surface: "#18262b",
        foreground: "#eaf1f2",
        muted: "#a6b7bd",
        border: "#304249",
      }
    : {
        background: "#f4f7f8",
        surface: "#ffffff",
        foreground: "#17252b",
        muted: "#607279",
        border: "#d9e2e5",
      };
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    gap: 18,
    padding: 24,
    paddingBottom: 48,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 8,
  },
  brandMark: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: "#1f6f78",
    alignItems: "center",
    justifyContent: "center",
  },
  brandMarkText: { color: "#ffffff", fontSize: 28, fontWeight: "800" },
  brandName: { fontSize: 24, fontWeight: "800" },
  subtitle: { fontSize: 13, marginTop: 3 },
  sectionHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: { fontSize: 18, fontWeight: "700" },
  count: { fontSize: 14 },
  serverCard: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  serverButton: { flex: 1, gap: 4, paddingVertical: 4 },
  serverLabel: { fontWeight: "700", fontSize: 16 },
  serverUrl: { fontSize: 13 },
  activeLabel: {
    color: "#1f6f78",
    fontWeight: "700",
    fontSize: 12,
    marginTop: 4,
  },
  removeButton: { paddingHorizontal: 10, paddingVertical: 8 },
  removeText: { color: "#a33b3b", fontSize: 13, fontWeight: "600" },
  activeCard: { gap: 12, borderWidth: 1, borderRadius: 20, padding: 18 },
  activeTitle: { fontSize: 19, fontWeight: "700" },
  connected: { color: "#21724b", fontSize: 14, fontWeight: "600" },
  addCard: {
    gap: 12,
    borderWidth: 1,
    borderRadius: 20,
    padding: 18,
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontSize: 15,
  },
  primaryButton: {
    alignItems: "center",
    borderRadius: 13,
    backgroundColor: "#1f6f78",
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  primaryButtonText: { color: "#ffffff", fontWeight: "700", fontSize: 15 },
  secondaryButton: {
    alignItems: "center",
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "#1f6f78",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondaryButtonText: { color: "#1f6f78", fontWeight: "700", fontSize: 14 },
  disabled: { opacity: 0.5 },
  error: { color: "#aa3030", fontSize: 14, lineHeight: 20 },
  notice: { borderRadius: 12, backgroundColor: "#fff0d6", padding: 12 },
  noticeText: { color: "#794f06", fontWeight: "600", fontSize: 13 },
  footer: { fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 8 },
});
