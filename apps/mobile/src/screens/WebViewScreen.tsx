import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Locale } from "../lib/i18n";
import { t } from "../lib/i18n";
import { appendBootstrapRedirect } from "../lib/deep-link";
import { bootstrapPathFromToken } from "../lib/oauth";
import { attachUploadBridge } from "../plugins/upload-bridge";
import { issueBootstrapPath, webViewEntryUrl } from "../lib/session-store";
import type { NativeUploadProgress } from "../lib/upload-bridge";

export function WebViewScreen({
  locale,
  origin,
  sessionToken,
  bootstrapToken,
  initialPath,
  onLogout,
  onBack,
  onUploadProgress,
}: Readonly<{
  locale: Locale;
  origin: string;
  sessionToken: string;
  bootstrapToken?: string;
  initialPath?: string;
  onLogout: () => void;
  onBack: () => void;
  onUploadProgress?: (progress: NativeUploadProgress) => void;
}>) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const initialBootstrap = useMemo(() => {
    const bootstrapPath = bootstrapToken
      ? bootstrapPathFromToken(bootstrapToken)
      : null;
    if (!bootstrapPath) return null;
    const path = initialPath
      ? appendBootstrapRedirect(bootstrapPath, initialPath)
      : bootstrapPath;
    return webViewEntryUrl(origin, path);
  }, [bootstrapToken, initialPath, origin]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (initialBootstrap) {
          if (!cancelled) setFrameSrc(initialBootstrap);
          return;
        }
        const path = await issueBootstrapPath(origin, sessionToken);
        const bootstrapPath = initialPath
          ? appendBootstrapRedirect(path, initialPath)
          : path;
        if (!cancelled) setFrameSrc(webViewEntryUrl(origin, bootstrapPath));
      } catch {
        if (!cancelled) setError(t(locale, "webview.errorBootstrap"));
      }
    }

    load().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [initialBootstrap, initialPath, locale, origin, sessionToken]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !frameSrc) return;

    return attachUploadBridge({
      origin,
      sessionToken,
      iframe,
      onProgress: onUploadProgress ?? (() => {}),
      onLogout,
    });
  }, [frameSrc, onLogout, onUploadProgress, origin, sessionToken]);

  let body: ReactNode;
  if (error) {
    body = <p style={{ padding: "1rem", color: "#b00020" }}>{error}</p>;
  } else if (frameSrc) {
    body = (
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
            if (path.endsWith("/login") || path.includes("/api/auth/signin")) {
              onLogout();
            }
          } catch {
            // same-origin dev only; production uses postMessage logout bridge
          }
        }}
      />
    );
  } else {
    body = <p style={{ padding: "1rem" }}>{t(locale, "webview.loading")}</p>;
  }

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
      {body}
    </div>
  );
}
