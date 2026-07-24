"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  Siren,
} from "lucide-react";
import { format } from "date-fns";
import { useAppStore } from "@/lib/store";
import {
  evaluateIncidentsAction,
  getSecurityLogsAction,
  listIncidentsAction,
  updateIncidentStatusAction,
} from "@/app/actions/admin";

type IncidentStatus = "open" | "acknowledged" | "resolved";
type IncidentSeverity = "warning" | "error" | "critical";

interface Incident {
  id: string;
  ruleId: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  createdAt: number;
  updatedAt: number;
  triggerCount: number;
}

interface SecurityEvent {
  id: string;
  type: string;
  userEmail?: string | null;
  ipAddress?: string;
  timestamp: number;
}

function severityClasses(severity: IncidentSeverity): string {
  if (severity === "critical") {
    return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
  }
  if (severity === "error") {
    return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
  }
  return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300";
}

function statusClasses(status: IncidentStatus): string {
  if (status === "resolved") {
    return "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300";
  }
  if (status === "acknowledged") {
    return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
  }
  return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
}

export default function SecurityCenter() {
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [updatingIncidentId, setUpdatingIncidentId] = useState<string | null>(
    null,
  );
  const addToast = useAppStore((state) => state.addToast);

  const fetchSecurityData = useCallback(async () => {
    setLoading(true);
    try {
      const [eventsPayload, incidentsPayload] = await Promise.all([
        getSecurityLogsAction(),
        listIncidentsAction({ limit: 20, status: "all" }),
      ]);

      setSecurityEvents(
        Array.isArray(eventsPayload)
          ? eventsPayload.map((e) => ({
              id: `${e.timestamp}-${e.type}-${e.userEmail ?? "unknown"}`,
              type: e.type,
              userEmail: e.userEmail ?? null,
              timestamp: e.timestamp,
            }))
          : [],
      );
      setIncidents(incidentsPayload.incidents || []);
      setOpenCount(incidentsPayload.openCount || 0);
    } catch (err) {
      console.error("Failed to fetch security data", err);
      addToast({
        message: "Failed to load security data.",
        type: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  const runEvaluation = async () => {
    setIsEvaluating(true);
    try {
      const payload = await evaluateIncidentsAction();

      addToast({
        message: `Evaluation done: ${payload.summary.createdIncidents} created, ${payload.summary.updatedIncidents} updated.`,
        type: "success",
      });
      await fetchSecurityData();
    } catch (err: unknown) {
      addToast({
        message:
          err instanceof Error
            ? err.message
            : "Failed to run incident evaluation.",
        type: "error",
      });
    } finally {
      setIsEvaluating(false);
    }
  };

  const setIncidentStatus = async (id: string, status: IncidentStatus) => {
    setUpdatingIncidentId(id);
    try {
      const payload = await updateIncidentStatusAction({ id, status });

      setIncidents((prev) =>
        prev.map((incident) =>
          incident.id === id ? (payload.incident as Incident) : incident,
        ),
      );
      addToast({
        message: `Incident marked as ${status}.`,
        type: "success",
      });
      await fetchSecurityData();
    } catch (err: unknown) {
      addToast({
        message:
          err instanceof Error
            ? err.message
            : "Failed to update incident status.",
        type: "error",
      });
    } finally {
      setUpdatingIncidentId(null);
    }
  };

  useEffect(() => {
    fetchSecurityData();
  }, [fetchSecurityData]);

  let incidentsContent;
  if (loading) {
    incidentsContent = (
      <div className="flex justify-center py-10">
        <RefreshCw className="animate-spin text-muted-foreground/60" />
      </div>
    );
  } else if (incidents.length > 0) {
    incidentsContent = incidents.map((incident) => {
      const canResolve = incident.status !== "resolved";
      const canAck = incident.status === "open";
      return (
        <div
          key={incident.id}
          className="p-3 border rounded-lg hover:bg-muted/20 transition-colors space-y-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-medium text-foreground">{incident.title}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {incident.description}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`text-[10px] font-bold px-2 py-1 rounded-full ${severityClasses(incident.severity)}`}
              >
                {incident.severity.toUpperCase()}
              </span>
              <span
                className={`text-[10px] font-bold px-2 py-1 rounded-full ${statusClasses(incident.status)}`}
              >
                {incident.status}
              </span>
            </div>
          </div>

          <div className="text-xs text-muted-foreground flex flex-wrap gap-4">
            <span>Rule: {incident.ruleId}</span>
            <span>Count: {incident.triggerCount}</span>
            <span>
              Last: {format(new Date(incident.updatedAt), "dd MMM HH:mm:ss")}
            </span>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={!canAck || updatingIncidentId === incident.id}
              onClick={() => setIncidentStatus(incident.id, "acknowledged")}
              className="px-2.5 py-1.5 text-xs rounded-md border hover:bg-accent disabled:opacity-50"
            >
              Acknowledge
            </button>
            <button
              type="button"
              disabled={!canResolve || updatingIncidentId === incident.id}
              onClick={() => setIncidentStatus(incident.id, "resolved")}
              className="px-2.5 py-1.5 text-xs rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
            >
              Resolve
            </button>
          </div>
        </div>
      );
    });
  } else {
    incidentsContent = (
      <div className="text-center py-8 text-muted-foreground bg-muted/20 border border-dashed rounded-lg">
        <ShieldCheck
          className="mx-auto mb-2 opacity-60 text-green-500"
          size={30}
        />
        <p className="text-sm">No incidents detected.</p>
      </div>
    );
  }

  let securityEventsContent;
  if (loading) {
    securityEventsContent = (
      <div className="flex justify-center py-10">
        <RefreshCw className="animate-spin text-muted-foreground/60" />
      </div>
    );
  } else if (securityEvents.length > 0) {
    securityEventsContent = securityEvents.map((event) => (
      <div
        key={event.id}
        className="flex gap-3 text-sm p-3 border rounded-lg hover:bg-muted/20 transition-colors"
      >
        <AlertCircle className="text-red-500 mt-0.5 shrink-0" size={16} />
        <div>
          <p className="font-medium text-foreground">
            {event.type.replaceAll(/_/g, " ")}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5 break-all">
            User: {event.userEmail || event.ipAddress || "Unknown"}
          </p>
          <p className="text-xs text-muted-foreground">
            {format(new Date(event.timestamp), "dd MMM, HH:mm:ss")}
          </p>
        </div>
      </div>
    ));
  } else {
    securityEventsContent = (
      <div className="text-center py-8 text-muted-foreground bg-muted/20 border border-dashed rounded-lg">
        <CheckCircle2
          className="mx-auto mb-2 opacity-60 text-green-500"
          size={30}
        />
        <p className="text-sm">No recent anomalies detected.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <div className="bg-card border rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3 mb-5 border-b pb-3">
          <div className="flex items-center gap-3">
            <Siren className="text-red-500" size={22} />
            <div>
              <h3 className="font-bold text-lg">Incident Center</h3>
              <p className="text-sm text-muted-foreground">
                Open and acknowledged security incidents
              </p>
            </div>
          </div>
          <button
            onClick={runEvaluation}
            disabled={isEvaluating}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs hover:bg-accent disabled:opacity-60"
          >
            <RefreshCw
              size={14}
              className={isEvaluating ? "animate-spin" : undefined}
            />
            Evaluate Rules
          </button>
        </div>

        <div className="mb-4 p-3 rounded-lg bg-muted/30 border text-sm flex items-center justify-between">
          <span className="text-muted-foreground">Open incidents</span>
          <span className="font-semibold text-foreground">{openCount}</span>
        </div>

        <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
          {incidentsContent}
        </div>
      </div>

      <div className="bg-card border rounded-xl p-5 shadow-sm">
        <div className="flex items-center gap-3 mb-5 border-b pb-3">
          <ShieldAlert className="text-red-500" size={24} />
          <div>
            <h3 className="font-bold text-lg">Recent Security Events</h3>
            <p className="text-sm text-muted-foreground">
              Security-related logs from activity stream
            </p>
          </div>
        </div>

        <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
          {securityEventsContent}
        </div>
      </div>
    </div>
  );
}
