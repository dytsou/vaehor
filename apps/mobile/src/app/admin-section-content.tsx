import type { Dispatch, SetStateAction } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import { adminJsonRequest, redactAdminData } from "../lib/admin-api";
import { mobileThemeColors } from "../lib/mobile-theme";
import { styles } from "./admin-styles";

export type AdminSection =
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

export type ConfigDraft = {
  appName: string;
  logoUrl: string;
  faviconUrl: string;
  primaryColor: string;
  hideAuthor: boolean;
  disableGuestLogin: boolean;
  localStorageAuthEnabled: boolean;
};

type AdminRecord = Record<string, unknown>;

type AdminSectionContentProps = {
  section: AdminSection;
  sectionLabel: string;
  data: unknown;
  colors: ReturnType<typeof mobileThemeColors>;
  working: boolean;
  email: string;
  setEmail: (value: string) => void;
  saveEmail: (kind: "users" | "editors") => Promise<void>;
  execute: (
    path: string,
    init: RequestInit,
    after?: () => void,
    reload?: boolean,
  ) => Promise<void>;
  confirm: (title: string, message: string, action: () => void) => void;
  driveId: string;
  setDriveId: (value: string) => void;
  driveName: string;
  setDriveName: (value: string) => void;
  drivePassword: string;
  setDrivePassword: (value: string) => void;
  scanResults: AdminRecord[];
  setScanResults: Dispatch<SetStateAction<AdminRecord[]>>;
  scanDrives: () => Promise<void>;
  accessFolderId: string;
  setAccessFolderId: (value: string) => void;
  accessEmail: string;
  setAccessEmail: (value: string) => void;
  localStoragePassword: string;
  setLocalStoragePassword: (value: string) => void;
  configDraft: ConfigDraft;
  setConfigDraft: Dispatch<SetStateAction<ConfigDraft>>;
};

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

export function AdminSectionContent(props: AdminSectionContentProps) {
  const {
    section,
    sectionLabel,
    data,
    colors,
    working,
    email,
    setEmail,
    saveEmail,
    execute,
    confirm,
    driveId,
    setDriveId,
    driveName,
    setDriveName,
    drivePassword,
    setDrivePassword,
    scanResults,
    setScanResults,
    scanDrives,
    accessFolderId,
    setAccessFolderId,
    accessEmail,
    setAccessEmail,
    localStoragePassword,
    setLocalStoragePassword,
    configDraft,
    setConfigDraft,
  } = props;

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
          {sectionLabel}
        </Text>
        {jsonPanel()}
      </View>
    );
  };

  return renderSection();
}
