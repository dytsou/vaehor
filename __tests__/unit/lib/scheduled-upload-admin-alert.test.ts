import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    scheduledUploadItem: { count: vi.fn() },
    scheduledUploadAdminAlert: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    scheduledUploadAttempt: { updateMany: vi.fn() },
  };
  return {
    tx,
    transaction: vi.fn(),
    queryRaw: tx.$queryRaw,
    executeRaw: tx.$executeRaw,
    collectAdminEmails: vi.fn(),
    sendMail: vi.fn(),
    events: [] as string[],
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    ...mocks.tx,
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/incident-monitor", () => ({
  collectAdminEmails: mocks.collectAdminEmails,
}));

vi.mock("@/lib/mailer", () => ({
  sendMail: mocks.sendMail,
}));

import {
  deliverNextScheduledUploadAdminAlertEmail,
  listScheduledUploadAdminAlerts,
  updateScheduledUploadAdminAlertStatus,
} from "@/lib/services/scheduled-upload-admin-alert";
import { finishScheduledUploadReleaseClaim } from "@/lib/services/scheduled-upload";

describe("scheduled upload admin alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.events.length = 0;
    mocks.transaction.mockImplementation(async (callback) =>
      callback(mocks.tx),
    );
    mocks.queryRaw.mockImplementation(async () => {
      mocks.events.push("claim");
      return [{ roleRevocationCount: 1 }];
    });
    mocks.executeRaw.mockResolvedValue(1);
    mocks.tx.scheduledUploadAdminAlert.create.mockImplementation(async () => {
      mocks.events.push("alert");
      return { id: "alert-1" };
    });
    mocks.tx.scheduledUploadAttempt.updateMany.mockImplementation(async () => {
      mocks.events.push("attempt");
      return { count: 1 };
    });
    mocks.tx.scheduledUploadAdminAlert.findMany.mockResolvedValue([]);
    mocks.tx.scheduledUploadAdminAlert.updateMany.mockResolvedValue({
      count: 1,
    });
    mocks.collectAdminEmails.mockResolvedValue(["admin@example.com"]);
    mocks.sendMail.mockResolvedValue(true);
  });

  it("commits a role-revoked alert in the same transaction as the pause", async () => {
    await expect(
      finishScheduledUploadReleaseClaim({
        scheduleId: "schedule-1",
        leaseToken: "lease-1",
        attemptId: "attempt-1",
        status: "NEEDS_ATTENTION",
        errorCode: "CREATOR_ROLE_REVOKED",
        errorMessage: "The creator no longer has editor access.",
        adminAlertReason: "CREATOR_ROLE_REVOKED",
      }),
    ).resolves.toBe(true);

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.events).toEqual(["claim", "alert", "attempt"]);
    expect(mocks.tx.scheduledUploadAdminAlert.create).toHaveBeenCalledWith({
      data: {
        scheduleId: "schedule-1",
        occurrence: 1,
        reasonCode: "CREATOR_ROLE_REVOKED",
      },
    });
  });

  it("persists failed email delivery with a retryable outbox state", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      {
        id: "alert-1",
        scheduleId: "schedule-1",
        occurrence: 1,
        reasonCode: "CREATOR_ROLE_REVOKED",
        emailAttempts: 1,
      },
    ]);
    mocks.sendMail.mockResolvedValue(false);

    await expect(deliverNextScheduledUploadAdminAlertEmail()).resolves.toEqual({
      processed: 1,
      sent: 0,
      failed: 1,
    });

    expect(mocks.collectAdminEmails).toHaveBeenCalledOnce();
    expect(mocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["admin@example.com"],
        subject: "[vaehor Alert] Scheduled upload needs attention",
      }),
    );
    expect(mocks.executeRaw).toHaveBeenCalledOnce();
    const failureSql = mocks.executeRaw.mock.calls[0]?.[0] as string[];
    expect(failureSql.join("")).toContain("\"emailStatus\" = 'FAILED'");
    expect(failureSql.join("")).toContain('"emailRetryAfter"');
  });

  it("delivers at most one queued email per tick and persists success", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      {
        id: "alert-1",
        scheduleId: "schedule-1",
        occurrence: 1,
        reasonCode: "CREATOR_ROLE_REVOKED",
        emailAttempts: 1,
      },
    ]);

    await expect(deliverNextScheduledUploadAdminAlertEmail()).resolves.toEqual({
      processed: 1,
      sent: 1,
      failed: 0,
    });

    expect(mocks.sendMail).toHaveBeenCalledOnce();
    expect(mocks.executeRaw).toHaveBeenCalledOnce();
    const sentSql = mocks.executeRaw.mock.calls[0]?.[0] as string[];
    expect(sentSql.join("")).toContain("\"emailStatus\" = 'SENT'");
  });

  it("lists only administrative metadata and supports durable acknowledgment", async () => {
    const alert = {
      id: "alert-1",
      scheduleId: "schedule-1",
      status: "OPEN",
      schedule: {
        id: "schedule-1",
        status: "NEEDS_ATTENTION",
        creatorEmail: "owner@example.com",
        scheduledAt: new Date("2026-09-30T12:00:00.000Z"),
      },
    };
    mocks.tx.scheduledUploadAdminAlert.findMany.mockResolvedValue([alert]);
    mocks.tx.scheduledUploadAdminAlert.findUnique
      .mockResolvedValueOnce(alert)
      .mockResolvedValueOnce({ ...alert, status: "ACKNOWLEDGED" });

    await expect(listScheduledUploadAdminAlerts("OPEN")).resolves.toEqual([
      alert,
    ]);
    expect(mocks.tx.scheduledUploadAdminAlert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "OPEN" },
        include: {
          schedule: {
            select: {
              id: true,
              status: true,
              creatorEmail: true,
              scheduledAt: true,
            },
          },
        },
      }),
    );

    await expect(
      updateScheduledUploadAdminAlertStatus({
        alertId: "alert-1",
        status: "ACKNOWLEDGED",
        actorEmail: "admin@example.com",
      }),
    ).resolves.toMatchObject({ status: "ACKNOWLEDGED" });
    expect(mocks.tx.scheduledUploadAdminAlert.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "alert-1", status: "OPEN" },
        data: expect.objectContaining({
          status: "ACKNOWLEDGED",
          acknowledgedByEmail: "admin@example.com",
        }),
      }),
    );
  });
});
