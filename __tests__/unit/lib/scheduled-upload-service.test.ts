import { beforeEach, describe, expect, it, vi } from "vitest";

const permissionMocks = vi.hoisted(() => ({
  sismember: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: vi.fn() },
    protectedFolder: { findUnique: vi.fn() },
    scheduledUpload: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    scheduledUploadItem: {
      count: vi.fn(),
      groupBy: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/services/auth-jwt", () => ({ resolveRole: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  hasUserAccess: async () => true,
}));

vi.mock("@/lib/kv", () => ({
  kv: { sismember: permissionMocks.sismember },
}));

import { ApiRouteError } from "@/lib/api-middleware";
import { hasUserAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveRole } from "@/lib/services/auth-jwt";
import {
  canAccessScheduledUploadDestination,
  commitScheduledUpload,
  createScheduledUpload,
  getScheduledUpload,
  listScheduledUploads,
  readScheduledUploadItemContent,
  retryPendingScheduledUploadCleanupBatch,
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
  protectedFolder: { findUnique: ReturnType<typeof vi.fn> };
  scheduledUpload: {
    create: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  scheduledUploadItem: {
    count: ReturnType<typeof vi.fn>;
    groupBy: ReturnType<typeof vi.fn>;
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
        remoteUploadOffset: 0n,
        stagedAt:
          itemStatus === "STAGED" ? new Date("2026-09-30T00:00:00.000Z") : null,
      },
    ],
  };
}

