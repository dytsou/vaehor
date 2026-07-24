"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Loading from "@/components/common/Loading";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { id } from "date-fns/locale";
import { ArrowLeft } from "lucide-react";
import { ActivityDetails, ActivityType } from "@/lib/activityLogger";
import { getLiveLogsAction } from "@/app/actions/admin";

export interface LogEntry extends ActivityDetails {
  type: ActivityType;
  timestamp: number;
}

export default function ActivityLogPageClient(props: {
  initialLogs: LogEntry[];
}) {
  const [logs, setLogs] = useState<LogEntry[]>(props.initialLogs);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const refresh = async () => {
    setIsLoading(true);
    try {
      const data = await getLiveLogsAction({ offset: 0 });
      setLogs(((data.logs || []) as unknown as LogEntry[]) || []);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // If server gave no logs (first load), try fetching once.
    if (props.initialLogs.length === 0) {
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading && logs.length === 0) {
    return <Loading />;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="container mx-auto py-8"
    >
      <div className="flex items-center gap-4 mb-8">
        <button
          type="button"
          onClick={() => router.back()}
          className="p-2 rounded-full hover:bg-accent transition-colors"
        >
          <ArrowLeft size={24} />
        </button>
        <h1 className="text-3xl font-bold">Log Aktivitas Sistem</h1>
        <button
          onClick={refresh}
          disabled={isLoading}
          className="ml-auto px-4 py-2 rounded-md border bg-background hover:bg-accent transition-colors text-sm disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50">
              <tr>
                <th scope="col" className="px-6 py-3 font-medium">
                  Waktu
                </th>
                <th scope="col" className="px-6 py-3 font-medium">
                  Tipe Aksi
                </th>
                <th scope="col" className="px-6 py-3 font-medium">
                  Detail
                </th>
                <th scope="col" className="px-6 py-3 font-medium">
                  Pelaku
                </th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr
                  key={`${log.timestamp}-${log.type}`}
                  className="border-b last:border-b-0 hover:bg-accent/50 transition-colors"
                >
                  <td className="px-6 py-4 whitespace-nowrap text-muted-foreground">
                    {format(new Date(log.timestamp), "dd MMM yyyy, HH:mm:ss", {
                      locale: id,
                    })}
                  </td>
                  <td className="px-6 py-4">
                    <span className="font-mono text-xs bg-primary/10 text-primary px-2 py-1 rounded-md">
                      {log.type}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {log.itemName && (
                      <span>
                        Item: <strong>{log.itemName}</strong>
                      </span>
                    )}
                    {log.targetUser && (
                      <span>
                        Target: <strong>{log.targetUser}</strong>
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {log.userEmail || "Sistem / Tautan Publik"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {logs.length === 0 && (
          <p className="text-center py-12 text-muted-foreground">
            Belum ada aktivitas yang tercatat.
          </p>
        )}
      </div>
    </motion.div>
  );
}
