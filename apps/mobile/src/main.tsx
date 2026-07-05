import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { getDeviceLocale, type Locale, type MessageKey } from "./lib/i18n";
import { isOnline, onNetworkChange } from "./lib/network-status";
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

type View = "servers" | "add" | "offline" | "upload";

function App() {
  const [locale] = useState<Locale>(() => getDeviceLocale());
  const [view, setView] = useState<View>("servers");
  const [online, setOnline] = useState(true);
  const [servers, setServers] = useState<ServerBookmark[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<MessageKey | undefined>();
  const [upload, setUpload] = useState<UploadState | null>(null);

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
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
