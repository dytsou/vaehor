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
import { mobileThemeColors } from "../lib/mobile-theme";
import { useMobilePreferences } from "../lib/mobile-preferences";
import type { ServerBookmark } from "../lib/servers";
import {
  createMobileShareLink,
  deleteMobileShareLink,
  listMobileShareLinks,
  revokeMobileShareLink,
  type MobileFetch,
} from "../lib/share-api";
import type { ShareLink } from "@vaehor/sdk";
import { loadActiveRouteSession } from "./route-session";

const durationOptions = ["1h", "24h", "7d", "30d"] as const;

type ShareType = "timed" | "session";

type SharesColors = ReturnType<typeof mobileThemeColors>;

async function createShareLink(options: {
  fetchImpl: MobileFetch | null;
  canCreate: boolean;
  isFolder: boolean;
  itemId: string;
  itemName: string;
  parentId: string;
  shareType: ShareType;
  duration: (typeof durationOptions)[number];
  loginRequired: boolean;
  preventDownload: boolean;
  hasWatermark: boolean;
  watermarkText: string;
  maxUses: string;
  setWorking: (working: boolean) => void;
  setError: (error: string | null) => void;
  setCreatedUrl: (url: string | null) => void;
  refreshLinks: (fetchImpl: MobileFetch) => Promise<void>;
}): Promise<void> {
  const { fetchImpl } = options;
  if (!fetchImpl || !options.canCreate) return;
  options.setWorking(true);
  options.setError(null);
  try {
    const body = {
      path: options.isFolder
        ? `/folder/${options.itemId}`
        : `/folder/${options.parentId}/file/${options.itemId}/${makeSlug(options.itemName)}`,
      itemName: options.itemName,
      type: options.shareType,
      expiresIn: options.shareType === "session" ? "365d" : options.duration,
      loginRequired: options.loginRequired,
      preventDownload: options.preventDownload,
      hasWatermark: options.hasWatermark,
      watermarkText: options.hasWatermark ? options.watermarkText : null,
      maxUses: options.maxUses.trim()
        ? Number.parseInt(options.maxUses, 10)
        : null,
    } as const;
    const response = await createMobileShareLink(fetchImpl, body);
    options.setCreatedUrl(response.shareableUrl ?? null);
    await options.refreshLinks(fetchImpl);
  } catch (cause) {
    options.setError(
      cause instanceof Error
        ? cause.message
        : "Could not create this share link.",
    );
  } finally {
    options.setWorking(false);
  }
}

