import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChoicePill } from "../components/choice-pill";
import { listMobileDrives } from "../lib/file-api";
import { createServerFetch } from "../lib/api-client";
import { mobileThemeColors } from "../lib/mobile-theme";
import { useMobilePreferences } from "../lib/mobile-preferences";
import {
  getActiveServer,
  preferencesStore,
  type ServerBookmark,
} from "../lib/servers";
import { loadBiometricServerSession } from "../lib/biometric-session";
import {
  createMobileShareLink,
  deleteMobileShareLink,
  listMobileShareLinks,
  revokeMobileShareLink,
  type MobileFetch,
} from "../lib/share-api";
import type { ShareLink } from "@vaehor/sdk";

const durationOptions = ["1h", "24h", "7d", "30d"] as const;

export default function SharesRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    mode?: string;
    itemId?: string;
    parentId?: string;
    itemName?: string;
    isFolder?: string;
  }>();
  const { theme } = useMobilePreferences();
  const colors = useMemo(() => mobileThemeColors(theme === "dark"), [theme]);
  const apiRef = useRef<MobileFetch | null>(null);
  const [server, setServer] = useState<ServerBookmark | null>(null);
  const [role, setRole] = useState("USER");
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [shareType, setShareType] = useState<"timed" | "session">("timed");
  const [duration, setDuration] =
    useState<(typeof durationOptions)[number]>("7d");
  const [loginRequired, setLoginRequired] = useState(false);
  const [preventDownload, setPreventDownload] = useState(false);
  const [hasWatermark, setHasWatermark] = useState(false);
  const [watermarkText, setWatermarkText] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [revokedJtis, setRevokedJtis] = useState<Set<string>>(() => new Set());

  const itemId = typeof params.itemId === "string" ? params.itemId : "";
  const itemName = typeof params.itemName === "string" ? params.itemName : "";
  const parentId = typeof params.parentId === "string" ? params.parentId : "";
  const isFolder = params.isFolder === "true";
  const canCreate = Boolean(itemId && itemName && (isFolder || parentId));

  const refreshLinks = async (fetchImpl: MobileFetch) => {
    setLinks(await listMobileShareLinks(fetchImpl));
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
        const drives = await listMobileDrives(fetchImpl);
        if (!active) return;
        setServer(selected);
        setRole(drives.role.toUpperCase());
        await refreshLinks(fetchImpl);
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load share links.",
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
    if (!fetchImpl || !canCreate) return;
    setWorking(true);
    setError(null);
    try {
      const body = {
        path: isFolder
          ? `/folder/${itemId}`
          : `/folder/${parentId}/file/${itemId}/${makeSlug(itemName)}`,
        itemName,
        type: shareType,
        expiresIn: shareType === "session" ? "365d" : duration,
        loginRequired,
        preventDownload,
        hasWatermark,
        watermarkText: hasWatermark ? watermarkText : null,
        maxUses: maxUses.trim() ? Number.parseInt(maxUses, 10) : null,
      } as const;
      const response = await createMobileShareLink(fetchImpl, body);
      setCreatedUrl(response.shareableUrl ?? null);
      await refreshLinks(fetchImpl);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not create this share link.",
      );
    } finally {
      setWorking(false);
    }
  };

  const shareCreatedUrl = async () => {
    if (!createdUrl) return;
    await Share.share({ message: createdUrl });
  };

  const revoke = async (link: ShareLink) => {
    const fetchImpl = apiRef.current;
    if (!fetchImpl || !link.jti || !link.expiresAt) return;
    setWorking(true);
    setError(null);
    try {
      await revokeMobileShareLink(fetchImpl, {
        jti: link.jti,
        expiresAt: link.expiresAt,
      });
      setRevokedJtis((current) => new Set(current).add(link.jti!));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not revoke this link.",
      );
    } finally {
      setWorking(false);
    }
  };

  const remove = async (link: ShareLink) => {
    const fetchImpl = apiRef.current;
    if (!fetchImpl || !link.jti || !link.expiresAt) return;
    setWorking(true);
    setError(null);
    try {
      await deleteMobileShareLink(fetchImpl, {
        jti: link.jti,
        expiresAt: link.expiresAt,
      });
      setLinks((current) => current.filter((entry) => entry.jti !== link.jti));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not delete this link.",
      );
    } finally {
      setWorking(false);
    }
  };

  const confirmRevoke = (link: ShareLink) => {
    Alert.alert(
      "Revoke share link?",
      `“${link.itemName ?? "Share link"}” will stop working.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revoke",
          style: "destructive",
          onPress: () => void revoke(link),
        },
      ],
    );
  };

  const confirmDelete = (link: ShareLink) => {
    Alert.alert(
      "Delete share record?",
      `Delete “${link.itemName ?? "Share link"}” from the list?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void remove(link),
        },
      ],
    );
  };

  const shareLinkUrl = (link: ShareLink): string | null => {
    if (!server || !link.path || !link.token) return null;
    const url = new URL(link.path, server.url);
    url.searchParams.set("share_token", link.token);
    return url.toString();
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
              Share links
            </Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>
              {server?.label ?? "Server"}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={working || loading}
            onPress={() => apiRef.current && void refreshLinks(apiRef.current)}
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
            Share link management requires an administrator account.
          </Text>
        ) : null}

        {!loading && role === "ADMIN" && params.mode === "create" ? (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              Create a link for {itemName || "a selected file"}
            </Text>
            {!canCreate ? (
              <Text style={[styles.cardText, { color: colors.muted }]}>
                Open a file or folder first, then choose Share.
              </Text>
            ) : null}
            <Text style={[styles.label, { color: colors.foreground }]}>
              Link lifetime
            </Text>
            <View style={styles.choiceRow}>
              <ChoicePill
                label="Timed"
                selected={shareType === "timed"}
                onPress={() => setShareType("timed")}
              />
              <ChoicePill
                label="Session"
                selected={shareType === "session"}
                onPress={() => setShareType("session")}
              />
            </View>
            {shareType === "timed" ? (
              <View style={styles.choiceRow}>
                {durationOptions.map((option) => (
                  <ChoicePill
                    key={option}
                    label={option}
                    selected={duration === option}
                    onPress={() => setDuration(option)}
                  />
                ))}
              </View>
            ) : (
              <Text style={[styles.cardText, { color: colors.muted }]}>
                Session links use the server&apos;s session lifetime.
              </Text>
            )}
            <SettingRow
              label="Require recipient sign-in"
              value={loginRequired}
              onValueChange={setLoginRequired}
            />
            <SettingRow
              label="Prevent downloads"
              value={preventDownload}
              onValueChange={setPreventDownload}
            />
            <SettingRow
              label="Add watermark"
              value={hasWatermark}
              onValueChange={setHasWatermark}
            />
            {hasWatermark ? (
              <TextInput
                accessibilityLabel="Watermark text"
                placeholder="Watermark text"
                placeholderTextColor={colors.muted}
                value={watermarkText}
                onChangeText={setWatermarkText}
                style={[
                  styles.input,
                  { color: colors.foreground, borderColor: colors.border },
                ]}
              />
            ) : null}
            <TextInput
              accessibilityLabel="Maximum uses"
              keyboardType="number-pad"
              placeholder="Maximum uses (optional)"
              placeholderTextColor={colors.muted}
              value={maxUses}
              onChangeText={setMaxUses}
              style={[
                styles.input,
                { color: colors.foreground, borderColor: colors.border },
              ]}
            />
            <Pressable
              style={[
                styles.primaryButton,
                (working || !canCreate) && styles.disabled,
              ]}
              disabled={working || !canCreate}
              onPress={() => void handleCreate()}
            >
              <Text style={styles.primaryButtonText}>
                {working ? "Creating…" : "Create share link"}
              </Text>
            </Pressable>
            {createdUrl ? (
              <View style={styles.createdCard}>
                <Text style={styles.createdUrl} selectable>
                  {createdUrl}
                </Text>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => void shareCreatedUrl()}
                >
                  <Text style={styles.secondaryButtonText}>Share link…</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}

        {!loading && role === "ADMIN" ? (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              Active links
            </Text>
            {links.map((link, index) => {
              const url = shareLinkUrl(link);
              return (
                <View
                  key={link.jti ?? link.id ?? `${link.path}-${index}`}
                  style={[styles.linkCard, { borderColor: colors.border }]}
                >
                  <Text
                    style={[styles.linkTitle, { color: colors.foreground }]}
                    numberOfLines={2}
                  >
                    {link.itemName ?? "Shared item"}
                  </Text>
                  <Text style={[styles.cardText, { color: colors.muted }]}>
                    {link.expiresAt
                      ? `Expires ${new Date(link.expiresAt).toLocaleString()}`
                      : "No expiry"}
                    {typeof link.viewCount === "number"
                      ? ` · ${link.viewCount} views`
                      : ""}
                  </Text>
                  {url ? (
                    <Pressable
                      style={styles.secondaryButton}
                      onPress={() => void Share.share({ message: url })}
                    >
                      <Text style={styles.secondaryButtonText}>Share…</Text>
                    </Pressable>
                  ) : null}
                  <View style={styles.choiceRow}>
                    <Pressable
                      style={styles.secondaryButton}
                      disabled={working || !link.jti}
                      onPress={() => confirmRevoke(link)}
                    >
                      <Text style={styles.secondaryButtonText}>
                        {link.jti && revokedJtis.has(link.jti)
                          ? "Revoked"
                          : "Revoke"}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={styles.secondaryButton}
                      disabled={working || !link.jti}
                      onPress={() => confirmDelete(link)}
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
              );
            })}
            {!links.length ? (
              <Text style={[styles.cardText, { color: colors.muted }]}>
                No share links yet.
              </Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function SettingRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: "#1f6f78" }}
      />
    </View>
  );
}

function makeSlug(name: string): string {
  return (
    name
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "item"
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
  settingRow: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  settingLabel: { color: "#334155", fontSize: 14, flex: 1 },
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
  createdCard: {
    borderRadius: 10,
    padding: 10,
    backgroundColor: "#f0fdfa",
    gap: 8,
  },
  createdUrl: { color: "#134e4a", fontSize: 13 },
  linkCard: { borderTopWidth: 1, paddingTop: 12, gap: 4 },
  linkTitle: { fontSize: 15, fontWeight: "600" },
  error: { color: "#b42318", fontSize: 13 },
});
