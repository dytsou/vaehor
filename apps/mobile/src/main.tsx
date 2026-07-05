import { App as CapApp } from "@capacitor/app";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { promptBiometricUnlock } from "./lib/biometrics";
import { getDeviceLocale, t, type Locale, type MessageKey } from "./lib/i18n";
import { isOnline, onNetworkChange } from "./lib/network-status";
import { completeOAuthFromCallback, startGoogleOAuth } from "./lib/oauth";
import {
  clearSessionForServer,
  loadSessionForServer,
  recordBiometricFailure,
  resetBiometricFailures,
  saveSessionForServer,
} from "./lib/session-store";
import {
  addServer,
  getActiveServer,
  preferencesStore,
  ServerValidationError,
  switchActiveServer,
  type ServerBookmark,
} from "./lib/servers";
import {
  AddServerScreen,
  OfflineScreen,
  ServerListScreen,
  UploadProgressScreen,
  type UploadState,
} from "./screens";
import { WebViewScreen } from "./screens/WebViewScreen";

type View = "servers" | "add" | "offline" | "upload" | "webview" | "auth";

function App() {
  const [locale] = useState<Locale>(() => getDeviceLocale());
  const [view, setView] = useState<View>("servers");
  const [online, setOnline] = useState(true);
  const [servers, setServers] = useState<ServerBookmark[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<MessageKey | undefined>();
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [pendingOAuthOrigin, setPendingOAuthOrigin] = useState<string | null>(
    null,
  );
  const [webviewSession, setWebviewSession] = useState<{
    origin: string;
    sessionToken: string;
    bootstrapToken?: string;
  } | null>(null);
  const [authPrompt, setAuthPrompt] = useState<{
    origin: string;
    sessionToken: string;
    bootstrapToken?: string;
  } | null>(null);

  const refreshServers = useCallback(async () => {
    const list = await preferencesStore.getServers();
    const active = await getActiveServer(preferencesStore);
    setServers(list);
    setActiveId(active?.id ?? null);
  }, []);

  const checkNetwork = useCallback(async () => {
    const connected = await isOnline();
    setOnline(connected);
    setView(connected ? "servers" : "offline");
    if (connected) await refreshServers();
  }, [refreshServers]);

  useEffect(() => {
    void checkNetwork();
    return onNetworkChange((connected) => {
      setOnline(connected);
      if (!connected) setView("offline");
      else {
        setView("servers");
        void refreshServers();
      }
    });
  }, [checkNetwork, refreshServers]);

  useEffect(() => {
    const sub = CapApp.addListener("appUrlOpen", ({ url }) => {
      if (!pendingOAuthOrigin) return;
      void (async () => {
        try {
          const result = await completeOAuthFromCallback(
            pendingOAuthOrigin,
            url,
          );
          await saveSessionForServer(result.origin, result.sessionToken);
          setPendingOAuthOrigin(null);
          setAuthPrompt({
            origin: result.origin,
            sessionToken: result.sessionToken,
            bootstrapToken: result.bootstrapToken,
          });
          setView("auth");
        } catch {
          setPendingOAuthOrigin(null);
        }
      })();
    });
    return () => {
      void sub.then((handle) => handle.remove());
    };
  }, [pendingOAuthOrigin]);

  const openServer = useCallback(async (server: ServerBookmark) => {
    const stored = await loadSessionForServer(server.url);
    if (stored && server.biometricsEnabled) {
      const ok = await promptBiometricUnlock("Unlock your saved session");
      if (!ok) {
        const failures = await recordBiometricFailure(server.url);
        if (failures >= 3) {
          await clearSessionForServer(server.url);
          setPendingOAuthOrigin(server.url);
          await startGoogleOAuth(server.url);
        }
        return;
      }
      await resetBiometricFailures(server.url);
      setWebviewSession({ origin: server.url, sessionToken: stored });
      setView("webview");
      return;
    }

    if (stored) {
      setWebviewSession({ origin: server.url, sessionToken: stored });
      setView("webview");
      return;
    }

    setPendingOAuthOrigin(server.url);
    await startGoogleOAuth(server.url);
  }, []);

  const enableBiometricsForActive = useCallback(
    async (origin: string, sessionToken: string, bootstrapToken?: string) => {
      const list = await preferencesStore.getServers();
      const updated = list.map((s) =>
        s.url === origin ? { ...s, biometricsEnabled: true } : s,
      );
      await preferencesStore.setServers(updated);
      setWebviewSession({ origin, sessionToken, bootstrapToken });
      setAuthPrompt(null);
      setView("webview");
    },
    [],
  );

  // ponytail: demo hook for UploadProgressScreen until U5 bridge wires real uploads
  useEffect(() => {
    const demo = new URLSearchParams(window.location.search).get("demoUpload");
    if (demo === "1") {
      setUpload({
        fileName: "photo.jpg",
        percent: 42,
        status: "uploading",
      });
      setView("upload");
    }
  }, []);

  if (view === "offline" || !online) {
    return (
      <OfflineScreen locale={locale} onRetry={() => void checkNetwork()} />
    );
  }

  if (view === "upload" && upload) {
    return (
      <UploadProgressScreen
        locale={locale}
        upload={upload}
        onDismiss={() => {
          setUpload(null);
          setView("servers");
        }}
      />
    );
  }

  if (view === "auth" && authPrompt) {
    return (
      <div style={{ padding: "1rem", maxWidth: "480px", margin: "0 auto" }}>
        <h1 style={{ fontSize: "1.35rem" }}>
          {t(locale, "auth.enableBiometrics")}
        </h1>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
          <button
            type="button"
            onClick={() =>
              void enableBiometricsForActive(
                authPrompt.origin,
                authPrompt.sessionToken,
                authPrompt.bootstrapToken,
              )
            }
          >
            {t(locale, "auth.enableBiometrics")}
          </button>
          <button
            type="button"
            onClick={() => {
              setWebviewSession({
                origin: authPrompt.origin,
                sessionToken: authPrompt.sessionToken,
                bootstrapToken: authPrompt.bootstrapToken,
              });
              setAuthPrompt(null);
              setView("webview");
            }}
          >
            {t(locale, "auth.skipBiometrics")}
          </button>
        </div>
      </div>
    );
  }

  if (view === "webview" && webviewSession) {
    return (
      <WebViewScreen
        locale={locale}
        origin={webviewSession.origin}
        sessionToken={webviewSession.sessionToken}
        bootstrapToken={webviewSession.bootstrapToken}
        onBack={() => {
          setWebviewSession(null);
          setView("servers");
        }}
        onLogout={() => {
          void clearSessionForServer(webviewSession.origin);
          setWebviewSession(null);
          setView("servers");
        }}
      />
    );
  }

  if (view === "add") {
    return (
      <AddServerScreen
        locale={locale}
        saving={saving}
        errorKey={addError}
        onCancel={() => {
          setAddError(undefined);
          setView("servers");
        }}
        onSave={async (url, label) => {
          setSaving(true);
          setAddError(undefined);
          try {
            await addServer(preferencesStore, { url, label });
            await refreshServers();
            setView("servers");
          } catch (err) {
            if (err instanceof ServerValidationError) {
              setAddError(
                err.code === "invalid_url"
                  ? "add.errorInvalidUrl"
                  : "add.errorUnreachable",
              );
            } else {
              setAddError("add.errorUnreachable");
            }
          } finally {
            setSaving(false);
          }
        }}
      />
    );
  }

  return (
    <ServerListScreen
      locale={locale}
      servers={servers}
      activeId={activeId}
      onAdd={() => setView("add")}
      onSwitch={async (id) => {
        const previous = servers.find((s) => s.id === activeId)?.url ?? null;
        await switchActiveServer(preferencesStore, id, previous);
        await refreshServers();
      }}
      onOpen={(id) => {
        const server = servers.find((s) => s.id === id);
        if (server) void openServer(server);
      }}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
