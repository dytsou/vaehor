import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: vi.fn() },
    scheduledUpload: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    scheduledUploadItem: { count: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/services/auth-jwt", () => ({ resolveRole: vi.fn() }));

import { ApiRouteError } from "@/lib/api-middleware";
import { db } from "@/lib/db";
import { resolveRole } from "@/lib/services/auth-jwt";
import {
  commitScheduledUpload,
  createScheduledUpload,
  getScheduledUpload,
  readScheduledUploadItemContent,
  retryScheduledUpload,
  resolveScheduledInstant,
  stageScheduledUploadItem,
  updateScheduledUploadTime,
} from "@/lib/services/scheduled-upload";
import { privateScheduledUploadStorage } from "@/lib/storage/private-scheduled-uploads";

const actor = { email: "owner@example.com" };
const scheduleId = "scheduled-test-123";
const ownerId = "owner-id";
const itemId = "item-id";
const storageKey = "blob-test-123";

const mocks = db as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn> };
  scheduledUpload: {
    create: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  scheduledUploadItem: {
    count: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

function schedule(
  status = "STAGING",
  itemStatus = "PENDING",
  sha256: string | null = "a".repeat(64),
) {
  return {
    id: scheduleId,
    creatorId: ownerId,
    creatorEmail: actor.email,
    destinationId: "drive-folder",
    scheduledAt: new Date("2027-02-01T02:00:00.000Z"),
    scheduledTimeZone: "Asia/Taipei",
    scheduledLocalTime: "2027-02-01T10:00",
    scheduledUtcOffset: "+08:00",
    status,
    itemCount: 1,
    totalBytes: 4n,
    stagedBytes: itemStatus === "STAGED" ? 4n : 0n,
    stageCompleteAt: null,
    firstWriteAt: null,
    retryAfter: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    cleanupStatus: "NONE",
    createdAt: new Date("2026-09-30T00:00:00.000Z"),
    updatedAt: new Date("2026-09-30T00:00:00.000Z"),
    items: [
      {
        id: itemId,
        scheduleId,
        manifestPath: "reports/summary.txt",
        kind: "FILE",
        status: itemStatus,
        size: 4n,
        sha256,
        contentType: "text/plain",
        storageKey,
        uploadedBytes: itemStatus === "STAGED" ? 4n : 0n,
        stagedAt:
          itemStatus === "STAGED" ? new Date("2026-09-30T00:00:00.000Z") : null,
      },
    ],
  };
}

describe("scheduled upload service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveRole).mockResolvedValue("EDITOR");
    mocks.user.findUnique.mockResolvedValue({
      id: ownerId,
      email: actor.email,
    });
    mocks.scheduledUpload.findMany.mockResolvedValue([]);
    mocks.scheduledUploadItem.count.mockResolvedValue(0);
    mocks.scheduledUploadItem.updateMany.mockResolvedValue({ count: 1 });
    mocks.scheduledUpload.updateMany.mockResolvedValue({ count: 1 });
    mocks.$transaction.mockImplementation(async (callback) => callback(db));
  });

  it("converts an unambiguous local time and rejects past, missing, and ambiguous times", () => {
    expect(
      resolveScheduledInstant(
        "2027-02-01T10:00",
        "Asia/Taipei",
        "+08:00",
        new Date("2026-09-30T00:00:00.000Z"),
      ).toISOString(),
    ).toBe("2027-02-01T02:00:00.000Z");

    expect(() =>
      resolveScheduledInstant(
        "2026-11-01T01:30",
        "America/New_York",
        "-04:00",
        new Date("2026-01-01T00:00:00.000Z"),
      ),
    ).toThrow(/ambiguous/i);
    expect(() =>
      resolveScheduledInstant(
        "2026-03-08T02:30",
        "America/New_York",
        "-05:00",
        new Date("2026-01-01T00:00:00.000Z"),
      ),
    ).toThrow(/does not exist/i);
    expect(() =>
      resolveScheduledInstant(
        "2026-01-01T10:00",
        "Asia/Taipei",
        "+08:00",
        new Date("2026-01-01T03:00:00.000Z"),
      ),
    ).toThrow(/future/i);
  });

  it("creates a private staging record only for a current editor or administrator", async () => {
    const initial = schedule("STAGING", "PENDING");
    vi.spyOn(
      privateScheduledUploadStorage,
      "assertPackageCapacity",
    ).mockResolvedValue();
    mocks.scheduledUpload.create.mockResolvedValue(initial);

    await expect(
      createScheduledUpload(
        {
          destinationId: "drive-folder",
          scheduledLocalTime: "2027-02-01T10:00",
          timeZone: "Asia/Taipei",
          utcOffset: "+08:00",
          items: [
            { path: "reports", kind: "folder", size: 0 },
            {
              path: "reports/summary.txt",
              kind: "file",
              size: 4,
              sha256: "a".repeat(64),
            },
          ],
        },
        actor,
      ),
    ).resolves.toMatchObject({ id: scheduleId, status: "STAGING" });
    expect(mocks.scheduledUpload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "STAGING",
          creatorId: ownerId,
          destinationId: "drive-folder",
        }),
      }),
    );

    vi.mocked(resolveRole).mockResolvedValue("USER");
    await expect(
      createScheduledUpload(
        {
          destinationId: "drive-folder",
          scheduledLocalTime: "2027-02-01T10:00",
          timeZone: "Asia/Taipei",
          utcOffset: "+08:00",
          items: [
            { path: "reports", kind: "folder", size: 0 },
            {
              path: "reports/summary.txt",
              kind: "file",
              size: 4,
              sha256: "a".repeat(64),
            },
          ],
        },
        actor,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.scheduledUpload.create).toHaveBeenCalledTimes(1);
  });

  it("cannot commit an incomplete package to waiting", async () => {
    mocks.scheduledUpload.findUnique.mockResolvedValue(
      schedule("STAGING", "PENDING"),
    );

    await expect(
      commitScheduledUpload(scheduleId, actor),
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.scheduledUpload.updateMany).not.toHaveBeenCalled();
  });

  it("rechecks all staged bytes before changing the ledger to waiting", async () => {
    const staged = schedule("STAGING", "STAGED");
    const waiting = {
      ...schedule("WAITING", "STAGED"),
      stageCompleteAt: new Date(),
    };
    mocks.scheduledUpload.findUnique
      .mockResolvedValueOnce(staged)
      .mockResolvedValueOnce(waiting);
    const verifyFileSpy = vi
      .spyOn(privateScheduledUploadStorage, "verifyFile")
      .mockResolvedValue(true);

    await expect(
      commitScheduledUpload(scheduleId, actor),
    ).resolves.toMatchObject({
      status: "WAITING",
      totalBytes: "4",
    });
    expect(verifyFileSpy).toHaveBeenCalledWith({
      scheduleId,
      storageKey,
      expectedSize: 4,
      expectedSha256: "a".repeat(64),
    });
    expect(verifyFileSpy.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.scheduledUpload.updateMany.mock.invocationCallOrder[0],
    );
  });

  it("can commit after the due time when staging completed late", async () => {
    const duePassed = {
      ...schedule("STAGING", "STAGED"),
      scheduledAt: new Date("2026-09-29T10:00:00.000Z"),
    };
    const waiting = {
      ...duePassed,
      status: "WAITING",
      stageCompleteAt: new Date(),
    };
    mocks.scheduledUpload.findUnique
      .mockResolvedValueOnce(duePassed)
      .mockResolvedValueOnce(waiting);
    vi.spyOn(privateScheduledUploadStorage, "verifyFile").mockResolvedValue(
      true,
    );

    await expect(
      commitScheduledUpload(scheduleId, actor),
    ).resolves.toMatchObject({ status: "WAITING" });
  });

  it("uses a fresh private storage key for every claimed staging attempt", async () => {
    mocks.scheduledUpload.findUnique.mockResolvedValue(
      schedule("STAGING", "STAGING", null),
    );
    const writeStreamSpy = vi
      .spyOn(privateScheduledUploadStorage, "writeStream")
      .mockResolvedValue({ size: 4, sha256: "a".repeat(64) });

    await expect(
      stageScheduledUploadItem({
        scheduleId,
        itemId,
        actor,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.close();
          },
        }),
        contentLength: "4",
      }),
    ).resolves.toMatchObject({
      status: "STAGED",
      uploadedBytes: "4",
      sha256: "a".repeat(64),
    });

    const claim = mocks.scheduledUploadItem.updateMany.mock.calls[0]?.[0];
    expect(claim.data.storageKey).not.toBe(storageKey);
    expect(writeStreamSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        storageKey: claim.data.storageKey,
        expectedSha256: undefined,
      }),
    );
    expect(mocks.scheduledUploadItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "STAGED",
          sha256: "a".repeat(64),
        }),
      }),
    );
  });

  it("reschedules a staging package before release", async () => {
    const staging = schedule("STAGING", "PENDING");
    mocks.scheduledUpload.findUnique
      .mockResolvedValueOnce(staging)
      .mockResolvedValueOnce(staging);

    await expect(
      updateScheduledUploadTime(
        scheduleId,
        {
          scheduledLocalTime: "2027-03-01T10:00",
          timeZone: "Asia/Taipei",
          utcOffset: "+08:00",
        },
        actor,
      ),
    ).resolves.toMatchObject({ status: "STAGING" });
    expect(mocks.scheduledUpload.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: scheduleId,
          status: { in: ["STAGING", "WAITING"] },
        },
      }),
    );
  });

  it("removes a staged blob and resets its claim if the ledger update loses a race", async () => {
    mocks.scheduledUpload.findUnique.mockResolvedValue(
      schedule("STAGING", "PENDING"),
    );
    mocks.scheduledUpload.updateMany.mockResolvedValueOnce({ count: 0 });
    const writeStreamSpy = vi
      .spyOn(privateScheduledUploadStorage, "writeStream")
      .mockResolvedValue({ size: 4, sha256: "a".repeat(64) });
    const removeFileSpy = vi
      .spyOn(privateScheduledUploadStorage, "removeFile")
      .mockResolvedValue();

    await expect(
      stageScheduledUploadItem({
        scheduleId,
        itemId,
        actor,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.close();
          },
        }),
        contentLength: "4",
      }),
    ).rejects.toMatchObject({ status: 409 });

    expect(mocks.$transaction).toHaveBeenCalledTimes(1);
    expect(removeFileSpy).toHaveBeenCalledWith(
      scheduleId,
      writeStreamSpy.mock.calls[0]?.[0].storageKey,
    );
    expect(mocks.scheduledUploadItem.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: itemId, uploadToken: expect.any(String) },
        data: expect.objectContaining({ status: "PENDING", uploadedBytes: 0n }),
      }),
    );
  });

  it("hides another editor's schedule with the same response as a missing schedule", async () => {
    mocks.scheduledUpload.findUnique.mockResolvedValue(
      schedule("WAITING", "STAGED"),
    );
    mocks.user.findUnique.mockResolvedValue({ id: "other-editor-id" });

    await expect(
      getScheduledUpload(scheduleId, { email: "other@example.com" }),
    ).rejects.toMatchObject({
      status: 404,
      message: "Scheduled upload not found.",
    });
  });

  it("blocks content as soon as a schedule is terminal", async () => {
    mocks.scheduledUpload.findUnique.mockResolvedValue(
      schedule("COMPLETED", "COMPLETE"),
    );

    await expect(
      readScheduledUploadItemContent(scheduleId, itemId, actor),
    ).rejects.toMatchObject({
      status: 404,
    });
  });

  it("lets only the creator retry after editor access is restored", async () => {
    const paused = schedule("NEEDS_ATTENTION", "STAGED");
    mocks.scheduledUpload.findUnique.mockResolvedValueOnce(paused);
    vi.mocked(resolveRole).mockResolvedValueOnce("USER");

    await expect(retryScheduledUpload(scheduleId, actor)).rejects.toMatchObject(
      {
        status: 409,
      },
    );
    expect(mocks.scheduledUpload.updateMany).not.toHaveBeenCalled();

    mocks.scheduledUpload.findUnique
      .mockResolvedValueOnce(paused)
      .mockResolvedValueOnce({ ...paused, status: "WAITING" });
    vi.mocked(resolveRole).mockResolvedValueOnce("EDITOR");

    await expect(
      retryScheduledUpload(scheduleId, actor),
    ).resolves.toMatchObject({
      status: "WAITING",
    });
    expect(mocks.scheduledUpload.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: scheduleId,
          status: { in: ["PARTIAL", "NEEDS_ATTENTION"] },
        },
      }),
    );
  });
});
