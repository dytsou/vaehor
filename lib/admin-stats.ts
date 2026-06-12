import type { AdminStats } from "@/lib/adminStats";
import { mapDbActivityLog } from "@/lib/activityLogger";
import { getAnalyticsData } from "@/lib/analyticsTracker";
import { db } from "@/lib/db";
import {
  aggregateActivityLogs,
  buildFileTypeDistribution,
  buildTopFiles,
  buildTopUsers,
} from "@/lib/admin-stats-aggregator";
import { startOfToday, subDays } from "date-fns";
import { unstable_cache } from "next/cache";

const getAdminStatsCached = unstable_cache(
  async (): Promise<AdminStats> => {
    const ninetyDaysAgo = subDays(new Date(), 90).getTime();
    const allLogsRaw = await db.activityLog.findMany({
      where: { timestamp: { gte: ninetyDaysAgo } },
    });

    const allLogs = allLogsRaw.map(mapDbActivityLog);
    const aggregates = aggregateActivityLogs(allLogs, {
      todayStart: startOfToday().getTime(),
      sevenWeeksAgo: subDays(new Date(), 49).getTime(),
    });

    const analyticsData = await getAnalyticsData();

    return {
      downloadsToday: aggregates.downloadsToday,
      topFiles: buildTopFiles(aggregates.fileCounts),
      downloadsByDayOfWeek: aggregates.downloadsByDayOfWeek,
      topUsers: buildTopUsers(aggregates.userCounts),
      topUploadedFiles: buildTopFiles(aggregates.uploadCounts),
      fileTypeDistribution: buildFileTypeDistribution(aggregates.typeCounts),
      bandwidthSummary: {
        today: analyticsData.bandwidth.totalToday,
        thisWeek: analyticsData.bandwidth.totalThisWeek,
        thisMonth: analyticsData.bandwidth.totalThisMonth,
      },
    };
  },
  ["admin-stats"],
  { revalidate: 300, tags: ["admin-stats"] },
);

export async function getAdminStats(): Promise<AdminStats> {
  return getAdminStatsCached();
}
