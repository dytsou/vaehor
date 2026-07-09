import { App as CapApp } from "@capacitor/app";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { promptBiometricUnlock } from "./lib/biometrics";
import { getDeviceLocale, t, type Locale, type MessageKey } from "./lib/i18n";
import { isOnline, onNetworkChange } from "./lib/network-status";
import {
  completeOAuthFromCallback,
  parseOAuthCallbackUrl,
  startGoogleOAuth,
} from "./lib/oauth";
import {
  findBookmarkForOrigin,
  parseDeepLink,
  type DeepLinkTarget,
} from "./lib/deep-link";
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
    initialPath?: string;
  } | null>(null);
  const [deepLinkPending, setDeepLinkPending] = useState<DeepLinkTarget | null>(
    null,
  );
  const [deepLinkError, setDeepLinkError] = useState<MessageKey | undefined>();
  const [prefillServerUrl, setPrefillServerUrl] = useState<
    string | undefined
  >();
  const [pendingDeepLinkTarget, setPendingDeepLinkTarget] =
    useState<DeepLinkTarget | null>(null);
  const [authPrompt, setAuthPrompt] = useState<{
    origin: string;
    sessionToken: string;
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

  const openWebviewForServer = useCallback(
    (
      server: ServerBookmark,
      sessionToken: string,
      options?: { bootstrapToken?: string; initialPath?: string },
    ) => {
      setWebviewSession({
        origin: server.url,
        sessionToken,
        bootstrapToken: options?.bootstrapToken,
        initialPath: options?.initialPath,
      });
      setView("webview");
    },
    [],
  );

  const openShareDeepLink = useCallback(
    async (target: DeepLinkTarget) => {
      setDeepLinkError(undefined);
      const list = await preferencesStore.getServers();
      const bookmark = findBookmarkForOrigin(target.origin, list);

      if (!bookmark) {
        setDeepLinkPending(target);
        setPrefillServerUrl(target.origin);
        setView("servers");
        return;
      }

      await preferencesStore.setActiveId(bookmark.id);
      await refreshServers();

      const stored = await loadSessionForServer(bookmark.url);
      if (stored && bookmark.biometricsEnabled) {
        const ok = await promptBiometricUnlock("Unlock your saved session");
        if (!ok) {
          const failures = await recordBiometricFailure(bookmark.url);
          if (failures >= 3) {
            await clearSessionForServer(bookmark.url);
          }
          setPendingDeepLinkTarget(target);
          setPendingOAuthOrigin(bookmark.url);
          await startGoogleOAuth(bookmark.url);
          return;
        }
        await resetBiometricFailures(bookmark.url);
        openWebviewForServer(bookmark, stored, { initialPath: target.path });
        return;
      }

      if (stored) {
        openWebviewForServer(bookmark, stored, { initialPath: target.path });
        return;
      }

      setPendingDeepLinkTarget(target);
      setPendingOAuthOrigin(bookmark.url);
      await startGoogleOAuth(bookmark.url);
    },
    [openWebviewForServer, refreshServers],
  );

  const handleIncomingUrl = useCallback(
    async (url: string) => {
      if (parseOAuthCallbackUrl(url) && pendingOAuthOrigin) {
        try {
          const result = await completeOAuthFromCallback(
            pendingOAuthOrigin,
            url,
          );
          await saveSessionForServer(result.origin, result.sessionToken);
          setPendingOAuthOrigin(null);
          const deepLinkPath =
            pendingDeepLinkTarget?.origin === result.origin
              ? pendingDeepLinkTarget.path
              : undefined;
          setPendingDeepLinkTarget(null);
          setDeepLinkPending(null);

          if (deepLinkPath) {
            openWebviewForServer(
              {
                id: "oauth",
                url: result.origin,
                label: result.origin,
                biometricsEnabled: false,
              },
              result.sessionToken,
              { initialPath: deepLinkPath },
            );
            return;
          }

          setAuthPrompt({
            origin: result.origin,
            sessionToken: result.sessionToken,
          });
          setView("auth");
        } catch {
          setPendingOAuthOrigin(null);
          setPendingDeepLinkTarget(null);
        }
        return;
      }

      const parsed = parseDeepLink(url);
      if (parsed.kind === "invalid") {
        setDeepLinkError("deeplink.errorMalformed");
        return;
      }
      if (parsed.kind === "share") {
        await openShareDeepLink(parsed.target);
      }
    },
    [
      openShareDeepLink,
      openWebviewForServer,
      pendingDeepLinkTarget,
      pendingOAuthOrigin,
    ],
  );

  useEffect(() => {
    void CapApp.getLaunchUrl().then((result) => {
      if (result?.url) void handleIncomingUrl(result.url);
    });
  }, [handleIncomingUrl]);

  useEffect(() => {
    const sub = CapApp.addListener("appUrlOpen", ({ url }) => {
      void handleIncomingUrl(url);
    });
    return () => {
      void sub.then((handle) => handle.remove());
    };
  }, [handleIncomingUrl]);

  const openServer = useCallback(
    async (server: ServerBookmark) => {
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
        openWebviewForServer(server, stored);
        return;
      }

      if (stored) {
        openWebviewForServer(server, stored);
        return;
      }

      setPendingOAuthOrigin(server.url);
      await startGoogleOAuth(server.url);
    },
    [openWebviewForServer],
  );

  const enableBiometricsForActive = useCallback(
    async (origin: string, sessionToken: string) => {
      const list = await preferencesStore.getServers();
      const updated = list.map((s) =>
        s.url === origin ? { ...s, biometricsEnabled: true } : s,
      );
      await preferencesStore.setServers(updated);
      setWebviewSession({ origin, sessionToken });
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
      <>
        <WebViewScreen
          locale={locale}
          origin={webviewSession.origin}
          sessionToken={webviewSession.sessionToken}
          bootstrapToken={webviewSession.bootstrapToken}
          initialPath={webviewSession.initialPath}
          onBack={() => {
            setWebviewSession(null);
            setUpload(null);
            setView("servers");
          }}
          onLogout={() => {
            void clearSessionForServer(webviewSession.origin);
            setWebviewSession(null);
            setUpload(null);
            setView("servers");
          }}
          onUploadProgress={(progress) => {
            setUpload({
              fileName: progress.fileName,
              percent: progress.percent,
              status: progress.status,
              errorMessage: progress.errorMessage,
            });
          }}
        />
        {upload ? (
          <div
            style={{
              position: "fixed",
              inset: "auto 0 0 0",
              background: "rgba(255,255,255,0.96)",
              borderTop: "1px solid #ccc",
              padding: "0.75rem",
              maxHeight: "40vh",
              overflow: "auto",
            }}
          >
            <UploadProgressScreen
              locale={locale}
              upload={upload}
              onDismiss={
                upload.status === "uploading"
                  ? undefined
                  : () => setUpload(null)
              }
            />
          </div>
        ) : null}
      </>
    );
  }

  if (view === "add") {
    return (
      <AddServerScreen
        locale={locale}
        saving={saving}
        errorKey={addError}
        initialUrl={prefillServerUrl}
        onCancel={() => {
          setAddError(undefined);
          setPrefillServerUrl(undefined);
          setView("servers");
        }}
        onSave={async (url, label) => {
          setSaving(true);
          setAddError(undefined);
          try {
            const bookmark = await addServer(preferencesStore, { url, label });
            await refreshServers();
            setPrefillServerUrl(undefined);

            if (deepLinkPending?.origin === bookmark.url) {
              const target = deepLinkPending;
              setDeepLinkPending(null);
              await openShareDeepLink(target);
              return;
            }

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
    <>
      {deepLinkError ? (
        <p style={{ padding: "0.75rem 1rem", color: "#b00020" }}>
          {t(locale, deepLinkError)}
        </p>
      ) : null}
      {deepLinkPending ? (
        <div
          style={{ padding: "0.75rem 1rem", borderBottom: "1px solid #ccc" }}
        >
          <p>
            {t(locale, "deeplink.unknownServer", {
              origin: deepLinkPending.origin,
            })}
          </p>
          <button
            type="button"
            onClick={() => {
              setPrefillServerUrl(deepLinkPending.origin);
              setView("add");
            }}
          >
            {t(locale, "deeplink.addServer")}
          </button>
        </div>
      ) : null}
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
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
