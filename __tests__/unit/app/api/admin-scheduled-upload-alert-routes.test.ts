import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  listAlerts: vi.fn(),
  updateAlert: vi.fn(),
  cancelSchedule: vi.fn(),
}));

vi.mock("@/lib/api-middleware", () => ({
  createAdminRoute: (
    handler: (context: {
      request: NextRequest;
      body?: unknown;
      session: { user: { email: string; role: string } };
    }) => Promise<Response>,
    options?: {
      bodySchema?: {
        safeParse: (value: unknown) => {
          success: boolean;
          data?: unknown;
          error?: { issues: unknown[] };
        };
      };
    },
  ) => {
    return async (request: NextRequest) => {
      let body: unknown;
      if (options?.bodySchema) {
        const parsed = options.bodySchema.safeParse(await request.json());
        if (!parsed.success) {
          return Response.json({ error: "Invalid body." }, { status: 400 });
        }
        body = parsed.data;
      }
      return handler({
        request,
        body,
        session: { user: { email: "admin@example.com", role: "ADMIN" } },
      });
    };
  },
}));

vi.mock("@/lib/services/scheduled-upload-admin-alert", () => ({
  listScheduledUploadAdminAlerts: mocks.listAlerts,
  updateScheduledUploadAdminAlertStatus: mocks.updateAlert,
}));

vi.mock("@/lib/services/scheduled-upload", () => ({
  cancelScheduledUploadAsAdmin: mocks.cancelSchedule,
}));

import { GET as listAlertsRoute } from "@/app/api/admin/scheduled-uploads/alerts/route";
import { POST as updateAlertRoute } from "@/app/api/admin/scheduled-uploads/alerts/update/route";
import { POST as cancelScheduleRoute } from "@/app/api/admin/scheduled-uploads/cancel/route";

describe("admin scheduled-upload routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAlerts.mockResolvedValue([{ id: "alert-1", status: "OPEN" }]);
    mocks.updateAlert.mockResolvedValue({
      id: "alert-1",
      status: "ACKNOWLEDGED",
    });
    mocks.cancelSchedule.mockResolvedValue({
      id: "schedule-1",
      status: "CANCELED",
    });
  });

  it("lists only the requested alert state", async () => {
    const request = new NextRequest(
      "http://localhost:3000/api/admin/scheduled-uploads/alerts?status=OPEN",
    );

    const response = await listAlertsRoute(request);

    expect(response.status).toBe(200);
    expect(mocks.listAlerts).toHaveBeenCalledWith("OPEN");
    await expect(response.json()).resolves.toEqual({
      alerts: [{ id: "alert-1", status: "OPEN" }],
    });
  });

  it("rejects unsupported alert filter values", async () => {
    const response = await listAlertsRoute(
      new NextRequest(
        "http://localhost:3000/api/admin/scheduled-uploads/alerts?status=STAGING",
      ),
    );

    expect(response.status).toBe(400);
    expect(mocks.listAlerts).not.toHaveBeenCalled();
  });

  it("acknowledges an alert using the authenticated administrator identity", async () => {
    const response = await updateAlertRoute(
      new NextRequest(
        "http://localhost:3000/api/admin/scheduled-uploads/alerts/update",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            alertId: "alert-1",
            status: "ACKNOWLEDGED",
          }),
        },
      ),
    );

    expect(mocks.updateAlert).toHaveBeenCalledWith({
      alertId: "alert-1",
      status: "ACKNOWLEDGED",
      actorEmail: "admin@example.com",
    });
    expect(response.status).toBe(200);
  });

  it("lets an administrator cancel a schedule before Drive writes start", async () => {
    const response = await cancelScheduleRoute(
      new NextRequest(
        "http://localhost:3000/api/admin/scheduled-uploads/cancel",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scheduleId: "schedule-1" }),
        },
      ),
    );

    expect(mocks.cancelSchedule).toHaveBeenCalledWith("schedule-1", {
      email: "admin@example.com",
    });
    expect(response.status).toBe(200);
  });

  it("reports a conflict when the schedule already started writing to Drive", async () => {
    mocks.cancelSchedule.mockRejectedValue(
      Object.assign(new Error("Drive write already started"), { status: 409 }),
    );

    const response = await cancelScheduleRoute(
      new NextRequest(
        "http://localhost:3000/api/admin/scheduled-uploads/cancel",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scheduleId: "schedule-1" }),
        },
      ),
    );

    expect(response.status).toBe(409);
  });
});
