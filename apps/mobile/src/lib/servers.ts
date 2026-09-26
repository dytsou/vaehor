import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { checkServerHealth, normalizeServerOrigin } from "./api-client";

import { clearSessionForServer } from "./session-store";

export type ServerBookmark = {
  id: string;
  url: string;
  label: string;
  biometricsEnabled: boolean;
};

const SERVERS_KEY = "vaehor.servers.v1";
const ACTIVE_KEY = "vaehor.activeServerId.v1";

export type ServerStore = {
  getServers(): Promise<ServerBookmark[]>;
  setServers(servers: ServerBookmark[]): Promise<void>;
  getActiveId(): Promise<string | null>;
  setActiveId(id: string | null): Promise<void>;
};

export const preferencesStore: ServerStore = {
  async getServers() {
    const value = await AsyncStorage.getItem(SERVERS_KEY);
    if (!value) return [];
    const bookmarks = JSON.parse(value) as ServerBookmark[];
    const seen = new Set<string>();
    return bookmarks.flatMap((bookmark) => {
      try {
        const url = normalizeServerOrigin(bookmark.url);
        if (seen.has(url)) return [];
        seen.add(url);
        return [{ ...bookmark, url }];
      } catch {
        return [];
      }
    });
  },
  async setServers(servers) {
    await AsyncStorage.setItem(SERVERS_KEY, JSON.stringify(servers));
  },
  async getActiveId() {
    return await AsyncStorage.getItem(ACTIVE_KEY);
  },
  async setActiveId(id) {
    if (id) {
      await AsyncStorage.setItem(ACTIVE_KEY, id);
    } else {
      await AsyncStorage.removeItem(ACTIVE_KEY);
    }
  },
};

export function createServerId(): string {
  return Crypto.randomUUID();
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
    const { protocol, hostname } = new URL(origin);
    const isLoopback =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]";
    if (protocol !== "https:" && !isLoopback) {
      throw new Error("https_required");
    }
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
): Promise<ServerBookmark | null> {
  const servers = await store.getServers();
  const next = servers.find((s) => s.id === nextId);
  if (!next) return null;
  await store.setActiveId(next.id);
  return next;
}

export async function removeServer(
  store: ServerStore,
  serverId: string,
  clearSession: (origin: string) => Promise<void> = clearSessionForServer,
): Promise<boolean> {
  const servers = await store.getServers();
  const removed = servers.find((server) => server.id === serverId);
  if (!removed) return false;

  const remaining = servers.filter((server) => server.id !== serverId);
  await clearSession(removed.url);
  await store.setServers(remaining);

  if ((await store.getActiveId()) === serverId) {
    await store.setActiveId(remaining[0]?.id ?? null);
  }
  return true;
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
