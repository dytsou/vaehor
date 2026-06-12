import { kv } from "@/lib/kv";
import { randomUUID } from "crypto";
import {
  pageViewEventSchema,
  type DeviceStatsPayload,
  type PopularPagePayload,
  type ReferrerPayload,
} from "@/lib/telemetry";
import {
  mapBandwidthToSeverity,
  publishPipelineEvent,
} from "@/lib/events/pipeline";
import { parseUserAgent } from "@/lib/user-agent";
import { ANALYTICS_KEYS } from "@/lib/analytics-keys";
import {
  buildAnalyticsData,
  getAnalyticsDayKey,
} from "@/lib/analytics-data-aggregation";

const LOG_EXPIRATION_SECONDS = 60 * 60 * 24 * 90;

export interface AnalyticsData {
  overview: {
    viewsToday: number;
    viewsYesterday: number;
    viewsThisWeek: number;
    viewsThisMonth: number;
    visitorsToday: number;
    visitorsYesterday: number;
    visitorsThisWeek: number;
    visitorsThisMonth: number;
    activeNow: number;
  };
  hourlyViews: { hour: string; views: number; visitors: number }[];
  dailyTrend: { date: string; views: number; visitors: number }[];
  popularPages: { path: string; views: number }[];
  deviceBreakdown: {
    browsers: { name: string; count: number }[];
    os: { name: string; count: number }[];
    devices: { name: string; count: number }[];
  };
  topReferrers: { source: string; count: number }[];
  bandwidth: {
    totalToday: number;
    totalThisWeek: number;
    totalThisMonth: number;
    dailyTrend: { date: string; bytes: number }[];
  };
}

function generateId(): string {
  return `${Date.now()}-${randomUUID().replace(/-/g, "").substring(0, 12)}`;
}

export async function trackPageView(params: {
  path: string;
  ip: string;
  userAgent: string;
  referrer: string;
}): Promise<void> {
  try {
    const timestamp = Date.now();
    const dayKey = getAnalyticsDayKey(timestamp);
    const { browser, os, device } = parseUserAgent(params.userAgent);

    const raw = `${params.ip}:${params.userAgent}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const char = raw.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    const visitorId = `v-${Math.abs(hash).toString(36)}`;

    const event = pageViewEventSchema.parse({
      id: generateId(),
      path: params.path,
      timestamp,
      visitorId,
      ip: params.ip,
      userAgent: params.userAgent,
      referrer: params.referrer,
      browser,
      os,
      device,
    });

    await kv.zadd(ANALYTICS_KEYS.pageview, {
      score: timestamp,
      member: JSON.stringify(event),
    });

    await kv.incr(`${ANALYTICS_KEYS.dailyViews}:${dayKey}`);
    await kv.expire(
      `${ANALYTICS_KEYS.dailyViews}:${dayKey}`,
      LOG_EXPIRATION_SECONDS,
    );

    await kv.sadd(`${ANALYTICS_KEYS.visitor}:${dayKey}`, visitorId);
    await kv.expire(
      `${ANALYTICS_KEYS.visitor}:${dayKey}`,
      LOG_EXPIRATION_SECONDS,
    );

    const isNewVisitorToday = await kv.scard(
      `${ANALYTICS_KEYS.visitor}:${dayKey}`,
    );
    await kv.set(
      `${ANALYTICS_KEYS.dailyVisitors}:${dayKey}`,
      isNewVisitorToday,
      {
        ex: LOG_EXPIRATION_SECONDS,
      },
    );

    await kv.zadd(ANALYTICS_KEYS.activeVisitors, {
      score: timestamp,
      member: visitorId,
    });

    await kv.zadd(ANALYTICS_KEYS.popularPages, {
      score: timestamp,
      member: JSON.stringify({
        path: params.path,
        dayKey,
      } satisfies PopularPagePayload),
    });

    await kv.zadd(ANALYTICS_KEYS.deviceStats, {
      score: timestamp,
      member: JSON.stringify({
        browser,
        os,
        device,
        dayKey,
      } satisfies DeviceStatsPayload),
    });

    if (params.referrer && params.referrer !== "") {
      try {
        const refUrl = new URL(params.referrer);
        const source = refUrl.hostname || "Direct";
        await kv.zadd(ANALYTICS_KEYS.referrers, {
          score: timestamp,
          member: JSON.stringify({ source, dayKey } satisfies ReferrerPayload),
        });
      } catch {}
    }

    const expirationTime = Date.now() - LOG_EXPIRATION_SECONDS * 1000;
    await Promise.all([
      kv.zremrangebyscore(ANALYTICS_KEYS.pageview, 0, expirationTime),
      kv.zremrangebyscore(ANALYTICS_KEYS.activeVisitors, 0, expirationTime),
      kv.zremrangebyscore(ANALYTICS_KEYS.popularPages, 0, expirationTime),
      kv.zremrangebyscore(ANALYTICS_KEYS.deviceStats, 0, expirationTime),
      kv.zremrangebyscore(ANALYTICS_KEYS.referrers, 0, expirationTime),
    ]);

    await publishPipelineEvent({
      id: event.id,
      timestamp: event.timestamp,
      type: "analytics:pageview",
      message: `Page viewed: ${event.path}`,
      severity: "info",
      payload: {
        path: event.path,
        referrer: event.referrer,
        visitorId: event.visitorId,
        ip: event.ip,
      },
      metadata: {
        browser: event.browser,
        os: event.os,
        device: event.device,
      },
      category: "analytics",
      source: "analytics",
      publishRealtime: false,
    });
  } catch (error) {
    console.error("[Analytics] Failed to track page view:", error);
  }
}

export async function trackBandwidth(bytes: number): Promise<void> {
  try {
    const dayKey = getAnalyticsDayKey(Date.now());
    const currentKey = `${ANALYTICS_KEYS.bandwidth}:${dayKey}`;
    const current = await kv.get<number>(currentKey);
    await kv.set(currentKey, (current || 0) + bytes, {
      ex: LOG_EXPIRATION_SECONDS,
    });

    await publishPipelineEvent({
      type: "analytics:bandwidth",
      message: `Bandwidth tracked: ${bytes} bytes`,
      severity: mapBandwidthToSeverity(bytes),
      payload: {
        bytes,
        dayKey,
      },
      category: "analytics",
      source: "analytics",
      publishRealtime: false,
    });
  } catch (error) {
    console.error("[Analytics] Failed to track bandwidth:", error);
  }
}

export async function getAnalyticsData(): Promise<AnalyticsData> {
  return buildAnalyticsData();
}
