import { createServerFetch, type ServerFetch } from "../lib/api-client";
import { loadBiometricServerSession } from "../lib/biometric-session";
import { listMobileDrives } from "../lib/file-api";
import {
  getActiveServer,
  preferencesStore,
  type ServerBookmark,
} from "../lib/servers";

export type ActiveMobileRouteSession = Readonly<{
  server: ServerBookmark;
  fetchImpl: ServerFetch;
  role: string;
}>;

type LoadActiveRouteSessionOptions = Readonly<{
  isActive: () => boolean;
  redirectToServer: () => void;
  setError: (message: string) => void;
}>;

function handleMissingBiometricSession(
  status: string,
  redirectToServer: () => void,
  setError: (message: string) => void,
): void {
  if (status === "missing") {
    redirectToServer();
    return;
  }
  if (status === "biometrics-unavailable") {
    setError(
      "Biometric unlock is unavailable on this device. Return to the server screen to continue.",
    );
    return;
  }
  setError(
    "Biometric unlock was not completed. Return to the server screen to continue.",
  );
}

export async function loadActiveRouteSession({
  isActive,
  redirectToServer,
  setError,
}: LoadActiveRouteSessionOptions): Promise<ActiveMobileRouteSession | null> {
  const server = await getActiveServer(preferencesStore);
  if (!isActive()) return null;
  if (!server) {
    redirectToServer();
    return null;
  }

  const session = await loadBiometricServerSession(server);
  if (!isActive()) return null;
  if (session.status !== "authenticated") {
    handleMissingBiometricSession(session.status, redirectToServer, setError);
    return null;
  }

  const fetchImpl = createServerFetch(server.url, session.token);
  const drives = await listMobileDrives(fetchImpl);
  if (!isActive()) return null;
  return { server, fetchImpl, role: drives.role.toUpperCase() };
}
