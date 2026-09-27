export interface VideoProgressStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const STORAGE_KEY = "vaehor_mobile_video_progress_v1";
const MAX_SAVED_VIDEOS = 100;

export function createVideoProgressId(origin: string, fileId: string): string {
  return JSON.stringify([origin.replace(/\/+$/, ""), fileId]);
}

export async function getVideoProgress(
  storage: VideoProgressStore,
  videoId: string,
): Promise<number> {
  const saved = await readProgressMap(storage);
  const value = saved[videoId];
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

export async function saveVideoProgress(
  storage: VideoProgressStore,
  videoId: string,
  seconds: number,
): Promise<void> {
  if (!Number.isFinite(seconds) || seconds < 1) return;

  const saved = await readProgressMap(storage);
  delete saved[videoId];
  saved[videoId] = Math.floor(seconds);
  const keys = Object.keys(saved);
  if (keys.length > MAX_SAVED_VIDEOS) {
    for (const key of keys.slice(0, keys.length - MAX_SAVED_VIDEOS)) {
      delete saved[key];
    }
  }
  await storage.setItem(STORAGE_KEY, JSON.stringify(saved));
}

export async function clearVideoProgress(
  storage: VideoProgressStore,
  videoId: string,
): Promise<void> {
  const saved = await readProgressMap(storage);
  if (!(videoId in saved)) return;
  delete saved[videoId];
  await storage.setItem(STORAGE_KEY, JSON.stringify(saved));
}

async function readProgressMap(
  storage: VideoProgressStore,
): Promise<Record<string, number>> {
  try {
    const value = await storage.getItem(STORAGE_KEY);
    if (!value) return {};
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([, seconds]) =>
          typeof seconds === "number" &&
          Number.isFinite(seconds) &&
          seconds > 0,
      ),
    );
  } catch {
    return {};
  }
}
