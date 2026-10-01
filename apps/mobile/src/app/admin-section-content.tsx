import type { Dispatch, ReactNode, SetStateAction } from "react";
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
type AdminButtonOptions = Readonly<{
  secondary?: boolean;
  destructive?: boolean;
  disabled?: boolean;
}>;
type AdminButton = (
  title: string,
  onPress: () => void,
  options?: AdminButtonOptions,
) => ReactNode;
type AdminField = (
  label: string,
  value: string,
  onChangeText: (text: string) => void,
  options?: {
    secure?: boolean;
    autoCapitalize?: "none" | "sentences";
    keyboardType?: "default" | "email-address" | "url";
  },
) => ReactNode;

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

function adminDisplayValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

type PendingAccessRequestListProps = Readonly<{
  requests: AdminRecord[];
  colors: ReturnType<typeof mobileThemeColors>;
  button: AdminButton;
  confirm: AdminSectionContentProps["confirm"];
  execute: AdminSectionContentProps["execute"];
}>;

function PendingAccessRequestList({
  requests,
  colors,
  button,
  confirm,
  execute,
}: PendingAccessRequestListProps) {
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
        Pending access requests ({requests.length})
      </Text>
      {requests.map((request, index) => (
        <PendingAccessRequestRow
          key={`${adminDisplayValue(request.folderId)}-${adminDisplayValue(request.email)}-${adminDisplayValue(request.timestamp)}-${index}`}
          request={request}
          colors={colors}
          button={button}
          confirm={confirm}
          execute={execute}
        />
      ))}
      {!requests.length ? (
        <Text style={{ color: colors.muted }}>No pending requests.</Text>
      ) : null}
    </View>
  );
}

type PendingAccessRequestRowProps = Readonly<{
  request: AdminRecord;
  colors: ReturnType<typeof mobileThemeColors>;
  button: AdminButton;
  confirm: AdminSectionContentProps["confirm"];
  execute: AdminSectionContentProps["execute"];
}>;

