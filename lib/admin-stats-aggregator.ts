import type {
  DayOfWeekDownload,
  FileTypeStat,
  HourlyDownload,
  TopFile,
  TopUser,
} from "@/lib/adminStats";
import type { ActivityLog } from "@/lib/activityLogger";
import { getDay } from "date-fns";

export interface ActivityLogTimeBounds {
  todayStart: number;
  sevenWeeksAgo: number;
}

export interface ActivityLogAggregates {
  downloadsToday: HourlyDownload[];
  downloadsByDayOfWeek: DayOfWeekDownload[];
  fileCounts: Map<string, number>;
  userCounts: Map<string, number>;
  uploadCounts: Map<string, number>;
  typeCounts: Map<string, number>;
}

export function createHourlyDownloads(): HourlyDownload[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    name: `${hour}:00`,
    downloads: 0,
  }));
}

export function createDayOfWeekDownloads(): DayOfWeekDownload[] {
  return [
    { name: "Min", downloads: 0 },
    { name: "Sen", downloads: 0 },
    { name: "Sel", downloads: 0 },
    { name: "Rab", downloads: 0 },
    { name: "Kam", downloads: 0 },
    { name: "Jum", downloads: 0 },
    { name: "Sab", downloads: 0 },
  ];
}

export function createActivityLogAggregates(): ActivityLogAggregates {
  return {
    downloadsToday: createHourlyDownloads(),
    downloadsByDayOfWeek: createDayOfWeekDownloads(),
    fileCounts: new Map<string, number>(),
    userCounts: new Map<string, number>(),
    uploadCounts: new Map<string, number>(),
    typeCounts: new Map<string, number>(),
  };
}

function incrementCount(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) || 0) + 1);
}

function recordUserActivity(log: ActivityLog, userCounts: Map<string, number>) {
  if (!log.userEmail) {
    return;
  }

  incrementCount(userCounts, log.userEmail);
}

function recordUploadActivity(
  log: ActivityLog,
  uploadCounts: Map<string, number>,
) {
  if (log.type !== "UPLOAD" || !log.itemName) {
    return;
  }

  incrementCount(uploadCounts, log.itemName);
}

function recordFileTypeCount(
  itemName: string,
  typeCounts: Map<string, number>,
) {
  const extension = itemName.split(".").pop()?.toUpperCase() || "UNKNOWN";
  const typeKey = extension.length <= 5 ? extension : "OTHER";
  incrementCount(typeCounts, typeKey);
}

function recordTodayDownload(
  log: ActivityLog,
  downloadsToday: HourlyDownload[],
  todayStart: number,
) {
  if (log.timestamp < todayStart) {
    return;
  }

  const hour = new Date(log.timestamp).getHours();
  downloadsToday[hour].downloads++;
}

function recordWeeklyDownload(
  log: ActivityLog,
  downloadsByDayOfWeek: DayOfWeekDownload[],
  sevenWeeksAgo: number,
) {
  if (log.timestamp < sevenWeeksAgo) {
    return;
  }

  const dayIndex = getDay(new Date(log.timestamp));
  downloadsByDayOfWeek[dayIndex].downloads++;
}

function recordDownloadActivity(
  log: ActivityLog,
  aggregates: ActivityLogAggregates,
  bounds: ActivityLogTimeBounds,
) {
  if (log.type !== "DOWNLOAD") {
    return;
  }

  recordTodayDownload(log, aggregates.downloadsToday, bounds.todayStart);
  recordWeeklyDownload(
    log,
    aggregates.downloadsByDayOfWeek,
    bounds.sevenWeeksAgo,
  );

  if (!log.itemName) {
    return;
  }

  incrementCount(aggregates.fileCounts, log.itemName);
  recordFileTypeCount(log.itemName, aggregates.typeCounts);
}

function processActivityLog(
  log: ActivityLog,
  aggregates: ActivityLogAggregates,
  bounds: ActivityLogTimeBounds,
) {
  recordUserActivity(log, aggregates.userCounts);
  recordUploadActivity(log, aggregates.uploadCounts);
  recordDownloadActivity(log, aggregates, bounds);
}

export function aggregateActivityLogs(
  logs: ActivityLog[],
  bounds: ActivityLogTimeBounds,
): ActivityLogAggregates {
  const aggregates = createActivityLogAggregates();

  for (const log of logs) {
    processActivityLog(log, aggregates, bounds);
  }

  return aggregates;
}

function topFiveFromMap<T>(
  counts: Map<string, number>,
  mapEntry: (key: string, count: number) => T,
): T[] {
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([key, count]) => mapEntry(key, count));
}

export function buildTopFiles(fileCounts: Map<string, number>): TopFile[] {
  return topFiveFromMap(fileCounts, (name, count) => ({ name, count }));
}

export function buildTopUsers(userCounts: Map<string, number>): TopUser[] {
  return topFiveFromMap(userCounts, (email, count) => ({ email, count }));
}

export function buildFileTypeDistribution(
  typeCounts: Map<string, number>,
): FileTypeStat[] {
  return topFiveFromMap(typeCounts, (type, count) => ({ type, count }));
}
