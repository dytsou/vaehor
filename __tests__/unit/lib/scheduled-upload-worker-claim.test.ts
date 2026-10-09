import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    scheduledUpload: { findUnique: vi.fn() },
    scheduledUploadAttempt: { create: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { claimDueScheduledUploadForRelease } from "@/lib/services/scheduled-upload";

const mocks = db as unknown as {
  $queryRaw: ReturnType<typeof vi.fn>;
  $transaction: ReturnType<typeof vi.fn>;
  scheduledUpload: { findUnique: ReturnType<typeof vi.fn> };
  scheduledUploadAttempt: { create: ReturnType<typeof vi.fn> };
};

function claimedSchedule() {
  return {
    id: "schedule-race",
    creatorEmail: "owner@example.com",
    destinationId: "destination",
    scheduledAt: new Date("2026-09-30T11:00:00.000Z"),
    status: "RELEASING",
    itemCount: 1,
    totalBytes: 1n,
    stagedBytes: 1n,
    stageCompleteAt: new Date("2026-09-30T10:00:00.000Z"),
    firstWriteAttemptAt: null,
    items: [],
  };
}

describe("scheduled upload database claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.$transaction.mockImplementation(async (callback) => callback(db));
    mocks.scheduledUpload.findUnique.mockResolvedValue(claimedSchedule());
    mocks.scheduledUploadAttempt.create.mockResolvedValue({ id: "attempt-1" });
  });

  it("grants only one of two racing workers the due row lease", async () => {
    mocks.$queryRaw
      .mockResolvedValueOnce([{ id: "schedule-race", leaseRecovered: false }])
      .mockResolvedValueOnce([]);

    const results = await Promise.all([
      claimDueScheduledUploadForRelease(),
      claimDueScheduledUploadForRelease(),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(mocks.$queryRaw).toHaveBeenCalledTimes(2);
    expect(mocks.scheduledUploadAttempt.create).toHaveBeenCalledOnce();
    for (const [template] of mocks.$queryRaw.mock.calls) {
      const sql = (template as TemplateStringsArray).join(" ");
      expect(sql).toMatch(/FOR UPDATE\s+SKIP LOCKED/);
      expect(sql).toContain('"scheduledAt" <= statement_timestamp()');
      expect(sql).toContain('"releaseLeaseUntil" <= statement_timestamp()');
    }
  });

  it("marks an expired RELEASING lease as recovered", async () => {
    mocks.$queryRaw.mockResolvedValueOnce([
      { id: "schedule-race", leaseRecovered: true },
    ]);

    const result = await claimDueScheduledUploadForRelease();

    expect(result?.leaseRecovered).toBe(true);
    expect(result?.schedule.id).toBe("schedule-race");
    expect(mocks.$queryRaw).toHaveBeenCalledOnce();
  });
});
