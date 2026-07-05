import { useEffect, useMemo, useRef, useState } from "react";
import type { Locale } from "../lib/i18n";
import { t } from "../lib/i18n";
import { bootstrapPathFromToken } from "../lib/oauth";
import { attachUploadBridge } from "../plugins/upload-bridge";
import { issueBootstrapPath, webViewEntryUrl } from "../lib/session-store";
import type { NativeUploadProgress } from "../lib/upload-bridge";

export function WebViewScreen({
  locale,
  origin,
  sessionToken,
  bootstrapToken,
  onLogout,
  onBack,
  onUploadProgress,
}: {
  locale: Locale;
  origin: string;
  sessionToken: string;
  bootstrapToken?: string;
  onLogout: () => void;
  onBack: () => void;
  onUploadProgress?: (progress: NativeUploadProgress) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const initialBootstrap = useMemo(
    () =>
      bootstrapToken
        ? webViewEntryUrl(origin, bootstrapPathFromToken(bootstrapToken))
        : null,
    [bootstrapToken, origin],
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (initialBootstrap) {
          if (!cancelled) setFrameSrc(initialBootstrap);
          return;
        }
        const path = await issueBootstrapPath(origin, sessionToken);
        if (!cancelled) setFrameSrc(webViewEntryUrl(origin, path));
      } catch {
        if (!cancelled) setError(t(locale, "webview.errorBootstrap"));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [initialBootstrap, locale, origin, sessionToken]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !frameSrc || !onUploadProgress) return;

    return attachUploadBridge({
      origin,
      sessionToken,
      iframe,
      onProgress: onUploadProgress,
      onLogout,
    });
  }, [frameSrc, onLogout, onUploadProgress, origin, sessionToken]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          padding: "0.5rem",
          borderBottom: "1px solid #ccc",
        }}
      >
        <button type="button" onClick={onBack}>
          {t(locale, "common.back")}
        </button>
        <button type="button" onClick={onLogout}>
          {t(locale, "webview.signOut")}
        </button>
      </div>
      {error ? (
        <p style={{ padding: "1rem", color: "#b00020" }}>{error}</p>
      ) : frameSrc ? (
        <iframe
          ref={iframeRef}
          title={t(locale, "webview.title")}
          src={frameSrc}
          style={{ flex: 1, border: "none", width: "100%" }}
          onLoad={(event) => {
            const frame = event.currentTarget;
            try {
              const href = frame.contentWindow?.location.href;
              if (!href) return;
              const path = new URL(href).pathname;
              if (
                path.endsWith("/login") ||
                path.includes("/api/auth/signin")
              ) {
                onLogout();
              }
            } catch {
              // ponytail: cross-origin iframe hides location; logout bridge lands in U5
            }
          }}
        />
      ) : (
        <p style={{ padding: "1rem" }}>{t(locale, "webview.loading")}</p>
      )}
    </div>
  );
}
