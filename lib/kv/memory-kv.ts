import { memoryCache, CACHE_TTL } from "../memory-cache";
import type { KVClient, KVPipeline } from "./types";

export class InMemoryKV implements KVClient {
  pipeline(): KVPipeline {
    const commands: Array<() => Promise<unknown>> = [];
    const pipeline: KVPipeline = {
      sismember: (key: string, member: unknown) => {
        commands.push(() => this.sismember(key, member));
        return pipeline;
      },
      exec: () => Promise.all(commands.map((cmd) => cmd())),
    };
    return pipeline;
  }
  private readonly store = new Map<string, unknown>();
  private readonly expirations = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly hashStore = new Map<string, Map<string, unknown>>();
  private readonly setStore = new Map<string, Set<unknown>>();
  private readonly sortedSets = new Map<string, Map<string, number>>();

  get<T>(key: string): Promise<T | null> {
    const cached = memoryCache.get<T>(`kv:${key}`);
    if (cached !== null) return Promise.resolve(cached);

    const value = (this.store.get(key) as T) ?? null;
    if (value !== null) {
      memoryCache.set(`kv:${key}`, value, CACHE_TTL.FOLDER_CONTENT);
    }
    return Promise.resolve(value);
  }

  set(key: string, value: unknown, options?: { ex?: number }): Promise<string> {
    this.store.set(key, value);
    memoryCache.set(`kv:${key}`, value, (options?.ex ?? 3600) * 1000);

    const existingTimer = this.expirations.get(key);
    if (existingTimer) clearTimeout(existingTimer);

    if (options?.ex) {
      const timeoutMs = Math.min(options.ex * 1000, 2_147_483_647);
      const timer = setTimeout(() => {
        this.store.delete(key);
        memoryCache.delete(`kv:${key}`);
        this.expirations.delete(key);
      }, timeoutMs);
      if (typeof timer === "object" && timer.unref) timer.unref();
      this.expirations.set(key, timer);
    }
    return Promise.resolve("OK");
  }

  del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (this.store.delete(key)) deleted++;
      if (this.hashStore.delete(key)) deleted++;
      if (this.setStore.delete(key)) deleted++;
      this.sortedSets.delete(key);
      memoryCache.delete(`kv:${key}`);
      memoryCache.delete(`kv:hash:${key}`);

