import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { adminJsonRequest, adminRequest } from "../lib/admin-api";
import type { ServerFetch } from "../lib/api-client";
import { mobileThemeColors } from "../lib/mobile-theme";
import { useMobilePreferences } from "../lib/mobile-preferences";
import type { ServerBookmark } from "../lib/servers";
import {
  AdminSectionContent,
  type AdminSection,
  type ConfigDraft,
} from "./admin-section-content";
import { styles } from "./admin-styles";
import { loadActiveRouteSession } from "./route-session";

const adminSections: { id: AdminSection; label: string; path: string }[] = [
  { id: "overview", label: "Overview", path: "/api/admin/stats" },
  {
    id: "analytics",
    label: "Analytics",
    path: "/api/admin/analytics/enhanced",
  },
  { id: "health", label: "System health", path: "/api/admin/system-health" },
  { id: "logs", label: "Live logs", path: "/api/admin/logs?offset=0" },
  {
    id: "activity",
    label: "Activity",
    path: "/api/admin/activity-log?page=1&limit=50",
  },
  { id: "security", label: "Security", path: "/api/admin/logs/security" },
  { id: "audit", label: "Audit", path: "/api/admin/audit" },
  { id: "users", label: "Administrators", path: "/api/admin/users" },
  { id: "editors", label: "Editors", path: "/api/admin/editors" },
  { id: "drives", label: "Storage drives", path: "/api/admin/manual-drives" },
  { id: "access", label: "Folder access", path: "/api/admin/user-access" },
  {
    id: "incidents",
    label: "Incidents",
    path: "/api/admin/incidents?limit=50&offset=0",
  },
  { id: "config", label: "Configuration", path: "/api/admin/config" },
  { id: "cache", label: "Cache", path: "/api/admin/cache-stats" },
];

type AdminRecord = Record<string, unknown>;

async function loadAdminSection(
  section: AdminSection,
  fetchImpl: ServerFetch,
): Promise<unknown> {
  if (section === "access") {
    const [permissions, requests] = await Promise.all([
      adminRequest<Record<string, string[]>>(
        fetchImpl,
        "/api/admin/user-access",
      ),
      adminRequest<AdminRecord[]>(fetchImpl, "/api/admin/access-requests"),
    ]);
    return { permissions, requests };
  }
  const selected = adminSections.find((item) => item.id === section);
  if (!selected) throw new Error("Unknown admin section.");
  return adminRequest(fetchImpl, selected.path);
}

function asRecord(value: unknown): AdminRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as AdminRecord)
    : {};
}

function isAdminEmail(value: string): boolean {
  if (/\s/.test(value)) return false;
  const atIndex = value.indexOf("@");
  if (atIndex <= 0 || atIndex !== value.lastIndexOf("@")) return false;
  const domainDot = value.indexOf(".", atIndex + 2);
  return domainDot > atIndex + 1 && domainDot < value.length - 1;
}

function adminErrorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function readConfigDraft(value: unknown): ConfigDraft {
  const config = asRecord(value);
  return {
    appName: typeof config.appName === "string" ? config.appName : "",
    logoUrl: typeof config.logoUrl === "string" ? config.logoUrl : "",
    faviconUrl: typeof config.faviconUrl === "string" ? config.faviconUrl : "",
    primaryColor:
      typeof config.primaryColor === "string" ? config.primaryColor : "",
    hideAuthor: config.hideAuthor === true,
    disableGuestLogin: config.disableGuestLogin === true,
    localStorageAuthEnabled: config.localStorageAuthEnabled === true,
  };
}

async function refreshAdminSection(options: {
  fetchImpl: ServerFetch | null;
  section: AdminSection;
  setData: Dispatch<SetStateAction<unknown>>;
  setConfigDraft: Dispatch<SetStateAction<ConfigDraft>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
}): Promise<void> {
  if (!options.fetchImpl) return;
  options.setLoading(true);
  options.setError(null);
  try {
    const next = await loadAdminSection(options.section, options.fetchImpl);
    options.setData(next);
    if (options.section === "config") {
      options.setConfigDraft(readConfigDraft(next));
    }
  } catch (cause) {
    options.setError(
      adminErrorMessage(cause, "Could not load this admin section."),
    );
  } finally {
    options.setLoading(false);
  }
}

