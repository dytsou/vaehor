import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  addServer,
  getActiveServer,
  switchActiveServer,
  validateAndNormalizeUrl,
  type ServerBookmark,
  type ServerStore,
} from "../src/lib/servers";

function memoryStore(): ServerStore & {
  data: ServerBookmark[];
  active: string | null;
} {
  return {
    data: [],
    active: null,
    async getServers() {
      return this.data;
    },
    async setServers(servers) {
      this.data = servers;
    },
    async getActiveId() {
      return this.active;
    },
    async setActiveId(id) {
      this.active = id;
    },
  };
}

describe("servers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validateAndNormalizeUrl", () => {
    it("normalizes host without scheme and checks health", async () => {
      const healthCheck = vi.fn().mockResolvedValue(true);
      const origin = await validateAndNormalizeUrl(
        "zee.example.com",
        healthCheck,
      );
      expect(origin).toBe("https://zee.example.com");
      expect(healthCheck).toHaveBeenCalledWith("https://zee.example.com");
    });

    it("rejects invalid URL", async () => {
      await expect(
        validateAndNormalizeUrl("not a url", vi.fn()),
      ).rejects.toMatchObject({ code: "invalid_url" });
    });

    it("rejects unreachable server", async () => {
      await expect(
        validateAndNormalizeUrl(
          "https://down.example.com",
          vi.fn().mockResolvedValue(false),
        ),
      ).rejects.toMatchObject({ code: "unreachable" });
    });
  });

  describe("addServer", () => {
    it("saves bookmark when health check passes", async () => {
      const store = memoryStore();
      const bookmark = await addServer(store, {
        url: "https://a.example.com",
        label: "Lab A",
        healthCheck: async () => true,
      });
      expect(bookmark.url).toBe("https://a.example.com");
      expect(bookmark.label).toBe("Lab A");
      expect(store.data).toHaveLength(1);
      expect(store.active).toBe(bookmark.id);
    });

    it("does not save when health check fails", async () => {
      const store = memoryStore();
      await expect(
        addServer(store, {
          url: "https://bad.example.com",
          healthCheck: async () => false,
        }),
      ).rejects.toMatchObject({ code: "unreachable" });
      expect(store.data).toHaveLength(0);
    });

    it("activates existing bookmark for duplicate origin", async () => {
      const store = memoryStore();
      const first = await addServer(store, {
        url: "https://a.example.com",
        healthCheck: async () => true,
      });
      const second = await addServer(store, {
        url: "https://a.example.com/",
        healthCheck: async () => true,
      });
      expect(second.id).toBe(first.id);
      expect(store.data).toHaveLength(1);
    });
  });

  describe("switchActiveServer", () => {
    it("clears cookies for previous origin and updates active id", async () => {
      const clearCookies = vi.fn().mockResolvedValue(undefined);
      const store = memoryStore();
      const a = await addServer(store, {
        url: "https://a.example.com",
        healthCheck: async () => true,
      });
      const b = await addServer(store, {
        url: "https://b.example.com",
        healthCheck: async () => true,
      });
      await switchActiveServer(store, b.id, a.url, clearCookies);
      expect(clearCookies).toHaveBeenCalledWith("https://a.example.com");
      expect(await getActiveServer(store)).toMatchObject({ id: b.id });
    });
  });
});
