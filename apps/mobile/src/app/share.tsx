import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { findBookmarkForOrigin, type DeepLinkTarget } from "../lib/deep-link";
import { mobileThemeColors } from "../lib/mobile-theme";
import { useMobilePreferences } from "../lib/mobile-preferences";

function shareScreenTitle(
  loading: boolean,
  bookmark: ServerBookmark | null,
): string {
  if (loading) return "Opening shared link";
  if (bookmark) return `Shared from ${bookmark.label}`;
  return "Connect to this server";
}

async function addShareTargetServer(options: {
  origin: string;
  onAdded: () => void;
  setAdding: (adding: boolean) => void;
  setError: (error: string | null) => void;
}): Promise<void> {
  options.setError(null);
  options.setAdding(true);
  try {
    await addServer(preferencesStore, { url: options.origin });
    options.onAdded();
  } catch (cause) {
    const isUnreachable =
      cause instanceof Error && cause.message === "unreachable";
    options.setError(
      isUnreachable
        ? "This server could not be reached. Check the address and try again."
        : "This server address is not valid.",
    );
  } finally {
    options.setAdding(false);
  }
}
import {
  addServer,
  preferencesStore,
  switchActiveServer,
  type ServerBookmark,
} from "../lib/servers";

export default function ShareRoute() {
  const router = useRouter();
  const { theme } = useMobilePreferences();
  const colors = mobileThemeColors(theme === "dark");
  const params = useLocalSearchParams<{
    origin?: string;
    path?: string;
    destination?: string;
  }>();
  const [bookmark, setBookmark] = useState<ServerBookmark | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const origin = typeof params.origin === "string" ? params.origin : "";
  const path = typeof params.path === "string" ? params.path : "";

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const servers = await preferencesStore.getServers();
        const match = findBookmarkForOrigin(origin, servers);
        if (mounted) setBookmark(match);
        if (match) await switchActiveServer(preferencesStore, match.id);
      } catch {
        if (mounted) setError("Could not open this share link.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [origin]);

  const openTarget = () => {
    if (!origin || !path) return;
    router.replace({
      pathname: "/",
      params: { shareOrigin: origin, sharePath: path },
    });
  };

  const addTargetServer = () =>
    addShareTargetServer({
      origin,
      onAdded: openTarget,
      setAdding,
      setError,
    });

  const target: DeepLinkTarget | null =
    origin && path ? { origin, path } : null;
  const title = shareScreenTitle(loading, bookmark);

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <Text style={styles.brand}>vaehor</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {title}
        </Text>
        <Text style={[styles.origin, { color: colors.muted }]}>
          {origin || "Invalid share link"}
        </Text>
        {loading ? <ActivityIndicator color="#1f6f78" /> : null}
        {!loading && !bookmark && target ? (
          <Text style={[styles.body, { color: colors.foreground }]}>
            Add this self-hosted server to continue. The link will stay scoped
            to this address.
          </Text>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!loading && bookmark ? (
          <Pressable style={styles.button} onPress={openTarget}>
            <Text style={styles.buttonText}>Continue in Vaehor</Text>
          </Pressable>
        ) : null}
        {!loading && !bookmark && target ? (
          <Pressable
            style={[styles.button, adding && styles.disabled]}
            disabled={adding}
            onPress={() => void addTargetServer()}
          >
            <Text style={styles.buttonText}>
              {adding ? "Connecting…" : "Add server and continue"}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          style={styles.backButton}
          onPress={() => router.replace("/")}
        >
          <Text style={styles.backText}>Back to servers</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  card: {
    gap: 16,
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
  },
  brand: { color: "#1f6f78", fontSize: 16, fontWeight: "700" },
  title: { color: "#17252b", fontSize: 25, fontWeight: "700" },
  origin: { color: "#51636a", fontSize: 14 },
  body: { color: "#34464d", fontSize: 15, lineHeight: 22 },
  error: { color: "#a82626", fontSize: 14 },
  button: {
    alignItems: "center",
    borderRadius: 14,
    backgroundColor: "#1f6f78",
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  disabled: { opacity: 0.55 },
  buttonText: { color: "#ffffff", fontWeight: "700", fontSize: 15 },
  backButton: { alignItems: "center", paddingVertical: 8 },
  backText: { color: "#1f6f78", fontWeight: "600", fontSize: 14 },
});
