import { Preferences } from "@capacitor/preferences";
import { checkServerHealth, normalizeServerOrigin } from "./api-client";

/** U4 WebViewScreen wires real cookie jar clearing; noop until then. */
export async function clearWebViewCookiesForOrigin(
  _origin: string,
): Promise<void> {}

export type ServerBookmark = {
  id: string;
  url: string;
  label: string;
  biometricsEnabled: boolean;
};

const SERVERS_KEY = "zee.servers";
const ACTIVE_KEY = "zee.activeServerId";

export type ServerStore = {
  getServers(): Promise<ServerBookmark[]>;
  setServers(servers: ServerBookmark[]): Promise<void>;
  getActiveId(): Promise<string | null>;
  setActiveId(id: string | null): Promise<void>;
};

export const preferencesStore: ServerStore = {
  async getServers() {
    const { value } = await Preferences.get({ key: SERVERS_KEY });
    if (!value) return [];
    return JSON.parse(value) as ServerBookmark[];
  },
  async setServers(servers) {
    await Preferences.set({ key: SERVERS_KEY, value: JSON.stringify(servers) });
  },
  async getActiveId() {
    const { value } = await Preferences.get({ key: ACTIVE_KEY });
    return value ?? null;
  },
  async setActiveId(id) {
    if (id) {
      await Preferences.set({ key: ACTIVE_KEY, value: id });
    } else {
      await Preferences.remove({ key: ACTIVE_KEY });
    }
  },
};

export function createServerId(): string {
  return crypto.randomUUID();
}

export function defaultLabelForOrigin(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

export class ServerValidationError extends Error {
  constructor(
    readonly code: "invalid_url" | "unreachable",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "ServerValidationError";
  }
}

export async function validateAndNormalizeUrl(
  input: string,
  healthCheck: (origin: string) => Promise<boolean> = checkServerHealth,
): Promise<string> {
  let origin: string;
  try {
    origin = normalizeServerOrigin(input);
  } catch {
    throw new ServerValidationError("invalid_url");
  }
  const ok = await healthCheck(origin);
  if (!ok) throw new ServerValidationError("unreachable");
  return origin;
}

export async function addServer(
  store: ServerStore,
  input: {
    url: string;
    label?: string;
    healthCheck?: (origin: string) => Promise<boolean>;
  },
): Promise<ServerBookmark> {
  const origin = await validateAndNormalizeUrl(
    input.url,
    input.healthCheck ?? checkServerHealth,
  );
  const servers = await store.getServers();
  const existing = servers.find((s) => s.url === origin);
  if (existing) {
    await store.setActiveId(existing.id);
    return existing;
  }
  const bookmark: ServerBookmark = {
    id: createServerId(),
    url: origin,
    label: input.label?.trim() || defaultLabelForOrigin(origin),
    biometricsEnabled: false,
  };
  servers.push(bookmark);
  await store.setServers(servers);
  await store.setActiveId(bookmark.id);
  return bookmark;
}

export async function switchActiveServer(
  store: ServerStore,
  nextId: string,
  previousOrigin?: string | null,
  clearCookies: (
    origin: string,
  ) => Promise<void> = clearWebViewCookiesForOrigin,
): Promise<ServerBookmark | null> {
  const servers = await store.getServers();
  const next = servers.find((s) => s.id === nextId);
  if (!next) return null;

  let previous = previousOrigin ?? null;
  if (!previous) {
    const activeId = await store.getActiveId();
    previous = servers.find((s) => s.id === activeId)?.url ?? null;
  }

  if (previous && previous !== next.url) {
    await clearCookies(previous);
  }

  await store.setActiveId(next.id);
  return next;
}

export async function getActiveServer(
  store: ServerStore,
): Promise<ServerBookmark | null> {
  const [servers, activeId] = await Promise.all([
    store.getServers(),
    store.getActiveId(),
  ]);
  if (!activeId) return servers[0] ?? null;
  return servers.find((s) => s.id === activeId) ?? servers[0] ?? null;
}
