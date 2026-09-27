import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import {
  adminJsonRequest,
  adminRequest,
  redactAdminData,
} from "../lib/admin-api";
import { createServerFetch, type ServerFetch } from "../lib/api-client";
import { mobileThemeColors } from "../lib/mobile-theme";
import { useMobilePreferences } from "../lib/mobile-preferences";
import { listMobileDrives } from "../lib/file-api";
import {
  getActiveServer,
  preferencesStore,
  type ServerBookmark,
} from "../lib/servers";
import { loadSessionForServer } from "../lib/session-store";

type AdminSection =
  | "overview"
  | "analytics"
  | "health"
  | "logs"
  | "activity"
  | "security"
  | "audit"
  | "users"
  | "editors"
  | "drives"
  | "access"
  | "incidents"
  | "config"
  | "cache";

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

type ConfigDraft = {
  appName: string;
  logoUrl: string;
  faviconUrl: string;
  primaryColor: string;
  hideAuthor: boolean;
  disableGuestLogin: boolean;
  localStorageAuthEnabled: boolean;
};

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

function asRecordArray(value: unknown): AdminRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is AdminRecord =>
          Boolean(item) && typeof item === "object",
      )
    : [];
}

function formatData(value: unknown): string {
  try {
    return (
      JSON.stringify(redactAdminData(value), null, 2)?.slice(0, 24_000) ??
      "No data."
    );
  } catch {
    return "No data.";
  }
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
        const token = await loadSessionForServer(selected.url);
        if (!active) return;
        if (!token) {
          router.replace("/");
          return;
        }
        const fetchImpl = createServerFetch(selected.url, token);
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

  const emailRows = Array.isArray(data)
    ? data.filter((value): value is string => typeof value === "string")
    : [];
  const record = asRecord(data);
  const access = asRecord(data);
  const permissions = asRecord(access.permissions);
  const accessRequests = asRecordArray(access.requests);
  const incidents = asRecordArray(record.incidents);

  const field = (
    label: string,
    value: string,
    onChangeText: (text: string) => void,
    options: {
      secure?: boolean;
      autoCapitalize?: "none" | "sentences";
      keyboardType?: "default" | "email-address" | "url";
    } = {},
  ) => (
    <TextInput
      accessibilityLabel={label}
      autoCapitalize={options.autoCapitalize ?? "none"}
      autoCorrect={false}
      keyboardType={options.keyboardType}
      secureTextEntry={options.secure}
      value={value}
      onChangeText={onChangeText}
      placeholder={label}
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
  );

  const button = (
    title: string,
    onPress: () => void,
    options: {
      secondary?: boolean;
      destructive?: boolean;
      disabled?: boolean;
    } = {},
  ) => (
    <Pressable
      accessibilityRole="button"
      disabled={working || options.disabled}
      onPress={onPress}
      style={[
        options.secondary ? styles.secondaryButton : styles.primaryButton,
        (working || options.disabled) && styles.disabled,
      ]}
    >
      <Text
        style={[
          options.secondary
            ? styles.secondaryButtonText
            : styles.primaryButtonText,
          options.destructive && styles.destructiveText,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );

  const jsonPanel = (value: unknown = data) => (
    <Text
      selectable
      style={[
        styles.json,
        {
          color: colors.foreground,
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      {formatData(value)}
    </Text>
  );

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

  const renderSection = () => {
    if (section === "users" || section === "editors") {
      return (
        <>
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              Add {section === "users" ? "administrator" : "editor"}
            </Text>
            {field("Email address", email, setEmail, {
              keyboardType: "email-address",
            })}
            {button("Add email", () => void saveEmail(section), {
              disabled: !email.trim(),
            })}
          </View>
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              {section === "users" ? "Administrators" : "Editors"} (
              {emailRows.length})
            </Text>
            {emailRows.map((value) => (
              <View
                key={value}
                style={[styles.row, { borderColor: colors.border }]}
              >
                <Text
                  selectable
                  style={[styles.rowText, { color: colors.foreground }]}
                >
                  {value}
                </Text>
                {button(
                  "Remove",
                  () =>
                    confirm(
                      "Remove access?",
                      `${value} will lose ${section === "users" ? "administrator" : "editor"} access.`,
                      () =>
                        void execute(
                          `/api/admin/${section}`,
                          adminJsonRequest("DELETE", { email: value }),
                        ),
                    ),
                  { secondary: true, destructive: true },
                )}
              </View>
            ))}
            {!emailRows.length ? (
              <Text style={{ color: colors.muted }}>No entries.</Text>
            ) : null}
          </View>
        </>
      );
    }

    if (section === "drives") {
      const drives = asRecordArray(data);
      const addDrive = async (id = driveId, name = driveName) => {
        if (!id.trim() || !name.trim()) return;
        await execute(
          "/api/admin/manual-drives",
          adminJsonRequest("POST", {
            id: id.trim(),
            name: name.trim(),
            ...(drivePassword ? { password: drivePassword } : {}),
          }),
          () => {
            setDriveId("");
            setDriveName("");
            setDrivePassword("");
            setScanResults([]);
          },
        );
      };
      return (
        <>
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              Add a storage drive
            </Text>
            {field("Drive or folder ID", driveId, setDriveId)}
            {field("Display name", driveName, setDriveName, {
              autoCapitalize: "sentences",
            })}
            {field(
              "Optional access password",
              drivePassword,
              setDrivePassword,
              { secure: true },
            )}
            {button("Add drive", () => void addDrive(), {
              disabled: !driveId.trim() || !driveName.trim(),
            })}
            {button("Scan shared drives", () => void scanDrives(), {
              secondary: true,
            })}
            {scanResults.map((candidate) => (
              <View
                key={String(candidate.id)}
                style={[styles.row, { borderColor: colors.border }]}
              >
                <Text style={[styles.rowText, { color: colors.foreground }]}>
                  {String(candidate.name ?? candidate.id)} ·{" "}
                  {String(candidate.kind ?? "drive")}
                </Text>
                {button(
                  "Add",
                  () =>
                    void addDrive(
                      String(candidate.id ?? ""),
                      String(candidate.name ?? "Drive"),
                    ),
                  { secondary: true },
                )}
              </View>
            ))}
          </View>
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              Configured drives
            </Text>
            {drives.map((drive, index) => (
              <View
                key={String(drive.id ?? index)}
                style={[styles.row, { borderColor: colors.border }]}
              >
                <View style={styles.rowBody}>
                  <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                    {String(drive.name ?? drive.id ?? "Drive")}
                  </Text>
                  <Text
                    selectable
                    style={[styles.rowMeta, { color: colors.muted }]}
                  >
                    {String(drive.id ?? "")}
                    {drive.isProtected ? " · password protected" : ""}
                  </Text>
                </View>
                {button(
                  "Remove",
                  () =>
                    confirm(
                      "Remove drive?",
                      `${String(drive.name ?? drive.id)} will be removed from the configured list.`,
                      () =>
                        void execute(
                          "/api/admin/manual-drives",
                          adminJsonRequest("DELETE", { id: drive.id }),
                        ),
                    ),
                  { secondary: true, destructive: true },
                )}
              </View>
            ))}
            {!drives.length ? (
              <Text style={{ color: colors.muted }}>
                No manual drives configured.
              </Text>
            ) : null}
          </View>
        </>
      );
    }

    if (section === "access") {
      return (
        <>
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              Grant folder access
            </Text>
            {field("Folder ID", accessFolderId, setAccessFolderId)}
            {field("User email", accessEmail, setAccessEmail, {
              keyboardType: "email-address",
            })}
            {button(
              "Grant access",
              () =>
                void execute(
                  "/api/admin/user-access",
                  adminJsonRequest("POST", {
                    folderId: accessFolderId.trim(),
                    email: accessEmail.trim(),
                  }),
                  () => {
                    setAccessFolderId("");
                    setAccessEmail("");
                  },
                ),
              { disabled: !accessFolderId.trim() || !accessEmail.trim() },
            )}
          </View>
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              Granted access
            </Text>
            {Object.entries(permissions).map(([id, emails]) => (
              <View
                key={id}
                style={[styles.accessGroup, { borderColor: colors.border }]}
              >
                <Text
                  selectable
                  style={[styles.rowTitle, { color: colors.foreground }]}
                >
                  {id}
                </Text>
                {(Array.isArray(emails) ? emails : []).map((value) => (
                  <View key={`${id}-${value}`} style={styles.row}>
                    <Text
                      selectable
                      style={[styles.rowText, { color: colors.muted }]}
                    >
                      {value}
                    </Text>
                    {button(
                      "Remove",
                      () =>
                        confirm(
                          "Remove folder access?",
                          `${value} will lose access to this folder.`,
                          () =>
                            void execute(
                              "/api/admin/user-access",
                              adminJsonRequest("DELETE", {
                                folderId: id,
                                email: value,
                              }),
                            ),
                        ),
                      { secondary: true, destructive: true },
                    )}
                  </View>
                ))}
              </View>
            ))}
            {!Object.keys(permissions).length ? (
              <Text style={{ color: colors.muted }}>
                No folder access grants.
              </Text>
            ) : null}
          </View>
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              Pending access requests ({accessRequests.length})
            </Text>
            {accessRequests.map((request, index) => (
              <View
                key={`${String(request.folderId)}-${String(request.email)}-${String(request.timestamp)}-${index}`}
                style={[styles.requestCard, { borderColor: colors.border }]}
              >
                <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                  {String(request.email ?? "Unknown email")}
                </Text>
                <Text
                  selectable
                  style={[styles.rowMeta, { color: colors.muted }]}
                >
                  {String(request.folderName ?? request.folderId ?? "Folder")}
                </Text>
                <View style={styles.buttonRow}>
                  {button(
                    "Approve",
                    () =>
                      void execute(
                        "/api/admin/access-requests",
                        adminJsonRequest("POST", {
                          action: "approve",
                          requestData: request,
                        }),
                      ),
                    { secondary: true },
                  )}
                  {button(
                    "Reject",
                    () =>
                      confirm(
                        "Reject request?",
                        "This access request will be removed.",
                        () =>
                          void execute(
                            "/api/admin/access-requests",
                            adminJsonRequest("POST", {
                              action: "reject",
                              requestData: request,
                            }),
                          ),
                      ),
                    { secondary: true, destructive: true },
                  )}
                </View>
              </View>
            ))}
            {!accessRequests.length ? (
              <Text style={{ color: colors.muted }}>No pending requests.</Text>
            ) : null}
          </View>
        </>
      );
    }

    if (section === "incidents") {
      return (
        <>
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              Incident status
            </Text>
            <Text style={{ color: colors.muted }}>
              {String(record.openCount ?? 0)} open ·{" "}
              {String(record.total ?? incidents.length)} total
            </Text>
            {button(
              "Evaluate current incidents",
              () =>
                void execute(
                  "/api/admin/incidents/evaluate",
                  adminJsonRequest("POST", {}),
                ),
              { secondary: true },
            )}
          </View>
          {incidents.map((incident, index) => (
            <View
              key={String(incident.id ?? index)}
              style={[
                styles.card,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                {String(
                  incident.title ??
                    incident.message ??
                    incident.type ??
                    "Incident",
                )}
              </Text>
              <Text style={[styles.rowMeta, { color: colors.muted }]}>
                {String(incident.status ?? "open")} ·{" "}
                {String(incident.createdAt ?? incident.timestamp ?? "")}
              </Text>
              {jsonPanel(incident)}
              <View style={styles.buttonRow}>
                {(["open", "acknowledged", "resolved"] as const).map((status) =>
                  button(
                    status,
                    () =>
                      void execute(
                        "/api/admin/incidents",
                        adminJsonRequest("PATCH", { id: incident.id, status }),
                      ),
                    { secondary: true, disabled: incident.status === status },
                  ),
                )}
              </View>
            </View>
          ))}
          {!incidents.length ? (
            <Text style={{ color: colors.muted }}>No incidents reported.</Text>
          ) : null}
        </>
      );
    }

    if (section === "config") {
      const updateDraft = (key: keyof ConfigDraft, value: string | boolean) =>
        setConfigDraft((current) => ({ ...current, [key]: value }));
      return (
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Server presentation and access
          </Text>
          {field(
            "App name",
            configDraft.appName,
            (value) => updateDraft("appName", value),
            { autoCapitalize: "sentences" },
          )}
          {field(
            "Logo URL",
            configDraft.logoUrl,
            (value) => updateDraft("logoUrl", value),
            { keyboardType: "url" },
          )}
          {field(
            "Favicon URL",
            configDraft.faviconUrl,
            (value) => updateDraft("faviconUrl", value),
            { keyboardType: "url" },
          )}
          {field("Primary color (hex)", configDraft.primaryColor, (value) =>
            updateDraft("primaryColor", value),
          )}
          {(
            [
              ["Hide author", "hideAuthor"],
              ["Disable guest login", "disableGuestLogin"],
              ["Require local storage password", "localStorageAuthEnabled"],
            ] as const
          ).map(([label, key]) => (
            <View
              key={key}
              style={[styles.switchRow, { borderColor: colors.border }]}
            >
              <Text style={[styles.rowText, { color: colors.foreground }]}>
                {label}
              </Text>
              <Switch
                value={configDraft[key]}
                onValueChange={(value) => updateDraft(key, value)}
              />
            </View>
          ))}
          {configDraft.localStorageAuthEnabled
            ? field(
                "New local storage password (leave blank to keep current)",
                localStoragePassword,
                setLocalStoragePassword,
                { secure: true },
              )
            : null}
          {button(
            "Save configuration",
            () =>
              void execute(
                "/api/admin/config",
                adminJsonRequest("POST", {
                  ...configDraft,
                  ...(localStoragePassword.trim()
                    ? { localStoragePassword: localStoragePassword.trim() }
                    : {}),
                }),
                () => setLocalStoragePassword(""),
              ),
          )}
          <Text style={[styles.rowMeta, { color: colors.muted }]}>
            Passwords are never displayed by the server. Enter a new value only
            when you want to change it.
          </Text>
        </View>
      );
    }

    if (section === "cache") {
      return (
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Cache statistics
          </Text>
          {jsonPanel()}
          {button(
            "Clear file cache",
            () =>
              confirm(
                "Clear file cache?",
                "Cached file listings will be refreshed from storage.",
                () =>
                  void execute("/api/clearcache?target=files", {
                    method: "GET",
                  }),
              ),
            { secondary: true, destructive: true },
          )}
        </View>
      );
    }

    if (section === "audit") {
      return (
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Recent audit events
          </Text>
          {jsonPanel()}
          {button(
            "Clear audit log",
            () =>
              confirm(
                "Clear audit history?",
                "This permanently removes audit and recent activity entries.",
                () => void execute("/api/admin/audit", { method: "DELETE" }),
              ),
            { secondary: true, destructive: true },
          )}
        </View>
      );
    }

    return (
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          {adminSections.find((item) => item.id === section)?.label}
        </Text>
        {jsonPanel()}
      </View>
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

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 16, paddingBottom: 48, gap: 12 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
  },
  headerText: { flex: 1 },
  title: { fontSize: 21, fontWeight: "700" },
  subtitle: { fontSize: 13, marginTop: 2 },
  action: { color: "#1f6f78", fontSize: 15, fontWeight: "600" },
  error: {
    color: "#b42318",
    backgroundColor: "#fef3f2",
    padding: 12,
    borderRadius: 10,
  },
  tabs: { gap: 8, paddingVertical: 3 },
  tab: {
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderWidth: 1,
    borderRadius: 18,
  },
  tabText: { fontSize: 13, fontWeight: "600" },
  quickLinks: { flexDirection: "row", gap: 8 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 },
  sectionTitle: { fontSize: 16, fontWeight: "700" },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15,
  },
  primaryButton: {
    alignSelf: "flex-start",
    backgroundColor: "#1f6f78",
    borderRadius: 9,
    paddingHorizontal: 15,
    paddingVertical: 11,
  },
  primaryButtonText: { color: "#fff", fontWeight: "600" },
  secondaryButton: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  secondaryButtonText: { color: "#1f6f78", fontWeight: "600" },
  destructiveText: { color: "#b42318" },
  disabled: { opacity: 0.5 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: "600" },
  rowMeta: { fontSize: 12, lineHeight: 18 },
  rowText: { flex: 1, fontSize: 14 },
  buttonRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  accessGroup: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 7,
  },
  requestCard: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 8 },
  switchRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  json: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    fontFamily: "monospace",
    fontSize: 11,
    lineHeight: 15,
    overflow: "hidden",
  },
});