      const timer = this.expirations.get(key);
      if (timer) {
        clearTimeout(timer);
        this.expirations.delete(key);
      }
    }
    return Promise.resolve(deleted);
  }

  exists(...keys: string[]): Promise<number> {
    return Promise.resolve(
      keys.filter(
        (key) =>
          this.store.has(key) ||
          this.hashStore.has(key) ||
          this.setStore.has(key) ||
          this.sortedSets.has(key),
      ).length,
    );
  }

  keys(pattern: string): Promise<string[]> {
    try {
      const regex = new RegExp(
        "^" + pattern.replaceAll("*", ".*").replaceAll("?", ".") + "$",
      );
      const allKeys = new Set([
        ...this.store.keys(),
        ...this.hashStore.keys(),
        ...this.setStore.keys(),
        ...this.sortedSets.keys(),
      ]);
      return Promise.resolve(
        Array.from(allKeys).filter((key) => regex.test(key)),
      );
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async scanKeys(pattern: string): Promise<string[]> {
    return await this.keys(pattern);
  }

  mget<T>(...keys: string[]): Promise<(T | null)[]> {
    return Promise.resolve(
      keys.map((key) => (this.store.get(key) as T) ?? null),
    );
  }

  mset(keyValues: Record<string, unknown>): Promise<string> {
    for (const [key, value] of Object.entries(keyValues)) {
      this.store.set(key, value);
      memoryCache.set(`kv:${key}`, value, CACHE_TTL.FOLDER_CONTENT);
    }
    return Promise.resolve("OK");
  }

  incr(key: string): Promise<number> {
    const val = Number(this.store.get(key) || 0);
    const newVal = val + 1;
    this.store.set(key, newVal);
    return Promise.resolve(newVal);
  }

  expire(key: string, seconds: number): Promise<number> {
    if (
      !this.store.has(key) &&
      !this.hashStore.has(key) &&
      !this.setStore.has(key) &&
      !this.sortedSets.has(key)
    ) {
      return Promise.resolve(0);
    }

    const existingTimer = this.expirations.get(key);
    if (existingTimer) clearTimeout(existingTimer);

    const timeoutMs = Math.min(seconds * 1000, 2_147_483_647);
    const timer = setTimeout(() => {
      this.store.delete(key);
      this.hashStore.delete(key);
      this.setStore.delete(key);
      this.sortedSets.delete(key);
      memoryCache.delete(`kv:${key}`);
      memoryCache.delete(`kv:hash:${key}`);
      this.expirations.delete(key);
    }, timeoutMs);
    if (typeof timer === "object" && timer.unref) timer.unref();
    this.expirations.set(key, timer);
    return Promise.resolve(1);
  }

  hgetall<T>(key: string): Promise<T | null> {
    const cached = memoryCache.get<T>(`kv:hash:${key}`);
    if (cached !== null) return Promise.resolve(cached);

    const hash = this.hashStore.get(key);
    if (!hash) return Promise.resolve(null);

    const result = Object.fromEntries(hash) as T;
    memoryCache.set(`kv:hash:${key}`, result, CACHE_TTL.PROTECTED_FOLDERS);
    return Promise.resolve(result);
  }

  hset(key: string, obj: Record<string, unknown>): Promise<number> {
    let hash = this.hashStore.get(key);
    if (!hash) {
      hash = new Map();
      this.hashStore.set(key, hash);
    }

    for (const [field, value] of Object.entries(obj)) {
      hash.set(field, value);
    }

    memoryCache.delete(`kv:hash:${key}`);
    return Promise.resolve(Object.keys(obj).length);
  }

  hget<T>(key: string, field: string): Promise<T | null> {
    const hash = this.hashStore.get(key);
    return Promise.resolve((hash?.get(field) as T) ?? null);
  }

  hdel(key: string, ...fields: string[]): Promise<number> {
    const hash = this.hashStore.get(key);
    if (!hash) return Promise.resolve(0);

    let deleted = 0;
    for (const field of fields) {
      if (hash.delete(field)) deleted++;
    }

    memoryCache.delete(`kv:hash:${key}`);
    return Promise.resolve(deleted);
  }

  sadd(key: string, ...members: unknown[]): Promise<number> {
    let set = this.setStore.get(key);
    if (!set) {
      set = new Set();
      this.setStore.set(key, set);
    }

    let added = 0;
    for (const member of members) {
      if (!set.has(member)) {
        set.add(member);
        added++;
      }
    }
    return Promise.resolve(added);
  }

  srem(key: string, ...members: unknown[]): Promise<number> {
    const set = this.setStore.get(key);
    if (!set) return Promise.resolve(0);

    let removed = 0;
    for (const member of members) {
      if (set.delete(member)) removed++;
    }
    return Promise.resolve(removed);
  }

  sismember(key: string, member: unknown): Promise<number> {
    const cacheKey = `kv:sismember:${key}:${String(member)}`;
    const cached = memoryCache.get<number>(cacheKey);
    if (cached !== null) return Promise.resolve(cached);

    const set = this.setStore.get(key);
    const result = set?.has(member) ? 1 : 0;
    memoryCache.set(cacheKey, result, CACHE_TTL.USER_ACCESS);
    return Promise.resolve(result);
  }

  smembers(key: string): Promise<string[]> {
    const set = this.setStore.get(key);
    return Promise.resolve(set ? (Array.from(set) as string[]) : []);
  }

  scard(key: string): Promise<number> {
    const set = this.setStore.get(key);
    return Promise.resolve(set?.size ?? 0);
  }

  zadd(
    key: string,
    options: { score: number; member: string },
  ): Promise<number> {
    let zset = this.sortedSets.get(key);
    if (!zset) {
      zset = new Map();
      this.sortedSets.set(key, zset);
    }

    const isNew = !zset.has(options.member);
    zset.set(options.member, options.score);
    return Promise.resolve(isNew ? 1 : 0);
  }

  zrange<T>(
    key: string,
    start: number,
    stop: number,
    options?: { rev?: boolean; byScore?: boolean },
  ): Promise<T[]> {
    const zset = this.sortedSets.get(key);
    if (!zset) return Promise.resolve([]);

    let entries = Array.from(zset.entries()).sort((a, b) => a[1] - b[1]);

    if (options?.byScore) {
      entries = entries.filter(([, score]) => score >= start && score <= stop);
    }

    if (options?.rev) {
      entries = entries.reverse();
    }

    if (!options?.byScore) {
      const len = entries.length;
      const startIdx = start < 0 ? Math.max(0, len + start) : start;
      const endIdx = stop < 0 ? len + stop + 1 : stop + 1;
      entries = entries.slice(startIdx, endIdx);
    }

    return Promise.resolve(
      entries.map(([member]) => {
        try {
          return JSON.parse(member) as T;
        } catch {
          return member as unknown as T;
        }
      }),
    );
  }

  zremrangebyscore(key: string, min: number, max: number): Promise<number> {
    const zset = this.sortedSets.get(key);
    if (!zset) return Promise.resolve(0);

    let removed = 0;
    for (const [member, score] of zset.entries()) {
      if (score >= min && score <= max) {
        zset.delete(member);
        removed++;
      }
    }
    return Promise.resolve(removed);
  }

  zcard(key: string): Promise<number> {
    const zset = this.sortedSets.get(key);
    return Promise.resolve(zset?.size ?? 0);
  }

  zrem(key: string, ...members: string[]): Promise<number> {
    const zset = this.sortedSets.get(key);
    if (!zset) return Promise.resolve(0);

    let removed = 0;
    for (const member of members) {
      if (zset.delete(member)) removed++;
    }
    return Promise.resolve(removed);
  }

  zscore(key: string, member: string): Promise<number | null> {
    const zset = this.sortedSets.get(key);
    return Promise.resolve(zset?.get(member) ?? null);
  }

  lpush(key: string, ...values: unknown[]): Promise<number> {
    let list = this.store.get(key) as unknown[] | undefined;
    if (!Array.isArray(list)) {
      list = [];
      this.store.set(key, list);
    }
    list.unshift(...values);
    return Promise.resolve(list.length);
  }

  rpush(key: string, ...values: unknown[]): Promise<number> {
    let list = this.store.get(key) as unknown[] | undefined;
    if (!Array.isArray(list)) {
      list = [];
      this.store.set(key, list);
    }
    list.push(...values);
    return Promise.resolve(list.length);
  }

  lrange<T>(key: string, start: number, stop: number): Promise<T[]> {
    const list = this.store.get(key) as unknown[] | undefined;
    if (!Array.isArray(list)) return Promise.resolve([]);

    const end = stop < 0 ? list.length + stop + 1 : stop + 1;
    return Promise.resolve(list.slice(start, end) as T[]);
  }

  llen(key: string): Promise<number> {
    const list = this.store.get(key) as unknown[] | undefined;
    return Promise.resolve(Array.isArray(list) ? list.length : 0);
  }

  ltrim(key: string, start: number, stop: number): Promise<string> {
    const list = this.store.get(key) as unknown[] | undefined;
    if (Array.isArray(list)) {
      const actualStop = stop < 0 ? list.length + stop : stop;
      const newList = list.slice(start, actualStop + 1);
      this.store.set(key, newList);
    }
    return Promise.resolve("OK");
  }

  flushall(): Promise<string> {
    this.store.clear();
    this.hashStore.clear();
    this.setStore.clear();
    this.sortedSets.clear();
    for (const timer of this.expirations.values()) {
      clearTimeout(timer);
    }
    this.expirations.clear();
    return Promise.resolve("OK");
  }

  getStats() {
    return {
      stringKeys: this.store.size,
      hashKeys: this.hashStore.size,
      setKeys: this.setStore.size,
      totalKeys: this.store.size + this.hashStore.size + this.setStore.size,
      expiringKeys: this.expirations.size,
    };
  }
}