describe("scheduled upload service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissionMocks.sismember.mockResolvedValue(0);
    vi.mocked(resolveRole).mockResolvedValue("EDITOR");
    mocks.protectedFolder.findUnique.mockResolvedValue(null);
    mocks.user.findUnique.mockResolvedValue({
      id: ownerId,
      email: actor.email,
    });
    mocks.scheduledUpload.findMany.mockResolvedValue([]);
    mocks.scheduledUploadItem.count.mockResolvedValue(0);
    mocks.scheduledUploadItem.groupBy.mockResolvedValue([]);
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

  it("rejects a protected destination when its cached grant has been revoked", async () => {
    const destinationId = "protected-drive-folder-stale-grant";
    const input = {
      destinationId,
      scheduledLocalTime: "2027-02-01T10:00",
      timeZone: "Asia/Taipei",
      utcOffset: "+08:00",
      items: [
        { path: "reports", kind: "folder" as const, size: 0 },
        {
          path: "reports/summary.txt",
          kind: "file" as const,
          size: 4,
          sha256: "a".repeat(64),
        },
      ],
    };
    vi.spyOn(
      privateScheduledUploadStorage,
      "assertPackageCapacity",
    ).mockResolvedValue();
    mocks.protectedFolder.findUnique.mockResolvedValue({
      folderId: destinationId,
    });
    mocks.scheduledUpload.create.mockResolvedValue({
      ...schedule(),
      destinationId,
    });
    permissionMocks.sismember.mockResolvedValue(0);

    await expect(hasUserAccess(actor.email, destinationId)).resolves.toBe(true);

    await expect(createScheduledUpload(input, actor)).rejects.toMatchObject({
      status: 403,
    });

    expect(permissionMocks.sismember).toHaveBeenCalledTimes(1);
    expect(mocks.protectedFolder.findUnique).toHaveBeenCalledWith({
      where: { folderId: destinationId },
      select: { folderId: true },
    });
    expect(mocks.scheduledUpload.create).not.toHaveBeenCalled();
  });

  it("uses the caller email verbatim for fresh folder grant checks", async () => {
    permissionMocks.sismember.mockResolvedValue(1);

    await expect(
      canAccessScheduledUploadDestination(
        "Owner@Example.com",
        "shared-folder-id",
        "EDITOR",
      ),
    ).resolves.toBe(true);

    expect(permissionMocks.sismember).toHaveBeenCalledWith(
      "folder:access:shared-folder-id",
      "Owner@Example.com",
    );
  });

  it("retries bounded terminal cleanup on a later worker pass", async () => {
    mocks.scheduledUpload.findMany.mockResolvedValue([{ id: "cleanup-1" }]);
    mocks.scheduledUpload.findUnique.mockResolvedValue({
      status: "CANCELED",
      cleanupStatus: "PENDING",
    });
    mocks.scheduledUploadItem.count.mockResolvedValue(0);
    const removeSchedule = vi
      .spyOn(privateScheduledUploadStorage, "removeSchedule")
      .mockRejectedValueOnce(new Error("temporary filesystem failure"))
      .mockResolvedValueOnce(undefined);

    await expect(retryPendingScheduledUploadCleanupBatch(2)).resolves.toBe(0);
    await expect(retryPendingScheduledUploadCleanupBatch(2)).resolves.toBe(1);

    expect(mocks.scheduledUpload.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ take: 2 }),
    );
    expect(removeSchedule).toHaveBeenCalledTimes(2);
    expect(mocks.scheduledUpload.updateMany).toHaveBeenCalledTimes(1);
  });

  it("returns compact schedule pages and a stable next cursor", async () => {
    const records = Array.from({ length: 21 }, (_, index) => ({
      ...schedule("WAITING", "STAGED"),
      id: `schedule-${String(index).padStart(2, "0")}`,
      createdAt: new Date(
        `2026-09-${String(30 - index).padStart(2, "0")}T00:00:00Z`,
      ),
    }));
    records[0]!.status = "STAGING";
    mocks.scheduledUpload.findMany
      .mockResolvedValueOnce(records)
      .mockResolvedValueOnce([records[20]]);
    mocks.scheduledUploadItem.groupBy
      .mockResolvedValueOnce([
        { scheduleId: records[1]!.id, _sum: { remoteUploadOffset: 3n } },
      ])
      .mockResolvedValueOnce([]);

    const firstPage = await listScheduledUploads(actor);
    const secondPage = await listScheduledUploads(actor, {
      cursor: "schedule-19",
    });

    expect(firstPage.items).toHaveLength(20);
    expect(firstPage.items[0]).not.toHaveProperty("items");
    expect(firstPage.items[0]?.uploadedBytes).toBe("4");
    expect(firstPage.items[1]?.uploadedBytes).toBe("3");
    expect(firstPage.nextCursor).toBe("schedule-19");
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();
    expect(mocks.scheduledUpload.findMany.mock.calls[0]?.[0]).toMatchObject({
      take: 21,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(
      mocks.scheduledUpload.findMany.mock.calls[0]?.[0],
    ).not.toHaveProperty("include");
    expect(mocks.scheduledUpload.findMany.mock.calls[1]?.[0]).toMatchObject({
      cursor: { id: "schedule-19" },
      skip: 1,
    });
  });

  it("reports Drive-acknowledged bytes instead of staged bytes during release", async () => {
    const releasing = schedule("RELEASING", "UPLOADING");
    releasing.items[0]!.uploadedBytes = 4n;
    releasing.items[0]!.remoteUploadOffset = 2n;
    mocks.scheduledUpload.findUnique.mockResolvedValue(releasing);

    const response = await getScheduledUpload(scheduleId, actor);

    expect(response.items[0]?.uploadedBytes).toBe("2");
  });

  it("stores the mixed-case access email while keeping the creator email canonical", async () => {
    const mixedCaseActor = { email: "Owner@Example.com" };
    const destinationId = "mixed-case-shared-folder";
    vi.spyOn(
      privateScheduledUploadStorage,
      "assertPackageCapacity",
    ).mockResolvedValue();
    permissionMocks.sismember.mockResolvedValue(1);
    mocks.scheduledUpload.create.mockResolvedValue({
      ...schedule(),
      creatorEmail: "owner@example.com",
      creatorAccessEmail: "Owner@Example.com",
      destinationId,
    });

    const response = await createScheduledUpload(
      {
        destinationId,
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
      mixedCaseActor,
    );

    expect(permissionMocks.sismember).toHaveBeenCalledWith(
      "folder:access:" + destinationId,
      "Owner@Example.com",
    );
    expect(mocks.scheduledUpload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          creatorEmail: "owner@example.com",
          creatorAccessEmail: "Owner@Example.com",
        }),
      }),
    );
    expect(response).not.toHaveProperty("creatorAccessEmail");
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
