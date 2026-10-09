import type { z } from "zod";
import { kv } from "@/lib/kv";
import { ANALYTICS_KEYS, MS_PER_DAY } from "@/lib/analytics-keys";
import type { AnalyticsData } from "@/lib/analyticsTracker";
import {
  deviceStatsPayloadSchema,
  pageViewEventSchema,
  parseSchemaValue,
  popularPagePayloadSchema,
  referrerPayloadSchema,
} from "@/lib/telemetry";

export function getAnalyticsDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatTrendDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getDate()}/${date.getMonth() + 1}`;
}

async function getDailyMetric(
  keyPrefix: string,
  dayKey: string,
): Promise<number> {
  return (await kv.get<number>(`${keyPrefix}:${dayKey}`)) || 0;
}

function parseStoredPayload<T>(
  raw: unknown,
  schema: z.ZodType<T>,
): T | undefined {
  if (typeof raw === "string") {
    return parseSchemaValue(raw, schema) ?? undefined;
  }

  return schema.safeParse(raw).data;
}

function incrementCount(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) || 0) + 1);
}

function toTopNamedCounts(map: Map<string, number>, limit = 8) {
  return Array.from(map.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

async function fetchDayViewTotals(now: number, dayOffset: number) {
  const dayKey = getAnalyticsDayKey(now - dayOffset * MS_PER_DAY);
  const [views, visitors] = await Promise.all([
    getDailyMetric(ANALYTICS_KEYS.dailyViews, dayKey),
    getDailyMetric(ANALYTICS_KEYS.dailyVisitors, dayKey),
  ]);

  return { views, visitors };
}

async function fetchOverviewMetrics(now: number) {
  const dailyTotals = await Promise.all(
    Array.from({ length: 30 }, (_, dayOffset) =>
      fetchDayViewTotals(now, dayOffset),
    ),
  );
  const [today, yesterday] = dailyTotals;

  let viewsThisWeek = 0;
  let viewsThisMonth = 0;
  let visitorsThisWeek = 0;
  let visitorsThisMonth = 0;

  dailyTotals.forEach((totals, dayOffset) => {
    viewsThisMonth += totals.views;
    visitorsThisMonth += totals.visitors;

    if (dayOffset < 7) {
      viewsThisWeek += totals.views;
      visitorsThisWeek += totals.visitors;
    }
  });

  const fiveMinAgo = now - 5 * 60 * 1000;
  const activeMembers = await kv.zrange(
    ANALYTICS_KEYS.activeVisitors,
    fiveMinAgo,
    now,
    { byScore: true },
  );

  return {
    viewsToday: today.views,
    viewsYesterday: yesterday.views,
    viewsThisWeek,
    viewsThisMonth,
    visitorsToday: today.visitors,
    visitorsYesterday: yesterday.visitors,
    visitorsThisWeek,
    visitorsThisMonth,
    activeNow: new Set(activeMembers).size,
  };
}

function createEmptyHourlyViews() {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour: `${String(hour).padStart(2, "0")}:00`,
    views: 0,
    visitors: 0,
  }));
}

function recordHourlyPageView(
  event: { timestamp: number; visitorId: string },
  hourlyViews: ReturnType<typeof createEmptyHourlyViews>,
  hourlyVisitorSets: Map<number, Set<string>>,
) {
  const hour = new Date(event.timestamp).getHours();
  hourlyViews[hour].views++;

  const visitors = hourlyVisitorSets.get(hour) ?? new Set<string>();
  visitors.add(event.visitorId);
  hourlyVisitorSets.set(hour, visitors);
}

function applyHourlyVisitorCounts(
  hourlyViews: ReturnType<typeof createEmptyHourlyViews>,
  hourlyVisitorSets: Map<number, Set<string>>,
) {
  for (const [hour, visitors] of hourlyVisitorSets) {
    hourlyViews[hour].visitors = visitors.size;
  }
}

async function buildHourlyViews(now: number) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const hourlyViews = createEmptyHourlyViews();
  const hourlyVisitorSets = new Map<number, Set<string>>();
  const todayEvents = await kv.zrange<string>(
    ANALYTICS_KEYS.pageview,
    todayStart.getTime(),
    now,
    { byScore: true },
  );

  for (const rawEvent of todayEvents) {
    try {
      const event = parseStoredPayload(rawEvent, pageViewEventSchema);
      if (!event) {
        continue;
      }

      recordHourlyPageView(event, hourlyViews, hourlyVisitorSets);
    } catch {
      // Ignore malformed historical events.
    }
  }

  applyHourlyVisitorCounts(hourlyViews, hourlyVisitorSets);
  return hourlyViews;
}

async function buildDailyTrend(now: number) {
  const dailyTotals = await Promise.all(
    Array.from({ length: 30 }, (_, index) =>
      fetchDayViewTotals(now, 29 - index),
    ),
  );

  return dailyTotals.map((totals, index) => ({
    date: formatTrendDate(now - (29 - index) * MS_PER_DAY),
    views: totals.views,
    visitors: totals.visitors,
  }));
}

async function buildPopularPages(fromTimestamp: number, toTimestamp: number) {
  const popularRaw = await kv.zrange(
    ANALYTICS_KEYS.popularPages,
    fromTimestamp,
    toTimestamp,
    { byScore: true },
  );
  const pageCounts = new Map<string, number>();

  for (const raw of popularRaw) {
    const parsed = parseStoredPayload(raw, popularPagePayloadSchema);
    const path = parsed?.path || "/";
    incrementCount(pageCounts, path);
  }

  return Array.from(pageCounts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 10)
    .map(([path, views]) => ({ path, views }));
}

async function buildDeviceBreakdown(
  fromTimestamp: number,
  toTimestamp: number,
) {
  const deviceRaw = await kv.zrange(
    ANALYTICS_KEYS.deviceStats,
    fromTimestamp,
    toTimestamp,
    { byScore: true },
  );

  const browserCounts = new Map<string, number>();
  const osCounts = new Map<string, number>();
  const deviceCounts = new Map<string, number>();

  for (const raw of deviceRaw) {
    const parsed = parseStoredPayload(raw, deviceStatsPayloadSchema);
    if (!parsed) {
      continue;
    }

    incrementCount(browserCounts, parsed.browser);
    incrementCount(osCounts, parsed.os);
    incrementCount(deviceCounts, parsed.device);
  }

  return {
    browsers: toTopNamedCounts(browserCounts),
    os: toTopNamedCounts(osCounts),
    devices: toTopNamedCounts(deviceCounts),
  };
}

async function buildTopReferrers(fromTimestamp: number, toTimestamp: number) {
  const referrerRaw = await kv.zrange(
    ANALYTICS_KEYS.referrers,
    fromTimestamp,
    toTimestamp,
    { byScore: true },
  );
  const referrerCounts = new Map<string, number>();

  for (const raw of referrerRaw) {
    const parsed = parseStoredPayload(raw, referrerPayloadSchema);
    if (!parsed) {
      continue;
    }

    incrementCount(referrerCounts, parsed.source);
  }

  return Array.from(referrerCounts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 10)
    .map(([source, count]) => ({ source, count }));
}

async function buildBandwidthSummary(now: number) {
  const dailyBytes = await Promise.all(
    Array.from({ length: 30 }, (_, index) => {
      const dayOffset = 29 - index;
      const dayKey = getAnalyticsDayKey(now - dayOffset * MS_PER_DAY);
      return kv.get<number>(`${ANALYTICS_KEYS.bandwidth}:${dayKey}`);
    }),
  );
  const dailyTrend: AnalyticsData["bandwidth"]["dailyTrend"] = dailyBytes.map(
    (value, index) => ({
      date: formatTrendDate(now - (29 - index) * MS_PER_DAY),
      bytes: value || 0,
    }),
  );
  const totalThisMonth = dailyTrend.reduce(
    (total, day) => total + day.bytes,
    0,
  );
  const totalThisWeek = dailyTrend
    .slice(-7)
    .reduce((total, day) => total + day.bytes, 0);
  const totalToday = dailyTrend[dailyTrend.length - 1]?.bytes ?? 0;

  return {
    totalToday,
    totalThisWeek,
    totalThisMonth,
    dailyTrend,
  };
}

export async function buildAnalyticsData(
  now = Date.now(),
): Promise<AnalyticsData> {
  const thirtyDaysAgo = now - 30 * MS_PER_DAY;

  const [
    overview,
    hourlyViews,
    dailyTrend,
    popularPages,
    deviceBreakdown,
    topReferrers,
    bandwidth,
  ] = await Promise.all([
    fetchOverviewMetrics(now),
    buildHourlyViews(now),
    buildDailyTrend(now),
    buildPopularPages(thirtyDaysAgo, now),
    buildDeviceBreakdown(thirtyDaysAgo, now),
    buildTopReferrers(thirtyDaysAgo, now),
    buildBandwidthSummary(now),
  ]);

  return {
    overview,
    hourlyViews,
    dailyTrend,
    popularPages,
    deviceBreakdown,
    topReferrers,
    bandwidth,
  };
}
