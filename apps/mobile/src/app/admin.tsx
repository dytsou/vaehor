import { useEffect, useState } from "react";
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
import { createServerFetch, type ServerFetch } from "../lib/api-client";
import { mobileThemeColors } from "../lib/mobile-theme";
import { useMobilePreferences } from "../lib/mobile-preferences";
import { listMobileDrives } from "../lib/file-api";
import {
  getActiveServer,
  preferencesStore,
  type ServerBookmark,
} from "../lib/servers";
import { loadBiometricServerSession } from "../lib/biometric-session";
import {
  AdminSectionContent,
  type AdminSection,
  type ConfigDraft,
} from "./admin-section-content";
import { styles } from "./admin-styles";

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

  const refresh = async (selected: AdminSection = section) => {
    if (!adminFetch) return;
    setLoading(true);
    setError(null);
    try {
      const next = await loadAdminSection(selected, adminFetch);
      setData(next);
      if (selected === "config") {
        const config = asRecord(next);
        setConfigDraft({
          appName: typeof config.appName === "string" ? config.appName : "",
          logoUrl: typeof config.logoUrl === "string" ? config.logoUrl : "",
          faviconUrl:
            typeof config.faviconUrl === "string" ? config.faviconUrl : "",
          primaryColor:
            typeof config.primaryColor === "string" ? config.primaryColor : "",
          hideAuthor: config.hideAuthor === true,
          disableGuestLogin: config.disableGuestLogin === true,
          localStorageAuthEnabled: config.localStorageAuthEnabled === true,
        });
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not load this admin section.",
      );
    } finally {
      setLoading(false);
    }
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
        const driveResult = await listMobileDrives(fetchImpl);
        if (!active) return;
        setServer(selected);
        setRole(driveResult.role.toUpperCase());
        if (driveResult.role.toUpperCase() !== "ADMIN") {
          setLoading(false);
          return;
        }
        setAdminFetch(() => fetchImpl);
        const overview = await loadAdminSection("overview", fetchImpl);
        if (active) setData(overview);
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not connect to the server.",
          );
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [router]);

  const execute = async (
    path: string,
    init: RequestInit,
    after?: () => void,
    reload = true,
  ) => {
    if (!adminFetch) return;
    setWorking(true);
    setError(null);
    try {
      await adminRequest(adminFetch, path, init);
      after?.();
      if (reload) setData(await loadAdminSection(section, adminFetch));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The server could not complete this operation.",
      );
    } finally {
      setWorking(false);
    }
  };

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
    if (!/^\S+@\S+\.\S+$/.test(value)) {
      setError("Enter a valid email address.");
      return;
    }
    await execute(
      `/api/admin/${kind}`,
      adminJsonRequest("POST", { email: value }),
      () => setEmail(""),
    );
  };

  const scanDrives = async () => {
    if (!adminFetch) return;
    setWorking(true);
    setError(null);
    try {
      setScanResults(await adminRequest(adminFetch, "/api/admin/drives/scan"));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not scan drives.",
      );
    } finally {
      setWorking(false);
    }
  };

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
