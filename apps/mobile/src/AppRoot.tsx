import { App as CapApp } from "@capacitor/app";
import { useCallback, useEffect, useState } from "react";
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

type WebviewSession = {
  origin: string;
  sessionToken: string;
  bootstrapToken?: string;
  initialPath?: string;
};

function useAppNavigation() {
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
  const [webviewSession, setWebviewSession] = useState<WebviewSession | null>(
    null,
  );
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
    checkNetwork().catch(() => {});
    return onNetworkChange((connected) => {
      setOnline(connected);
      if (!connected) setView("offline");
      else {
        setView("servers");
        refreshServers().catch(() => {});
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
    CapApp.getLaunchUrl()
      .then((result) => {
        if (result?.url) handleIncomingUrl(result.url).catch(() => {});
      })
      .catch(() => {});
  }, [handleIncomingUrl]);

  useEffect(() => {
    const sub = CapApp.addListener("appUrlOpen", ({ url }) => {
      handleIncomingUrl(url).catch(() => {});
    });
    return () => {
      sub.then((handle) => handle.remove()).catch(() => {});
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

  return {
    locale,
    view,
    online,
    servers,
    activeId,
    saving,
    addError,
    upload,
    webviewSession,
    deepLinkPending,
    deepLinkError,
    prefillServerUrl,
    authPrompt,
    checkNetwork,
    setView,
    setUpload,
    setSaving,
    setWebviewSession,
    setAuthPrompt,
    setAddError,
    setPrefillServerUrl,
    setDeepLinkPending,
    refreshServers,
    openShareDeepLink,
    openServer,
    enableBiometricsForActive,
  };
}

type AppNavigation = Readonly<ReturnType<typeof useAppNavigation>>;

function AuthView({ nav }: Readonly<{ nav: AppNavigation }>) {
  const { locale, authPrompt } = nav;
  if (!authPrompt) return null;
  return (
    <div style={{ padding: "1rem", maxWidth: "480px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.35rem" }}>
        {t(locale, "auth.enableBiometrics")}
      </h1>
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
        <button
          type="button"
          onClick={() => {
            nav
              .enableBiometricsForActive(
                authPrompt.origin,
                authPrompt.sessionToken,
              )
              .catch(() => {});
          }}
        >
          {t(locale, "auth.enableBiometrics")}
        </button>
        <button
          type="button"
          onClick={() => {
            nav.setWebviewSession({
              origin: authPrompt.origin,
              sessionToken: authPrompt.sessionToken,
            });
            nav.setAuthPrompt(null);
            nav.setView("webview");
          }}
        >
          {t(locale, "auth.skipBiometrics")}
        </button>
      </div>
    </div>
  );
}

function WebviewView({ nav }: Readonly<{ nav: AppNavigation }>) {
  const {
    locale,
    upload,
    webviewSession,
    setUpload,
    setView,
    setWebviewSession,
  } = nav;
  if (!webviewSession) return null;

  const resetToServers = () => {
    setWebviewSession(null);
    setUpload(null);
    setView("servers");
  };

  return (
    <>
      <WebViewScreen
        locale={locale}
        origin={webviewSession.origin}
        sessionToken={webviewSession.sessionToken}
        bootstrapToken={webviewSession.bootstrapToken}
        initialPath={webviewSession.initialPath}
        onBack={resetToServers}
        onLogout={() => {
          clearSessionForServer(webviewSession.origin).catch(() => {});
          resetToServers();
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
              upload.status === "uploading" ? undefined : () => setUpload(null)
            }
          />
        </div>
      ) : null}
    </>
  );
}

function AddView({ nav }: Readonly<{ nav: AppNavigation }>) {
  const handleSave = async (url: string, label: string) => {
    nav.setSaving(true);
    nav.setAddError(undefined);
    try {
      const bookmark = await addServer(preferencesStore, { url, label });
      await nav.refreshServers();
      nav.setPrefillServerUrl(undefined);

      if (nav.deepLinkPending?.origin === bookmark.url) {
        const target = nav.deepLinkPending;
        nav.setDeepLinkPending(null);
        await nav.openShareDeepLink(target);
        return;
      }
      nav.setView("servers");
    } catch (err) {
      nav.setAddError(addServerErrorKey(err));
    } finally {
      nav.setSaving(false);
    }
  };

  return (
    <AddServerScreen
      locale={nav.locale}
      saving={nav.saving}
      errorKey={nav.addError}
      initialUrl={nav.prefillServerUrl}
      onCancel={() => {
        nav.setAddError(undefined);
        nav.setPrefillServerUrl(undefined);
        nav.setView("servers");
      }}
      onSave={handleSave}
    />
  );
}

function addServerErrorKey(err: unknown): MessageKey {
  if (err instanceof ServerValidationError && err.code === "invalid_url") {
    return "add.errorInvalidUrl";
  }
  return "add.errorUnreachable";
}

function ServersView({ nav }: Readonly<{ nav: AppNavigation }>) {
  const { locale, servers, activeId, deepLinkPending, deepLinkError } = nav;
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
              nav.setPrefillServerUrl(deepLinkPending.origin);
              nav.setView("add");
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
        onAdd={() => nav.setView("add")}
        onSwitch={async (id) => {
          const previous = servers.find((s) => s.id === activeId)?.url ?? null;
          await switchActiveServer(preferencesStore, id, previous);
          await nav.refreshServers();
        }}
        onOpen={(id) => {
          const server = servers.find((s) => s.id === id);
          if (server) nav.openServer(server).catch(() => {});
        }}
      />
    </>
  );
}

function AppViews({ nav }: Readonly<{ nav: AppNavigation }>) {
  const { locale, view, online, upload } = nav;

  if (view === "offline" || !online) {
    return (
      <OfflineScreen
        locale={locale}
        onRetry={() => {
          nav.checkNetwork().catch(() => {});
        }}
      />
    );
  }

  if (view === "upload" && upload) {
    return (
      <UploadProgressScreen
        locale={locale}
        upload={upload}
        onDismiss={() => {
          nav.setUpload(null);
          nav.setView("servers");
        }}
      />
    );
  }

  if (view === "auth") return <AuthView nav={nav} />;
  if (view === "webview") return <WebviewView nav={nav} />;
  if (view === "add") return <AddView nav={nav} />;
  return <ServersView nav={nav} />;
}

export function App() {
  const nav = useAppNavigation();
  return <AppViews nav={nav} />;
}
