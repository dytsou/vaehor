import type { ReactNode } from "react";
import type { Locale, MessageKey } from "../lib/i18n";
import { t } from "../lib/i18n";
import type { ServerBookmark } from "../lib/servers";

const shell = {
  fontFamily: "system-ui, -apple-system, sans-serif",
  padding: "1rem",
  maxWidth: "480px",
  margin: "0 auto",
} as const;

export function ScreenShell({
  title,
  children,
  onBack,
  locale,
}: {
  title: string;
  children: ReactNode;
  onBack?: () => void;
  locale: Locale;
}) {
  return (
    <div style={shell}>
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          style={{ marginBottom: "0.75rem" }}
        >
          {t(locale, "common.back")}
        </button>
      ) : null}
      <h1 style={{ fontSize: "1.35rem", margin: "0 0 1rem" }}>{title}</h1>
      {children}
    </div>
  );
}

export function ServerListScreen({
  locale,
  servers,
  activeId,
  onAdd,
  onSwitch,
  onOpen,
}: {
  locale: Locale;
  servers: ServerBookmark[];
  activeId: string | null;
  onAdd: () => void;
  onSwitch: (id: string) => void;
  onOpen?: (id: string) => void;
}) {
  return (
    <ScreenShell title={t(locale, "servers.title")} locale={locale}>
      {servers.length === 0 ? (
        <p>{t(locale, "servers.empty")}</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {servers.map((server) => (
            <li
              key={server.id}
              style={{
                border: "1px solid #ccc",
                borderRadius: "8px",
                padding: "0.75rem",
                marginBottom: "0.5rem",
              }}
            >
              <div style={{ fontWeight: 600 }}>{server.label}</div>
              <div style={{ fontSize: "0.85rem", color: "#555" }}>
                {server.url}
              </div>
              {activeId === server.id ? (
                <div
                  style={{
                    marginTop: "0.5rem",
                    display: "flex",
                    gap: "0.5rem",
                    alignItems: "center",
                  }}
                >
                  <span style={{ color: "#0a0" }}>
                    {t(locale, "servers.active")}
                  </span>
                  {onOpen ? (
                    <button type="button" onClick={() => onOpen(server.id)}>
                      {t(locale, "servers.open")}
                    </button>
                  ) : null}
                </div>
              ) : (
                <button
                  type="button"
                  style={{ marginTop: "0.5rem" }}
                  onClick={() => onSwitch(server.id)}
                >
                  {t(locale, "servers.switch")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={onAdd} style={{ marginTop: "1rem" }}>
        {t(locale, "servers.add")}
      </button>
    </ScreenShell>
  );
}

export function AddServerScreen({
  locale,
  onCancel,
  onSave,
  saving,
  errorKey,
  initialUrl,
}: {
  locale: Locale;
  onCancel: () => void;
  onSave: (url: string, label: string) => void;
  saving: boolean;
  errorKey?: MessageKey;
  initialUrl?: string;
}) {
  return (
    <ScreenShell
      title={t(locale, "add.title")}
      locale={locale}
      onBack={onCancel}
    >
      <label style={{ display: "block", marginBottom: "0.75rem" }}>
        <div style={{ marginBottom: "0.25rem" }}>
          {t(locale, "add.urlLabel")}
        </div>
        <input
          id="server-url"
          type="url"
          defaultValue={initialUrl ?? ""}
          placeholder={t(locale, "add.urlPlaceholder")}
          disabled={saving}
          style={{ width: "100%", padding: "0.5rem" }}
        />
      </label>
      <label style={{ display: "block", marginBottom: "0.75rem" }}>
        <div style={{ marginBottom: "0.25rem" }}>
          {t(locale, "add.labelLabel")}
        </div>
        <input
          id="server-label"
          type="text"
          disabled={saving}
          style={{ width: "100%", padding: "0.5rem" }}
        />
      </label>
      {errorKey ? (
        <p style={{ color: "#b00020" }}>{t(locale, errorKey)}</p>
      ) : null}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="button" onClick={onCancel} disabled={saving}>
          {t(locale, "add.cancel")}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            const url = (
              document.getElementById("server-url") as HTMLInputElement
            ).value;
            const label = (
              document.getElementById("server-label") as HTMLInputElement
            ).value;
            onSave(url, label);
          }}
        >
          {saving ? t(locale, "add.validating") : t(locale, "add.save")}
        </button>
      </div>
    </ScreenShell>
  );
}

export function OfflineScreen({
  locale,
  onRetry,
}: {
  locale: Locale;
  onRetry: () => void;
}) {
  return (
    <ScreenShell title={t(locale, "offline.title")} locale={locale}>
      <p>{t(locale, "offline.message")}</p>
      <button type="button" onClick={onRetry}>
        {t(locale, "offline.retry")}
      </button>
    </ScreenShell>
  );
}

export type UploadState = {
  fileName: string;
  percent: number;
  status: "uploading" | "error" | "success";
  errorMessage?: string;
};

export function UploadProgressScreen({
  locale,
  upload,
  onDismiss,
}: {
  locale: Locale;
  upload: UploadState;
  onDismiss?: () => void;
}) {
  return (
    <ScreenShell title={t(locale, "upload.title")} locale={locale}>
      <p style={{ marginBottom: "0.5rem" }}>{upload.fileName}</p>
      {upload.status === "error" ? (
        <p style={{ color: "#b00020" }}>
          {upload.errorMessage ?? t(locale, "upload.error")}
        </p>
      ) : (
        <p>{t(locale, "upload.progress", { percent: upload.percent })}</p>
      )}
      {upload.status !== "uploading" && onDismiss ? (
        <button type="button" onClick={onDismiss} style={{ marginTop: "1rem" }}>
          {t(locale, "common.back")}
        </button>
      ) : null}
    </ScreenShell>
  );
}
