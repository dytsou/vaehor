import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { createServerFetch } from "../lib/api-client";
import { useMobilePreferences } from "../lib/mobile-preferences";
import { formatMobileFileSize } from "../lib/mobile-formatters";
import { loadActiveRouteSession } from "./route-session";

type TrashedFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime: string;
};

export default function TrashRoute() {
  const router = useRouter();
  const { theme } = useMobilePreferences();
  const colors = useMemo(() => themeColors(theme === "dark"), [theme]);
  const apiRef = useRef<ReturnType<typeof createServerFetch> | null>(null);
  const [items, setItems] = useState<TrashedFile[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (
    fetchImpl: ReturnType<typeof createServerFetch> | null,
  ) => {
    const response = await fetchImpl?.("/api/trash");
    if (!response) return;
    const payload = (await response.json().catch(() => null)) as
      | TrashedFile[]
      | { error?: unknown }
      | null;
    if (!response.ok || !Array.isArray(payload)) {
      throw new Error("Could not load the trash.");
    }
    setItems(payload);
    setSelectedIds(new Set());
  };

  useEffect(() => {
    let active = true;
    void loadActiveRouteSession({
      isActive: () => active,
      redirectToServer: () => router.replace("/"),
      setError,
    })
      .then(async (routeSession) => {
        if (!active || !routeSession || routeSession.role !== "ADMIN") return;
        setAuthorized(true);
        apiRef.current = routeSession.fetchImpl;
        await refresh(routeSession.fetchImpl);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load the trash.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [router]);

  const visibleItems = items
    .filter((item) =>
      item.name.toLowerCase().includes(query.trim().toLowerCase()),
    )
    .sort((a, b) => Date.parse(b.modifiedTime) - Date.parse(a.modifiedTime));

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const performAction = async (action: "restore" | "delete") => {
    const fetchImpl = apiRef.current;
    const fileIds = [...selectedIds];
    if (!fetchImpl || !fileIds.length) return;
    setWorking(true);
    setError(null);
    try {
      const response = await fetchImpl("/api/trash", {
        method: action === "restore" ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds }),
      });
      if (!response.ok)
        throw new Error(
          action === "restore"
            ? "Could not restore the selected files."
            : "Could not permanently delete the selected files.",
        );
      await refresh(fetchImpl);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The trash action failed.",
      );
    } finally {
      setWorking(false);
    }
  };

  const confirmPermanentDelete = () => {
    Alert.alert(
      "Delete forever?",
      `Permanently delete ${selectedIds.size} item(s)? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete forever",
          style: "destructive",
          onPress: () => void performAction("delete"),
        },
      ],
    );
  };

  const selectAll = () => {
    setSelectedIds((current) =>
      current.size === visibleItems.length
        ? new Set()
        : new Set(visibleItems.map((item) => item.id)),
    );
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
          <Text style={[styles.title, { color: colors.foreground }]}>
            Trash
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={loading || working || !authorized}
            onPress={() => void refresh(apiRef.current)}
          >
            <Text style={styles.action}>Refresh</Text>
          </Pressable>
        </View>

        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        {loading ? <ActivityIndicator color="#1f6f78" size="large" /> : null}
        {!loading && !authorized ? (
          <Text style={[styles.body, { color: colors.muted }]}>
            Trash management requires an administrator account.
          </Text>
        ) : null}
        {!loading && authorized ? (
          <>
            <TextInput
              accessibilityLabel="Search trash"
              autoCapitalize="none"
              autoCorrect={false}
              value={query}
              onChangeText={setQuery}
              placeholder="Search deleted files"
              placeholderTextColor={colors.muted}
              style={[
                styles.input,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                },
              ]}
            />
            <View style={styles.actionRow}>
              <Pressable
                style={styles.secondaryButton}
                onPress={selectAll}
                disabled={!visibleItems.length || working}
              >
                <Text style={styles.secondaryText}>
                  {selectedIds.size === visibleItems.length
                    ? "Clear selection"
                    : "Select all"}
                </Text>
              </Pressable>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => void performAction("restore")}
                disabled={!selectedIds.size || working}
              >
                <Text style={styles.secondaryText}>
                  {working ? "Working…" : "Restore"}
                </Text>
              </Pressable>
              <Pressable
                style={styles.secondaryButton}
                onPress={confirmPermanentDelete}
                disabled={!selectedIds.size || working}
              >
                <Text style={[styles.secondaryText, { color: "#b42318" }]}>
                  Delete forever
                </Text>
              </Pressable>
            </View>
            {visibleItems.map((item) => {
              const selected = selectedIds.has(item.id);
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  onPress={() => toggleSelected(item.id)}
                  style={[
                    styles.item,
                    {
                      backgroundColor: colors.surface,
                      borderColor: selected ? "#1f6f78" : colors.border,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.checkbox,
                      selected && styles.checkboxSelected,
                    ]}
                  >
                    <Text style={styles.checkmark}>{selected ? "✓" : ""}</Text>
                  </View>
                  <View style={styles.itemInfo}>
                    <Text
                      style={[styles.itemName, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                    <Text
                      style={[styles.body, { color: colors.muted }]}
                      numberOfLines={1}
                    >
                      {item.mimeType}
                      {item.size ? ` · ${formatSize(item.size)}` : ""}
                    </Text>
                    <Text style={[styles.body, { color: colors.muted }]}>
                      Deleted {new Date(item.modifiedTime).toLocaleDateString()}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
            {!visibleItems.length ? (
              <Text style={[styles.body, { color: colors.muted }]}>
                Trash is empty.
              </Text>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function formatSize(size: string) {
  const value = Number(size);
  if (!Number.isFinite(value) || value < 0) return size;
  return formatMobileFileSize(value);
}

function themeColors(isDark: boolean) {
  return isDark
    ? {
        background: "#111827",
        surface: "#1f2937",
        foreground: "#f9fafb",
        muted: "#9ca3af",
        border: "#374151",
      }
    : {
        background: "#f8fafc",
        surface: "#ffffff",
        foreground: "#111827",
        muted: "#64748b",
        border: "#e2e8f0",
      };
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 18, paddingBottom: 40, gap: 12 },
  header: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: { flex: 1, textAlign: "center", fontSize: 21, fontWeight: "700" },
  action: { color: "#1f6f78", fontWeight: "600" },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
  },
  secondaryButton: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  secondaryText: { color: "#1f6f78", fontSize: 13, fontWeight: "600" },
  item: {
    minHeight: 80,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#94a3b8",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxSelected: { backgroundColor: "#1f6f78", borderColor: "#1f6f78" },
  checkmark: { color: "#fff", fontWeight: "700", fontSize: 14 },
  itemInfo: { flex: 1, gap: 3 },
  itemName: { fontSize: 14, fontWeight: "600" },
  body: { fontSize: 13, lineHeight: 19 },
  error: { color: "#b42318", fontSize: 13 },
});