async function executeAdminAction(options: {
  fetchImpl: ServerFetch | null;
  section: AdminSection;
  path: string;
  init: RequestInit;
  after?: () => void;
  reload: boolean;
  setData: Dispatch<SetStateAction<unknown>>;
  setWorking: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
}): Promise<void> {
  if (!options.fetchImpl) return;
  options.setWorking(true);
  options.setError(null);
  try {
    await adminRequest(options.fetchImpl, options.path, options.init);
    options.after?.();
    if (options.reload) {
      options.setData(
        await loadAdminSection(options.section, options.fetchImpl),
      );
    }
  } catch (cause) {
    options.setError(
      adminErrorMessage(cause, "The server could not complete this operation."),
    );
  } finally {
    options.setWorking(false);
  }
}

async function scanAdminDrives(options: {
  fetchImpl: ServerFetch | null;
  setScanResults: Dispatch<SetStateAction<AdminRecord[]>>;
  setWorking: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
}): Promise<void> {
  if (!options.fetchImpl) return;
  options.setWorking(true);
  options.setError(null);
  try {
    options.setScanResults(
      await adminRequest(options.fetchImpl, "/api/admin/drives/scan"),
    );
  } catch (cause) {
    options.setError(adminErrorMessage(cause, "Could not scan drives."));
  } finally {
    options.setWorking(false);
  }
}

function beginAdminSession(options: {
  redirectToServer: () => void;
  setServer: Dispatch<SetStateAction<ServerBookmark | null>>;
  setRole: Dispatch<SetStateAction<string>>;
  setAdminFetch: Dispatch<SetStateAction<ServerFetch | null>>;
  setData: Dispatch<SetStateAction<unknown>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
}): () => void {
  let active = true;
  void loadActiveRouteSession({
    isActive: () => active,
    redirectToServer: options.redirectToServer,
    setError: options.setError,
  })
    .then(async (routeSession) => {
      if (!active || !routeSession) return;
      options.setServer(routeSession.server);
      options.setRole(routeSession.role);
      if (routeSession.role !== "ADMIN") return;
      options.setAdminFetch(() => routeSession.fetchImpl);
      const overview = await loadAdminSection(
        "overview",
        routeSession.fetchImpl,
      );
      if (active) options.setData(overview);
    })
    .catch((cause: unknown) => {
      if (active) {
        options.setError(
          adminErrorMessage(cause, "Could not connect to the server."),
        );
      }
    })
    .finally(() => {
      if (active) options.setLoading(false);
    });
  return () => {
    active = false;
  };
}

