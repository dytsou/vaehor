import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockRunScheduledUploadWorkerTick } = vi.hoisted(() => ({
  mockRunScheduledUploadWorkerTick: vi.fn(),
}));

vi.mock("@/lib/services/scheduled-upload-worker", () => ({
  runScheduledUploadWorkerTick: mockRunScheduledUploadWorkerTick,
}));

import { GET } from "@/app/api/cron/scheduled-uploads/route";

function createCronRequest(authHeader?: string) {
  return new NextRequest("http://localhost:3000/api/cron/scheduled-uploads", {
    headers: authHeader ? { authorization: authHeader } : undefined,
  });
}

describe("app/api/cron/scheduled-uploads route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "cron-secret-test";
    mockRunScheduledUploadWorkerTick.mockResolvedValue({
      claimedSchedules: 1,
      completedSchedules: 0,
      processedItems: 1,
      uploadedChunks: 1,
      leaseRecoveries: 0,
      pausedSchedules: 0,
      elapsedMs: 120,
      adminAlertEmails: { processed: 0, sent: 0, failed: 0 },
    });
  });

  it("rejects unauthorized requests without running the worker", async () => {
    const response = await GET(createCronRequest());

    expect(response.status).toBe(401);
    expect(mockRunScheduledUploadWorkerTick).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: "Unauthorized",
    });
  });

  it("runs one bounded tick when authorized", async () => {
    const response = await GET(
      createCronRequest(`Bearer ${process.env.CRON_SECRET}`),
    );

    expect(response.status).toBe(200);
    expect(mockRunScheduledUploadWorkerTick).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toEqual({
      success: true,
      summary: {
        claimedSchedules: 1,
        completedSchedules: 0,
        processedItems: 1,
        uploadedChunks: 1,
        leaseRecoveries: 0,
        pausedSchedules: 0,
        elapsedMs: 120,
        adminAlertEmails: { processed: 0, sent: 0, failed: 0 },
      },
    });
  });

  it("fails closed when the cron secret is not configured", async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(createCronRequest("Bearer anything"));

    expect(response.status).toBe(503);
    expect(mockRunScheduledUploadWorkerTick).not.toHaveBeenCalled();
  });
});
