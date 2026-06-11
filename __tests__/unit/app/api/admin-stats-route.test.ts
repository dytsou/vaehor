import { startOfToday } from "date-fns";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockFindMany, mockGetAnalyticsData, mockMapDbActivityLog } = vi.hoisted(
  () => ({
    mockFindMany: vi.fn(),
    mockGetAnalyticsData: vi.fn(),
    mockMapDbActivityLog: vi.fn(),
  }),
);

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: any[]) => any>(fn: T) => fn,
}));

vi.mock("@/lib/api-middleware", () => ({
  createAdminRoute: (
    handler: (context: { request: NextRequest }) => Promise<Response>,
  ) => {
    return async (request: NextRequest) => await handler({ request });
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    activityLog: {
      findMany: mockFindMany,
    },
  },
}));

vi.mock("@/lib/analyticsTracker", () => ({
  getAnalyticsData: mockGetAnalyticsData,
}));

vi.mock("@/lib/activityLogger", () => ({
  mapDbActivityLog: mockMapDbActivityLog,
}));

import { GET } from "@/app/api/admin/stats/route";

describe("app/api/admin/stats route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMapDbActivityLog.mockImplementation((log: unknown) => log);
    mockGetAnalyticsData.mockResolvedValue({
      bandwidth: {
        totalToday: 100,
        totalThisWeek: 700,
        totalThisMonth: 3000,
      },
    });
  });

  it("returns aggregated admin stats from activity logs", async () => {
    const todayStart = startOfToday().getTime();
    mockFindMany.mockResolvedValue([
      {
        type: "DOWNLOAD",
        timestamp: todayStart + 10 * 60 * 60 * 1000,
        itemName: "movie.mp4",
        userEmail: "admin@example.com",
      },
      {
        type: "DOWNLOAD",
        timestamp: todayStart + 11 * 60 * 60 * 1000,
        itemName: "movie.mp4",
        userEmail: "admin@example.com",
      },
      {
        type: "UPLOAD",
        timestamp: todayStart + 12 * 60 * 60 * 1000,
        itemName: "draft.docx",
        userEmail: "admin@example.com",
      },
    ]);

    const response = await GET(
      new NextRequest("http://localhost:3000/api/admin/stats"),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload.bandwidthSummary).toEqual({
      today: 100,
      thisWeek: 700,
      thisMonth: 3000,
    });
    expect(payload.topFiles[0]).toEqual({ name: "movie.mp4", count: 2 });
    expect(payload.topUploadedFiles[0]).toEqual({
      name: "draft.docx",
      count: 1,
    });
    expect(payload.topUsers[0]).toEqual({
      email: "admin@example.com",
      count: 3,
    });
    expect(payload.fileTypeDistribution).toContainEqual({
      type: "MP4",
      count: 2,
    });

    const totalDownloadsToday = payload.downloadsToday.reduce(
      (acc: number, item: { downloads: number }) => acc + item.downloads,
      0,
    );
    expect(totalDownloadsToday).toBe(2);
  });

  it("returns 500 when stats query fails", async () => {
    mockFindMany.mockRejectedValue(new Error("database unavailable"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(
      new NextRequest("http://localhost:3000/api/admin/stats"),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Gagal mengambil statistik.",
    });
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