export default function AdminRoute() {
  const router = useRouter();
  const { theme } = useMobilePreferences();
  const colors = mobileThemeColors(theme === "dark");
  const [adminFetch, setAdminFetch] = useState<ServerFetch | null>(null);
  const [server, setServer] = useState<ServerBookmark | null>(null);
  const [role, setRole] = useState("");
  const [section, setSection] = useState<AdminSection>("overview");
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [driveId, setDriveId] = useState("");
  const [driveName, setDriveName] = useState("");
  const [drivePassword, setDrivePassword] = useState("");
  const [scanResults, setScanResults] = useState<AdminRecord[]>([]);
  const [accessFolderId, setAccessFolderId] = useState("");
  const [accessEmail, setAccessEmail] = useState("");
  const [localStoragePassword, setLocalStoragePassword] = useState("");
  const [configDraft, setConfigDraft] = useState<ConfigDraft>({
    appName: "",
    logoUrl: "",
    faviconUrl: "",
    primaryColor: "",
    hideAuthor: false,
    disableGuestLogin: false,
    localStorageAuthEnabled: false,
  });

  const refresh = (selected: AdminSection = section) =>
    refreshAdminSection({
      fetchImpl: adminFetch,
      section: selected,
      setData,
      setConfigDraft,
      setLoading,
      setError,
    });

  useEffect(
    () =>
      beginAdminSession({
        redirectToServer: () => router.replace("/"),
        setServer,
        setRole,
        setAdminFetch,
        setData,
        setError,
        setLoading,
      }),
    [router],
  );

  const execute = (
    path: string,
    init: RequestInit,
    after?: () => void,
    reload = true,
  ) =>
    executeAdminAction({
      fetchImpl: adminFetch,
      section,
      path,
      init,
      after,
      reload,
      setData,
      setWorking,
      setError,
    });

  const chooseSection = async (next: AdminSection) => {
    setSection(next);
    await refresh(next);
  };

  const confirm = (title: string, message: string, action: () => void) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      { text: "Continue", style: "destructive", onPress: action },
    ]);
  };

  const saveEmail = async (kind: "users" | "editors") => {
    const value = email.trim();
    if (!isAdminEmail(value)) {
      setError("Enter a valid email address.");
      return;
    }
    await execute(
      `/api/admin/${kind}`,
      adminJsonRequest("POST", { email: value }),
      () => setEmail(""),
    );
  };

  const scanDrives = () =>
    scanAdminDrives({
      fetchImpl: adminFetch,
      setScanResults,
      setWorking,
      setError,
    });

  const button = (
    title: string,
    onPress: () => void,
    options: { secondary?: boolean } = {},
  ) => (
    <Pressable
      accessibilityRole="button"
      disabled={working}
      onPress={onPress}
      style={[
        options.secondary ? styles.secondaryButton : styles.primaryButton,
        working && styles.disabled,
      ]}
    >
      <Text
        style={
          options.secondary
            ? styles.secondaryButtonText
            : styles.primaryButtonText
        }
      >
        {title}
      </Text>
    </Pressable>
  );

  const renderSection = () => (
    <AdminSectionContent
      section={section}
      sectionLabel={
        adminSections.find((item) => item.id === section)?.label ?? ""
      }
      data={data}
      colors={colors}
      working={working}
      email={email}
      setEmail={setEmail}
      saveEmail={saveEmail}
      execute={execute}
      confirm={confirm}
      driveId={driveId}
      setDriveId={setDriveId}
      driveName={driveName}
      setDriveName={setDriveName}
      drivePassword={drivePassword}
      setDrivePassword={setDrivePassword}
      scanResults={scanResults}
      setScanResults={setScanResults}
      scanDrives={scanDrives}
      accessFolderId={accessFolderId}
      setAccessFolderId={setAccessFolderId}
      accessEmail={accessEmail}
      setAccessEmail={setAccessEmail}
      localStoragePassword={localStoragePassword}
      setLocalStoragePassword={setLocalStoragePassword}
      configDraft={configDraft}
      setConfigDraft={setConfigDraft}
    />
  );

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
              Administration
            </Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>
              {server?.label ?? "Server"}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={loading || working}
            onPress={() => void refresh()}
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
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              Administrator access required
            </Text>
            <Text style={{ color: colors.muted }}>
              This account does not have the server administrator role.
            </Text>
          </View>
        ) : null}
        {role === "ADMIN" ? (
          <>
            <View style={styles.quickLinks}>
              {button("File requests", () => router.push("/requests"), {
                secondary: true,
              })}
              {button("Trash", () => router.push("/trash"), {
                secondary: true,
              })}
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tabs}
            >
              {adminSections.map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: section === item.id }}
                  onPress={() => void chooseSection(item.id)}
                  style={[
                    styles.tab,
                    {
                      borderColor: colors.border,
                      backgroundColor:
                        section === item.id ? "#1f6f78" : colors.surface,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.tabText,
                      {
                        color: section === item.id ? "#fff" : colors.foreground,
                      },
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            {working ? <ActivityIndicator color="#1f6f78" /> : null}
            {renderSection()}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