function ShareLinkCreateForm(
  props: Readonly<{
    colors: SharesColors;
    itemName: string;
    canCreate: boolean;
    shareType: ShareType;
    setShareType: (type: ShareType) => void;
    duration: (typeof durationOptions)[number];
    setDuration: (duration: (typeof durationOptions)[number]) => void;
    loginRequired: boolean;
    setLoginRequired: (value: boolean) => void;
    preventDownload: boolean;
    setPreventDownload: (value: boolean) => void;
    hasWatermark: boolean;
    setHasWatermark: (value: boolean) => void;
    watermarkText: string;
    setWatermarkText: (value: string) => void;
    maxUses: string;
    setMaxUses: (value: string) => void;
    working: boolean;
    onCreate: () => void;
    createdUrl: string | null;
    onShareCreated: () => void;
  }>,
) {
  return (
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
        Create a link for {props.itemName || "a selected file"}
      </Text>
      {!props.canCreate ? (
        <Text style={[styles.cardText, { color: props.colors.muted }]}>
          Open a file or folder first, then choose Share.
        </Text>
      ) : null}
      <Text style={[styles.label, { color: props.colors.foreground }]}>
        Link lifetime
      </Text>
      <View style={styles.choiceRow}>
        <ChoicePill
          label="Timed"
          selected={props.shareType === "timed"}
          onPress={() => props.setShareType("timed")}
        />
        <ChoicePill
          label="Session"
          selected={props.shareType === "session"}
          onPress={() => props.setShareType("session")}
        />
      </View>
      {props.shareType === "timed" ? (
        <View style={styles.choiceRow}>
          {durationOptions.map((option) => (
            <ChoicePill
              key={option}
              label={option}
              selected={props.duration === option}
              onPress={() => props.setDuration(option)}
            />
          ))}
        </View>
      ) : (
        <Text style={[styles.cardText, { color: props.colors.muted }]}>
          Session links use the server&apos;s session lifetime.
        </Text>
      )}
      <SettingRow
        label="Require recipient sign-in"
        value={props.loginRequired}
        onValueChange={props.setLoginRequired}
      />
      <SettingRow
        label="Prevent downloads"
        value={props.preventDownload}
        onValueChange={props.setPreventDownload}
      />
      <SettingRow
        label="Add watermark"
        value={props.hasWatermark}
        onValueChange={props.setHasWatermark}
      />
      {props.hasWatermark ? (
        <TextInput
          accessibilityLabel="Watermark text"
          placeholder="Watermark text"
          placeholderTextColor={props.colors.muted}
          value={props.watermarkText}
          onChangeText={props.setWatermarkText}
          style={[
            styles.input,
            {
              color: props.colors.foreground,
              borderColor: props.colors.border,
            },
          ]}
        />
      ) : null}
      <TextInput
        accessibilityLabel="Maximum uses"
        keyboardType="number-pad"
        placeholder="Maximum uses (optional)"
        placeholderTextColor={props.colors.muted}
        value={props.maxUses}
        onChangeText={props.setMaxUses}
        style={[
          styles.input,
          {
            color: props.colors.foreground,
            borderColor: props.colors.border,
          },
        ]}
      />
      <Pressable
        style={[
          styles.primaryButton,
          (props.working || !props.canCreate) && styles.disabled,
        ]}
        disabled={props.working || !props.canCreate}
        onPress={props.onCreate}
      >
        <Text style={styles.primaryButtonText}>
          {props.working ? "Creating…" : "Create share link"}
        </Text>
      </Pressable>
      {props.createdUrl ? (
        <View style={styles.createdCard}>
          <Text style={styles.createdUrl} selectable>
            {props.createdUrl}
          </Text>
          <Pressable
            style={styles.secondaryButton}
            onPress={props.onShareCreated}
          >
            <Text style={styles.secondaryButtonText}>Share link…</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function ShareLinkList(
  props: Readonly<{
    colors: SharesColors;
    links: ShareLink[];
    working: boolean;
    revokedJtis: Set<string>;
    getUrl: (link: ShareLink) => string | null;
    onShare: (url: string) => void;
    onConfirmRevoke: (link: ShareLink) => void;
    onConfirmDelete: (link: ShareLink) => void;
  }>,
) {
  return (
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
        Active links
      </Text>
      {props.links.map((link, index) => {
        const url = props.getUrl(link);
        const expiry = link.expiresAt
          ? `Expires ${new Date(link.expiresAt).toLocaleString()}`
          : "No expiry";
        const views =
          typeof link.viewCount === "number"
            ? ` · ${link.viewCount} views`
            : "";
        const revokeLabel =
          link.jti && props.revokedJtis.has(link.jti) ? "Revoked" : "Revoke";
        return (
          <View
            key={link.jti ?? link.id ?? `${link.path}-${index}`}
            style={[styles.linkCard, { borderColor: props.colors.border }]}
          >
            <Text
              style={[styles.linkTitle, { color: props.colors.foreground }]}
              numberOfLines={2}
            >
              {link.itemName ?? "Shared item"}
            </Text>
            <Text style={[styles.cardText, { color: props.colors.muted }]}>
              {expiry}
              {views}
            </Text>
            {url ? (
              <Pressable
                style={styles.secondaryButton}
                onPress={() => props.onShare(url)}
              >
                <Text style={styles.secondaryButtonText}>Share…</Text>
              </Pressable>
            ) : null}
            <View style={styles.choiceRow}>
              <Pressable
                style={styles.secondaryButton}
                disabled={props.working || !link.jti}
                onPress={() => props.onConfirmRevoke(link)}
              >
                <Text style={styles.secondaryButtonText}>{revokeLabel}</Text>
              </Pressable>
              <Pressable
                style={styles.secondaryButton}
                disabled={props.working || !link.jti}
                onPress={() => props.onConfirmDelete(link)}
              >
                <Text
                  style={[styles.secondaryButtonText, { color: "#b42318" }]}
                >
                  Delete
                </Text>
              </Pressable>
            </View>
          </View>
        );
      })}
      {!props.links.length ? (
        <Text style={[styles.cardText, { color: props.colors.muted }]}>
          No share links yet.
        </Text>
      ) : null}
    </View>
  );
}

function SharesRouteContent(
  props: Readonly<{
    colors: SharesColors;
    error: string | null;
    loading: boolean;
    role: string;
    createMode: boolean;
    createForm: React.ComponentProps<typeof ShareLinkCreateForm>;
    linkList: React.ComponentProps<typeof ShareLinkList>;
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
          Share link management requires an administrator account.
        </Text>
      ) : null}
      {!props.loading && props.role === "ADMIN" && props.createMode ? (
        <ShareLinkCreateForm {...props.createForm} />
      ) : null}
      {!props.loading && props.role === "ADMIN" ? (
        <ShareLinkList {...props.linkList} />
      ) : null}
    </>
  );
}

async function runShareLinkAction(options: {
  fetchImpl: MobileFetch | null;
  link: ShareLink;
  action: (fetchImpl: MobileFetch, link: ShareLink) => Promise<void>;
  onSuccess: () => void;
  fallbackError: string;
  setWorking: (working: boolean) => void;
  setError: (error: string | null) => void;
}): Promise<void> {
  const { fetchImpl, link } = options;
  if (!fetchImpl || !link.jti || !link.expiresAt) return;
  options.setWorking(true);
  options.setError(null);
  try {
    await options.action(fetchImpl, link);
    options.onSuccess();
  } catch (cause) {
    options.setError(
      cause instanceof Error ? cause.message : options.fallbackError,
    );
  } finally {
    options.setWorking(false);
  }
}

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
    void loadActiveRouteSession({
      isActive: () => active,
      redirectToServer: () => router.replace("/"),
      setError,
    })
      .then(async (routeSession) => {
        if (!active || !routeSession) return;
        apiRef.current = routeSession.fetchImpl;
        setServer(routeSession.server);
        setRole(routeSession.role);
        await refreshLinks(routeSession.fetchImpl);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load share links.",
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

  const handleCreate = () =>
    createShareLink({
      fetchImpl: apiRef.current,
      canCreate,
      isFolder,
      itemId,
      itemName,
      parentId,
      shareType,
      duration,
      loginRequired,
      preventDownload,
      hasWatermark,
      watermarkText,
      maxUses,
      setWorking,
      setError,
      setCreatedUrl,
      refreshLinks,
    });

  const shareCreatedUrl = async () => {
    if (!createdUrl) return;
    await Share.share({ message: createdUrl });
  };

  const revoke = (link: ShareLink) =>
    runShareLinkAction({
      fetchImpl: apiRef.current,
      link,
      action: async (fetchImpl, target) => {
        await revokeMobileShareLink(fetchImpl, {
          jti: target.jti!,
          expiresAt: target.expiresAt!,
        });
      },
      onSuccess: () =>
        setRevokedJtis((current) => new Set(current).add(link.jti!)),
      fallbackError: "Could not revoke this link.",
      setWorking,
      setError,
    });

  const remove = (link: ShareLink) =>
    runShareLinkAction({
      fetchImpl: apiRef.current,
      link,
      action: async (fetchImpl, target) => {
        await deleteMobileShareLink(fetchImpl, {
          jti: target.jti!,
          expiresAt: target.expiresAt!,
        });
      },
      onSuccess: () =>
        setLinks((current) =>
          current.filter((entry) => entry.jti !== link.jti),
        ),
      fallbackError: "Could not delete this link.",
      setWorking,
      setError,
    });

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

        <SharesRouteContent
          colors={colors}
          error={error}
          loading={loading}
          role={role}
          createMode={params.mode === "create"}
          createForm={{
            colors,
            itemName,
            canCreate,
            shareType,
            setShareType,
            duration,
            setDuration,
            loginRequired,
            setLoginRequired,
            preventDownload,
            setPreventDownload,
            hasWatermark,
            setHasWatermark,
            watermarkText,
            setWatermarkText,
            maxUses,
            setMaxUses,
            working,
            onCreate: handleCreate,
            createdUrl,
            onShareCreated: shareCreatedUrl,
          }}
          linkList={{
            colors,
            links,
            working,
            revokedJtis,
            getUrl: shareLinkUrl,
            onShare: (url) => void Share.share({ message: url }),
            onConfirmRevoke: confirmRevoke,
            onConfirmDelete: confirmDelete,
          }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function SettingRow({
  label,
  value,
  onValueChange,
}: Readonly<{
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}>) {
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