function PendingAccessRequestRow({
  request,
  colors,
  button,
  confirm,
  execute,
}: PendingAccessRequestRowProps) {
  const approve = () =>
    void execute(
      "/api/admin/access-requests",
      adminJsonRequest("POST", { action: "approve", requestData: request }),
    );
  const reject = () =>
    confirm(
      "Reject request?",
      "This access request will be removed.",
      () =>
        void execute(
          "/api/admin/access-requests",
          adminJsonRequest("POST", { action: "reject", requestData: request }),
        ),
    );

  return (
    <View style={[styles.requestCard, { borderColor: colors.border }]}>
      <Text style={[styles.rowTitle, { color: colors.foreground }]}>
        {adminDisplayValue(request.email, "Unknown email")}
      </Text>
      <Text selectable style={[styles.rowMeta, { color: colors.muted }]}>
        {adminDisplayValue(
          request.folderName,
          adminDisplayValue(request.folderId, "Folder"),
        )}
      </Text>
      <View style={styles.buttonRow}>
        {button("Approve", approve, { secondary: true })}
        {button("Reject", reject, { secondary: true, destructive: true })}
      </View>
    </View>
  );
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

type AdminUsersSectionProps = Readonly<{
  section: "users" | "editors";
  emailRows: string[];
  email: string;
  setEmail: (value: string) => void;
  saveEmail: AdminSectionContentProps["saveEmail"];
  colors: AdminSectionContentProps["colors"];
  field: AdminField;
  button: AdminButton;
  confirm: AdminSectionContentProps["confirm"];
  execute: AdminSectionContentProps["execute"];
}>;

function renderAdminUsersSection(props: AdminUsersSectionProps): ReactNode {
  const {
    section,
    emailRows,
    email,
    setEmail,
    saveEmail,
    colors,
    field,
    button,
    confirm,
    execute,
  } = props;
  const roleName = section === "users" ? "administrator" : "editor";
  const listTitle = section === "users" ? "Administrators" : "Editors";
  return (
    <>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          Add {roleName}
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
          {listTitle} ({emailRows.length})
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
                  `${value} will lose ${roleName} access.`,
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

type AdminDrivesSectionProps = Readonly<{
  data: unknown;
  driveId: string;
  setDriveId: (value: string) => void;
  driveName: string;
  setDriveName: (value: string) => void;
  drivePassword: string;
  setDrivePassword: (value: string) => void;
  scanResults: AdminRecord[];
  setScanResults: Dispatch<SetStateAction<AdminRecord[]>>;
  scanDrives: () => Promise<void>;
  colors: AdminSectionContentProps["colors"];
  field: AdminField;
  button: AdminButton;
  execute: AdminSectionContentProps["execute"];
  confirm: AdminSectionContentProps["confirm"];
}>;

function renderAdminDrivesSection(props: AdminDrivesSectionProps): ReactNode {
  const drives = asRecordArray(props.data);
  const addDrive = async (id = props.driveId, name = props.driveName) => {
    if (!id.trim() || !name.trim()) return;
    await props.execute(
      "/api/admin/manual-drives",
      adminJsonRequest("POST", {
        id: id.trim(),
        name: name.trim(),
        ...(props.drivePassword ? { password: props.drivePassword } : {}),
      }),
      () => {
        props.setDriveId("");
        props.setDriveName("");
        props.setDrivePassword("");
        props.setScanResults([]);
      },
    );
  };
  return (
    <>
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
          Add a storage drive
        </Text>
        {props.field("Drive or folder ID", props.driveId, props.setDriveId)}
        {props.field("Display name", props.driveName, props.setDriveName, {
          autoCapitalize: "sentences",
        })}
        {props.field(
          "Optional access password",
          props.drivePassword,
          props.setDrivePassword,
          { secure: true },
        )}
        {props.button("Add drive", () => void addDrive(), {
          disabled: !props.driveId.trim() || !props.driveName.trim(),
        })}
        {props.button("Scan shared drives", () => void props.scanDrives(), {
          secondary: true,
        })}
        {props.scanResults.map((candidate, index) => (
          <View
            key={adminDisplayValue(candidate.id, String(index))}
            style={[styles.row, { borderColor: props.colors.border }]}
          >
            <Text style={[styles.rowText, { color: props.colors.foreground }]}>
              {adminDisplayValue(
                candidate.name,
                adminDisplayValue(candidate.id, "Drive"),
              )}{" "}
              · {adminDisplayValue(candidate.kind, "drive")}
            </Text>
            {props.button(
              "Add",
              () =>
                void addDrive(
                  adminDisplayValue(candidate.id),
                  adminDisplayValue(candidate.name, "Drive"),
                ),
              { secondary: true },
            )}
          </View>
        ))}
      </View>
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
          Configured drives
        </Text>
        {drives.map((drive, index) => (
          <View
            key={adminDisplayValue(drive.id, String(index))}
            style={[styles.row, { borderColor: props.colors.border }]}
          >
            <View style={styles.rowBody}>
              <Text
                style={[styles.rowTitle, { color: props.colors.foreground }]}
              >
                {adminDisplayValue(
                  drive.name,
                  adminDisplayValue(drive.id, "Drive"),
                )}
              </Text>
              <Text
                selectable
                style={[styles.rowMeta, { color: props.colors.muted }]}
              >
                {adminDisplayValue(drive.id)}
                {drive.isProtected ? " · password protected" : ""}
              </Text>
            </View>
            {props.button(
              "Remove",
              () =>
                props.confirm(
                  "Remove drive?",
                  `${adminDisplayValue(drive.name, adminDisplayValue(drive.id, "This drive"))} will be removed from the configured list.`,
                  () =>
                    void props.execute(
                      "/api/admin/manual-drives",
                      adminJsonRequest("DELETE", { id: drive.id }),
                    ),
                ),
              { secondary: true, destructive: true },
            )}
          </View>
        ))}
        {!drives.length ? (
          <Text style={{ color: props.colors.muted }}>
            No manual drives configured.
          </Text>
        ) : null}
      </View>
    </>
  );
}

type AdminAccessSectionProps = Readonly<{
  colors: AdminSectionContentProps["colors"];
  field: AdminField;
  button: AdminButton;
  confirm: AdminSectionContentProps["confirm"];
  execute: AdminSectionContentProps["execute"];
  permissions: AdminRecord;
  requests: AdminRecord[];
  accessFolderId: string;
  setAccessFolderId: (value: string) => void;
  accessEmail: string;
  setAccessEmail: (value: string) => void;
}>;

function renderAdminAccessSection(props: AdminAccessSectionProps): ReactNode {
  return (
    <>
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
          Grant folder access
        </Text>
        {props.field(
          "Folder ID",
          props.accessFolderId,
          props.setAccessFolderId,
        )}
        {props.field("User email", props.accessEmail, props.setAccessEmail, {
          keyboardType: "email-address",
        })}
        {props.button(
          "Grant access",
          () =>
            void props.execute(
              "/api/admin/user-access",
              adminJsonRequest("POST", {
                folderId: props.accessFolderId.trim(),
                email: props.accessEmail.trim(),
              }),
              () => {
                props.setAccessFolderId("");
                props.setAccessEmail("");
              },
            ),
          {
            disabled: !props.accessFolderId.trim() || !props.accessEmail.trim(),
          },
        )}
      </View>
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
          Granted access
        </Text>
        {Object.entries(props.permissions).map(([id, emails]) => (
          <View
            key={id}
            style={[styles.accessGroup, { borderColor: props.colors.border }]}
          >
            <Text
              selectable
              style={[styles.rowTitle, { color: props.colors.foreground }]}
            >
              {id}
            </Text>
            {(Array.isArray(emails) ? emails : []).map((value) => (
              <View key={`${id}-${value}`} style={styles.row}>
                <Text
                  selectable
                  style={[styles.rowText, { color: props.colors.muted }]}
                >
                  {value}
                </Text>
                {props.button(
                  "Remove",
                  () =>
                    props.confirm(
                      "Remove folder access?",
                      `${value} will lose access to this folder.`,
                      () =>
                        void props.execute(
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
        {!Object.keys(props.permissions).length ? (
          <Text style={{ color: props.colors.muted }}>
            No folder access grants.
          </Text>
        ) : null}
      </View>
      <PendingAccessRequestList
        requests={props.requests}
        colors={props.colors}
        button={props.button}
        confirm={props.confirm}
        execute={props.execute}
      />
    </>
  );
}

type AdminIncidentsSectionProps = Readonly<{
  record: AdminRecord;
  incidents: AdminRecord[];
  colors: AdminSectionContentProps["colors"];
  button: AdminButton;
  execute: AdminSectionContentProps["execute"];
  jsonPanel: (value?: unknown) => ReactNode;
}>;

function renderAdminIncidentsSection(
  props: AdminIncidentsSectionProps,
): ReactNode {
  return (
    <>
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
          Incident status
        </Text>
        <Text style={{ color: props.colors.muted }}>
          {adminDisplayValue(props.record.openCount, "0")} open ·{" "}
          {adminDisplayValue(
            props.record.total,
            String(props.incidents.length),
          )}{" "}
          total
        </Text>
        {props.button(
          "Evaluate current incidents",
          () =>
            void props.execute(
              "/api/admin/incidents/evaluate",
              adminJsonRequest("POST", {}),
            ),
          { secondary: true },
        )}
      </View>
      {props.incidents.map((incident, index) => (
        <View
          key={adminDisplayValue(incident.id, String(index))}
          style={[
            styles.card,
            {
              backgroundColor: props.colors.surface,
              borderColor: props.colors.border,
            },
          ]}
        >
          <Text style={[styles.rowTitle, { color: props.colors.foreground }]}>
            {adminDisplayValue(
              incident.title,
              adminDisplayValue(
                incident.message,
                adminDisplayValue(incident.type, "Incident"),
              ),
            )}
          </Text>
          <Text style={[styles.rowMeta, { color: props.colors.muted }]}>
            {adminDisplayValue(incident.status, "open")} ·{" "}
            {adminDisplayValue(
              incident.createdAt,
              adminDisplayValue(incident.timestamp),
            )}
          </Text>
          {props.jsonPanel(incident)}
          <View style={styles.buttonRow}>
            {(["open", "acknowledged", "resolved"] as const).map((status) =>
              props.button(
                status,
                () =>
                  void props.execute(
                    "/api/admin/incidents",
                    adminJsonRequest("PATCH", { id: incident.id, status }),
                  ),
                {
                  secondary: true,
                  disabled: incident.status === status,
                },
              ),
            )}
          </View>
        </View>
      ))}
      {!props.incidents.length ? (
        <Text style={{ color: props.colors.muted }}>
          No incidents reported.
        </Text>
      ) : null}
    </>
  );
}

type AdminConfigSectionProps = Readonly<{
  configDraft: ConfigDraft;
  setConfigDraft: Dispatch<SetStateAction<ConfigDraft>>;
  localStoragePassword: string;
  setLocalStoragePassword: (value: string) => void;
  colors: AdminSectionContentProps["colors"];
  field: AdminField;
  button: AdminButton;
  execute: AdminSectionContentProps["execute"];
}>;

function renderAdminConfigSection(props: AdminConfigSectionProps): ReactNode {
  const updateDraft = (key: keyof ConfigDraft, value: string | boolean) =>
    props.setConfigDraft((current) => ({ ...current, [key]: value }));
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
        Server presentation and access
      </Text>
      {props.field(
        "App name",
        props.configDraft.appName,
        (value) => updateDraft("appName", value),
        {
          autoCapitalize: "sentences",
        },
      )}
      {props.field(
        "Logo URL",
        props.configDraft.logoUrl,
        (value) => updateDraft("logoUrl", value),
        {
          keyboardType: "url",
        },
      )}
      {props.field(
        "Favicon URL",
        props.configDraft.faviconUrl,
        (value) => updateDraft("faviconUrl", value),
        {
          keyboardType: "url",
        },
      )}
      {props.field(
        "Primary color (hex)",
        props.configDraft.primaryColor,
        (value) => updateDraft("primaryColor", value),
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
          style={[styles.switchRow, { borderColor: props.colors.border }]}
        >
          <Text style={[styles.rowText, { color: props.colors.foreground }]}>
            {label}
          </Text>
          <Switch
            value={props.configDraft[key]}
            onValueChange={(value) => updateDraft(key, value)}
          />
        </View>
      ))}
      {props.configDraft.localStorageAuthEnabled
        ? props.field(
            "New local storage password (leave blank to keep current)",
            props.localStoragePassword,
            props.setLocalStoragePassword,
            { secure: true },
          )
        : null}
      {props.button(
        "Save configuration",
        () =>
          void props.execute(
            "/api/admin/config",
            adminJsonRequest("POST", {
              ...props.configDraft,
              ...(props.localStoragePassword.trim()
                ? { localStoragePassword: props.localStoragePassword.trim() }
                : {}),
            }),
            () => props.setLocalStoragePassword(""),
          ),
      )}
      <Text style={[styles.rowMeta, { color: props.colors.muted }]}>
        Passwords are never displayed by the server. Enter a new value only when
        you want to change it.
      </Text>
    </View>
  );
}

type AdminUtilitySectionProps = Readonly<{
  section: AdminSection;
  sectionLabel: string;
  colors: AdminSectionContentProps["colors"];
  button: AdminButton;
  confirm: AdminSectionContentProps["confirm"];
  execute: AdminSectionContentProps["execute"];
  jsonPanel: (value?: unknown) => ReactNode;
}>;

function renderAdminUtilitySection(props: AdminUtilitySectionProps): ReactNode {
  if (props.section === "cache") {
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
          Cache statistics
        </Text>
        {props.jsonPanel()}
        {props.button(
          "Clear file cache",
          () =>
            props.confirm(
              "Clear file cache?",
              "Cached file listings will be refreshed from storage.",
              () =>
                void props.execute("/api/clearcache?target=files", {
                  method: "GET",
                }),
            ),
          { secondary: true, destructive: true },
        )}
      </View>
    );
  }
  if (props.section === "audit") {
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
          Recent audit events
        </Text>
        {props.jsonPanel()}
        {props.button(
          "Clear audit log",
          () =>
            props.confirm(
              "Clear audit history?",
              "This permanently removes audit and recent activity entries.",
              () =>
                void props.execute("/api/admin/audit", { method: "DELETE" }),
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
        {
          backgroundColor: props.colors.surface,
          borderColor: props.colors.border,
        },
      ]}
    >
      <Text style={[styles.sectionTitle, { color: props.colors.foreground }]}>
        {props.sectionLabel}
      </Text>
      {props.jsonPanel()}
    </View>
  );
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
      return renderAdminUsersSection({
        section,
        emailRows,
        email,
        setEmail,
        saveEmail,
        colors,
        field,
        button,
        confirm,
        execute,
      });
    }
    if (section === "drives") {
      return renderAdminDrivesSection({
        data,
        driveId,
        setDriveId,
        driveName,
        setDriveName,
        drivePassword,
        setDrivePassword,
        scanResults,
        setScanResults,
        scanDrives,
        colors,
        field,
        button,
        execute,
        confirm,
      });
    }
    if (section === "access") {
      return renderAdminAccessSection({
        colors,
        field,
        button,
        confirm,
        execute,
        permissions,
        requests: accessRequests,
        accessFolderId,
        setAccessFolderId,
        accessEmail,
        setAccessEmail,
      });
    }
    if (section === "incidents") {
      return renderAdminIncidentsSection({
        record,
        incidents,
        colors,
        button,
        execute,
        jsonPanel,
      });
    }
    if (section === "config") {
      return renderAdminConfigSection({
        configDraft,
        setConfigDraft,
        localStoragePassword,
        setLocalStoragePassword,
        colors,
        field,
        button,
        execute,
      });
    }
    return renderAdminUtilitySection({
      section,
      sectionLabel,
      colors,
      button,
      confirm,
      execute,
      jsonPanel,
    });
  };
  return renderSection();
}
