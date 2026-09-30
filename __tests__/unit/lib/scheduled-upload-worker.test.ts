import { ReadableStream } from "node:stream/web";
import { describe, expect, it, vi } from "vitest";
import {
  createDriveAdapter,
  createScheduledUploadWorker,
  type ScheduledUploadWorkerDependencies,
} from "@/lib/services/scheduled-upload-worker";
import { ScheduledUploadSessionCryptoError } from "@/lib/services/scheduled-upload-session-crypto";
import type {
  ScheduledUploadReleaseClaim,
  ScheduledUploadReleaseItem,
} from "@/lib/services/scheduled-upload";

vi.mock("@/lib/drive", () => ({
  getAccessToken: vi.fn().mockResolvedValue("scheduled-upload-test-token"),
}));

const now = new Date("2026-09-30T12:00:00.000Z");
const sessionUri =
  "https://www.googleapis.com/upload/drive/v3/files?upload_id=private-session";
const defaultBytes = new Uint8Array([1, 2, 3]);

function releaseItem(
  overrides: Partial<ScheduledUploadReleaseItem> = {},
): ScheduledUploadReleaseItem {
  return {
    id: "item-1",
    manifestPath: "file.bin",
    kind: "FILE",
    status: "STAGED",
    size: BigInt(defaultBytes.byteLength),
    sha256: "a".repeat(64),
    contentType: "application/octet-stream",
    storageKey: "opaque-storage-key",
    uploadedBytes: BigInt(defaultBytes.byteLength),
    remoteFileId: null,
    encryptedUploadSession: null,
    uploadSessionNonce: null,
    uploadSessionTag: null,
    uploadSessionKeyVersion: null,
    remoteUploadOffset: 0n,
    releaseVerifiedAt: now,
    retryAfter: null,
    ...overrides,
  };
}

function releaseClaim(
  items: ScheduledUploadReleaseItem[] = [releaseItem()],
  overrides: Partial<ScheduledUploadReleaseClaim["schedule"]> = {},
): ScheduledUploadReleaseClaim {
  const totalBytes = items.reduce(
    (total, item) => total + (item.kind === "FILE" ? item.size : 0n),
    0n,
  );
  return {
    schedule: {
      id: "schedule-1",
      creatorEmail: "owner@example.com",
      destinationId: "destination-1",
      scheduledAt: new Date(now.getTime() - 1_000),
      status: "RELEASING",
      itemCount: items.length,
      totalBytes,
      stagedBytes: totalBytes,
      stageCompleteAt: now,
      firstWriteAttemptAt: null,
      workerRetryCount: 0,
      items,
      ...overrides,
    },
    leaseToken: "lease-1",
    attemptId: "attempt-1",
    leaseRecovered: false,
  } as ScheduledUploadReleaseClaim;
}

function destinationMetadata(canAddChildren = true) {
  return {
    id: "destination-1",
    mimeType: "application/vnd.google-apps.folder",
    parents: [],
    capabilities: { canAddChildren },
  };
}

function workerHarness(
  claim: ScheduledUploadReleaseClaim | null,
  overrides: Partial<ScheduledUploadWorkerDependencies> = {},
) {
  const store = {
    claimNextScheduledUpload: vi
      .fn()
      .mockResolvedValueOnce(claim)
      .mockResolvedValue(null),
    markFirstWriteAttempt: vi.fn().mockResolvedValue(true),
    recordFirstWriteResponse: vi.fn().mockResolvedValue(true),
    updateItem: vi.fn().mockResolvedValue(true),
    finishClaim: vi.fn().mockResolvedValue(true),
  };
  const drive = {
    getFileMetadata: vi
      .fn()
      .mockImplementation(async (fileId: string) =>
        fileId === "destination-1" ? destinationMetadata() : null,
      ),
    generateFileId: vi.fn().mockResolvedValue("remote-id-1"),
    createFolder: vi.fn().mockResolvedValue(undefined),
    startResumableUpload: vi.fn().mockResolvedValue(sessionUri),
    queryUploadStatus: vi
      .fn()
      .mockResolvedValue({ kind: "incomplete", acknowledgedBytes: 0 }),
    uploadChunk: vi
      .fn()
      .mockResolvedValue({ kind: "incomplete", acknowledgedBytes: 0 }),
  };
  const storage = {
    verifyFile: vi.fn().mockResolvedValue(true),
    readStream: vi.fn().mockResolvedValue(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(defaultBytes);
          controller.close();
        },
      }),
    ),
  };
  const dependencies: ScheduledUploadWorkerDependencies = {
    store,
    drive,
    storage,
    resolveRole: vi.fn().mockResolvedValue("EDITOR"),
    assertEncryptionAvailable: vi.fn(),
    encryptSession: vi.fn().mockReturnValue({
      ciphertext: "opaque-ciphertext",
      nonce: "opaque-nonce",
      tag: "opaque-tag",
      keyVersion: "v2",
    }),
    decryptSession: vi.fn().mockReturnValue(sessionUri),
    retryCleanup: vi.fn().mockResolvedValue(true),
    now: vi.fn(() => new Date(now)),
    maxSchedulesPerTick: 2,
    maxItemsPerTick: 2,
    maxChunksPerTick: 1,
    maxDurationMs: 7_000,
    chunkSizeBytes: 256 * 1024,
    ...overrides,
  };
  const effectiveDrive = dependencies.drive as typeof drive;
  const effectiveStorage = dependencies.storage as typeof storage;

  return {
    worker: createScheduledUploadWorker(dependencies),
    store,
    drive: effectiveDrive,
    storage: effectiveStorage,
    dependencies,
  };
}

describe("scheduled upload worker", () => {
  it("reports an expired Drive upload session when a chunk returns 404", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const adapter = createDriveAdapter();
      const result = await adapter.uploadChunk({
        sessionUri,
        start: 0,
        totalBytes: 256 * 1024,
        bytes: new Uint8Array(256 * 1024),
      });

      expect(result).toEqual({ kind: "expired" });
      expect(fetchMock).toHaveBeenCalledWith(
        sessionUri,
        expect.objectContaining({
          method: "PUT",
          headers: expect.any(Headers),
        }),
      );
      const requestHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
      expect(requestHeaders.get("Authorization")).toBe(
        "Bearer scheduled-upload-test-token",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not contact Drive when the database has no due lease", async () => {
    const harness = workerHarness(null);

    const summary = await harness.worker.runTick();

    expect(harness.store.claimNextScheduledUpload).toHaveBeenCalledOnce();
    expect(summary.claimedSchedules).toBe(0);
    expect(harness.drive.getFileMetadata).not.toHaveBeenCalled();
    expect(harness.drive.generateFileId).not.toHaveBeenCalled();
    expect(harness.drive.createFolder).not.toHaveBeenCalled();
    expect(harness.drive.startResumableUpload).not.toHaveBeenCalled();
    expect(harness.drive.queryUploadStatus).not.toHaveBeenCalled();
    expect(harness.drive.uploadChunk).not.toHaveBeenCalled();
  });

  it("allows one racing worker to obtain the due lease and create a session", async () => {
    const harness = workerHarness(null);
    const claim = releaseClaim();
    let claimGranted = false;
    const sharedStore = {
      ...harness.dependencies.store,
      claimNextScheduledUpload: vi.fn(async () => {
        if (claimGranted) return null;
        claimGranted = true;
        return claim;
      }),
    };
    harness.dependencies.store = sharedStore;
    const firstWorker = createScheduledUploadWorker(harness.dependencies);
    const secondWorker = createScheduledUploadWorker(harness.dependencies);

    const [first, second] = await Promise.all([
      firstWorker.runTick(),
      secondWorker.runTick(),
    ]);

    expect(first.claimedSchedules).toBe(1);
    expect(second.claimedSchedules).toBe(0);
    expect(harness.drive.generateFileId).toHaveBeenCalledOnce();
    expect(harness.drive.startResumableUpload).toHaveBeenCalledOnce();
  });

  it("pauses an incomplete package before any Drive request", async () => {
    const claim = releaseClaim([releaseItem()], { stageCompleteAt: null });
    claim.leaseRecovered = true;
    const harness = workerHarness(claim);

    const summary = await harness.worker.runTick();

    expect(summary.leaseRecoveries).toBe(1);
    expect(harness.store.finishClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "NEEDS_ATTENTION",
        errorCode: "STAGING_INCOMPLETE",
      }),
    );
    expect(harness.drive.getFileMetadata).not.toHaveBeenCalled();
    expect(harness.drive.generateFileId).not.toHaveBeenCalled();
    expect(harness.drive.startResumableUpload).not.toHaveBeenCalled();
  });

  it("stops before Drive when the creator lost editor access", async () => {
    const harness = workerHarness(releaseClaim(), {
      resolveRole: vi.fn().mockResolvedValue("USER"),
    });

    await harness.worker.runTick();

    expect(harness.store.finishClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "NEEDS_ATTENTION",
        errorCode: "CREATOR_ROLE_REVOKED",
        adminAlertReason: "CREATOR_ROLE_REVOKED",
      }),
    );
    expect(harness.storage.verifyFile).not.toHaveBeenCalled();
    expect(harness.drive.getFileMetadata).not.toHaveBeenCalled();
    expect(harness.drive.generateFileId).not.toHaveBeenCalled();
    expect(harness.drive.startResumableUpload).not.toHaveBeenCalled();
  });

  it("pauses without a Drive request when encryption material is missing", async () => {
    const harness = workerHarness(
      releaseClaim([releaseItem({ releaseVerifiedAt: null })]),
      {
        assertEncryptionAvailable: vi.fn(() => {
          throw new ScheduledUploadSessionCryptoError("MISSING_KEY");
        }),
      },
    );

    await harness.worker.runTick();

    expect(harness.store.finishClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "NEEDS_ATTENTION",
        errorCode: "SESSION_KEY_MISSING",
      }),
    );
    expect(harness.drive.getFileMetadata).not.toHaveBeenCalled();
    expect(harness.drive.generateFileId).not.toHaveBeenCalled();
    expect(harness.drive.startResumableUpload).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null],
    ["without add permission", { ...destinationMetadata(false) }],
  ])(
    "performs only destination reads when it is %s",
    async (_label, metadata) => {
      const harness = workerHarness(releaseClaim(), {
        drive: {
          ...workerHarness(null).drive,
          getFileMetadata: vi.fn().mockResolvedValue(metadata),
        },
      });

      await harness.worker.runTick();

      expect(harness.drive.getFileMetadata).toHaveBeenCalledTimes(1);
      expect(harness.drive.getFileMetadata).toHaveBeenCalledWith(
        "destination-1",
      );
      expect(harness.store.markFirstWriteAttempt).not.toHaveBeenCalled();
      expect(harness.drive.generateFileId).not.toHaveBeenCalled();
      expect(harness.drive.createFolder).not.toHaveBeenCalled();
      expect(harness.drive.startResumableUpload).not.toHaveBeenCalled();
      expect(harness.drive.uploadChunk).not.toHaveBeenCalled();
    },
  );

  it("verifies the full staged file before the first Drive mutation", async () => {
    const harness = workerHarness(
      releaseClaim([
        releaseItem({ id: "item-1", releaseVerifiedAt: null }),
        releaseItem({
          id: "item-2",
          manifestPath: "second.bin",
          storageKey: "second-storage-key",
          releaseVerifiedAt: null,
        }),
      ]),
    );

    await harness.worker.runTick();

    expect(harness.storage.verifyFile).toHaveBeenCalledWith({
      scheduleId: "schedule-1",
      storageKey: "opaque-storage-key",
      expectedSize: defaultBytes.byteLength,
      expectedSha256: "a".repeat(64),
    });
    expect(harness.store.finishClaim).toHaveBeenCalledWith(
      expect.objectContaining({ status: "RELEASING" }),
    );
    expect(harness.store.markFirstWriteAttempt).not.toHaveBeenCalled();
    expect(harness.drive.getFileMetadata).not.toHaveBeenCalled();
    expect(harness.drive.generateFileId).not.toHaveBeenCalled();
    expect(harness.drive.startResumableUpload).not.toHaveBeenCalled();
  });

  it("saves a stable remote ID before creating an encrypted resumable session", async () => {
    const harness = workerHarness(releaseClaim());

    const summary = await harness.worker.runTick();

    expect(summary.processedItems).toBe(1);
    expect(harness.store.markFirstWriteAttempt).toHaveBeenCalledOnce();
    expect(harness.drive.generateFileId).toHaveBeenCalledOnce();
    expect(harness.store.updateItem.mock.calls[0]?.[3]).toMatchObject({
      remoteFileId: "remote-id-1",
      status: "UPLOADING",
    });
    expect(harness.store.updateItem.mock.invocationCallOrder[0]).toBeLessThan(
      harness.drive.startResumableUpload.mock.invocationCallOrder[0] ??
        Infinity,
    );
    expect(
      harness.drive.generateFileId.mock.invocationCallOrder[0],
    ).toBeLessThan(
      harness.store.markFirstWriteAttempt.mock.invocationCallOrder[0] ?? -1,
    );
    expect(harness.store.updateItem.mock.invocationCallOrder[0]).toBeLessThan(
      harness.store.markFirstWriteAttempt.mock.invocationCallOrder[0] ?? -1,
    );
    expect(
      harness.store.markFirstWriteAttempt.mock.invocationCallOrder[0],
    ).toBeLessThan(
      harness.drive.startResumableUpload.mock.invocationCallOrder[0] ??
        Infinity,
    );
    expect(harness.drive.startResumableUpload).toHaveBeenCalledOnce();
    expect(harness.dependencies.encryptSession).toHaveBeenCalledWith(
      sessionUri,
      "schedule-1:item-1",
    );
    const sessionUpdate = harness.store.updateItem.mock.calls.find(
      (call) => "encryptedUploadSession" in call[3],
    );
    expect(sessionUpdate?.[3]).toMatchObject({
      encryptedUploadSession: "opaque-ciphertext",
      uploadSessionNonce: "opaque-nonce",
      uploadSessionTag: "opaque-tag",
      uploadSessionKeyVersion: "v2",
    });
    expect(sessionUpdate?.[3].encryptedUploadSession).not.toBe(sessionUri);
  });

  it("does not mark the first write when stable Drive ID allocation fails", async () => {
    const harness = workerHarness(releaseClaim(), {
      drive: {
        ...workerHarness(null).drive,
        generateFileId: vi.fn().mockRejectedValue(new Error("request timeout")),
      },
    });

    await harness.worker.runTick();

    expect(harness.store.markFirstWriteAttempt).not.toHaveBeenCalled();
    expect(harness.store.finishClaim).toHaveBeenCalledWith(
      expect.objectContaining({ status: "PARTIAL" }),
    );
    expect(harness.drive.startResumableUpload).not.toHaveBeenCalled();
  });

  it("marks folder release immediately before its first Drive create", async () => {
    const folder = releaseItem({
      id: "folder-1",
      manifestPath: "photos",
      kind: "FOLDER",
      size: 0n,
      sha256: null,
      storageKey: null,
      uploadedBytes: 0n,
    });
    const harness = workerHarness(releaseClaim([folder]));

    await harness.worker.runTick();

    expect(
      harness.drive.generateFileId.mock.invocationCallOrder[0],
    ).toBeLessThan(
      harness.store.markFirstWriteAttempt.mock.invocationCallOrder[0] ?? -1,
    );
    expect(
      harness.store.markFirstWriteAttempt.mock.invocationCallOrder[0],
    ).toBeLessThan(
      harness.drive.createFolder.mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(harness.store.recordFirstWriteResponse).toHaveBeenCalledOnce();
  });

  it("resumes from Drive's acknowledged offset and spends at most one chunk per tick", async () => {
    const item = releaseItem({
      id: "item-resume",
      manifestPath: "report.bin",
      size: 262_145n,
      remoteFileId: "remote-file-1",
      status: "UPLOADING",
      uploadedBytes: 262_145n,
      encryptedUploadSession: "opaque-ciphertext",
      uploadSessionNonce: "opaque-nonce",
      uploadSessionTag: "opaque-tag",
      uploadSessionKeyVersion: "v1",
      remoteUploadOffset: 0n,
    });
    const claim = releaseClaim([item], {
      totalBytes: 262_145n,
      stagedBytes: 262_145n,
      firstWriteAttemptAt: now,
    });
    const harness = workerHarness(claim, {
      storage: {
        verifyFile: vi.fn(),
        readStream: vi.fn().mockResolvedValue(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(1));
              controller.close();
            },
          }),
        ),
      },
      drive: {
        ...workerHarness(null).drive,
        getFileMetadata: vi
          .fn()
          .mockImplementation(async (fileId: string) =>
            fileId === "destination-1" ? destinationMetadata() : null,
          ),
        queryUploadStatus: vi.fn().mockResolvedValue({
          kind: "incomplete",
          acknowledgedBytes: 262_144,
        }),
        uploadChunk: vi.fn().mockResolvedValue({
          kind: "complete",
          file: {
            id: "remote-file-1",
            name: "report.bin",
            parents: ["destination-1"],
            appProperties: {
              vaehorScheduleId: "schedule-1",
              vaehorScheduleItemId: "item-resume",
            },
          },
        }),
      },
    });

    const summary = await harness.worker.runTick();

    expect(summary.uploadedChunks).toBe(1);
    expect(harness.drive.queryUploadStatus).toHaveBeenCalledWith(
      sessionUri,
      262_145,
    );
    expect(harness.storage.readStream).toHaveBeenCalledWith(
      "schedule-1",
      "opaque-storage-key",
      { start: 262_144, end: 262_144 },
    );
    expect(harness.drive.uploadChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionUri,
        start: 262_144,
        totalBytes: 262_145,
        bytes: expect.any(Uint8Array),
      }),
    );
    expect(harness.drive.uploadChunk.mock.calls[0]?.[0].bytes.byteLength).toBe(
      1,
    );
    expect(harness.store.updateItem).toHaveBeenCalledWith(
      "schedule-1",
      "item-resume",
      "lease-1",
      expect.objectContaining({
        status: "COMPLETE",
        remoteUploadOffset: 262_145n,
      }),
    );
  });

  it("records the first successful response when Drive reports a resumed upload complete", async () => {
    const item = releaseItem({
      status: "UPLOADING",
      remoteFileId: "remote-file-1",
      encryptedUploadSession: "opaque-ciphertext",
      uploadSessionNonce: "opaque-nonce",
      uploadSessionTag: "opaque-tag",
      uploadSessionKeyVersion: "v1",
    });
    const harness = workerHarness(
      releaseClaim([item], { firstWriteAttemptAt: now }),
      {
        drive: {
          ...workerHarness(null).drive,
          queryUploadStatus: vi.fn().mockResolvedValue({ kind: "complete" }),
        },
      },
    );

    await harness.worker.runTick();

    expect(harness.store.recordFirstWriteResponse).toHaveBeenCalledOnce();
  });

  it("uses the persisted retry count for capped exponential backoff", async () => {
    const item = releaseItem({
      status: "UPLOADING",
      remoteFileId: "remote-file-1",
      encryptedUploadSession: "opaque-ciphertext",
      uploadSessionNonce: "opaque-nonce",
      uploadSessionTag: "opaque-tag",
      uploadSessionKeyVersion: "v1",
    });
    const harness = workerHarness(
      releaseClaim([item], {
        firstWriteAttemptAt: now,
        workerRetryCount: 2,
      }),
      {
        drive: {
          ...workerHarness(null).drive,
          getFileMetadata: vi.fn().mockResolvedValue(null),
          queryUploadStatus: vi.fn().mockRejectedValue(new Error("timeout")),
        },
      },
    );

    await harness.worker.runTick();

    expect(harness.store.finishClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "PARTIAL",
        errorCode: "WORKER_UNEXPECTED_ERROR",
        retryAfter: new Date(now.getTime() + 20_000),
      }),
    );
  });

  it("recovers a stored encrypted session after restart and follows the acknowledged range", async () => {
    const firstClaim = releaseClaim();
    const resumedItem = releaseItem({
      id: "item-resume",
      manifestPath: "photo.bin",
      size: 262_145n,
      uploadedBytes: 262_145n,
      remoteFileId: "remote-file-1",
      status: "UPLOADING",
      encryptedUploadSession: "opaque-ciphertext",
      uploadSessionNonce: "opaque-nonce",
      uploadSessionTag: "opaque-tag",
      uploadSessionKeyVersion: "v1",
      remoteUploadOffset: 0n,
    });
    const resumedClaim = releaseClaim([resumedItem], {
      id: "schedule-1",
      totalBytes: 262_145n,
      stagedBytes: 262_145n,
      firstWriteAttemptAt: now,
    });
    const harness = workerHarness(null, {
      storage: {
        verifyFile: vi.fn().mockResolvedValue(true),
        readStream: vi.fn().mockResolvedValue(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(1));
              controller.close();
            },
          }),
        ),
      },
      drive: {
        ...workerHarness(null).drive,
        getFileMetadata: vi
          .fn()
          .mockImplementation(async (fileId: string) =>
            fileId === "destination-1" ? destinationMetadata() : null,
          ),
        queryUploadStatus: vi.fn().mockResolvedValue({
          kind: "incomplete",
          acknowledgedBytes: 262_144,
        }),
        uploadChunk: vi.fn().mockResolvedValue({
          kind: "complete",
          file: {
            id: "remote-file-1",
            name: "photo.bin",
            parents: ["destination-1"],
            appProperties: {
              vaehorScheduleId: "schedule-1",
              vaehorScheduleItemId: "item-resume",
            },
          },
        }),
      },
    });
    let nextClaim: ScheduledUploadReleaseClaim | null = firstClaim;
    harness.dependencies.store.claimNextScheduledUpload = vi.fn(async () => {
      const claim = nextClaim;
      nextClaim = null;
      return claim;
    });

    const originalWorker = createScheduledUploadWorker(harness.dependencies);
    await originalWorker.runTick();
    const persistedSession = harness.store.updateItem.mock.calls.find(
      (call) => "encryptedUploadSession" in call[3],
    )?.[3];
    expect(persistedSession).toMatchObject({
      encryptedUploadSession: "opaque-ciphertext",
      uploadSessionKeyVersion: "v2",
    });
    expect(persistedSession?.encryptedUploadSession).not.toBe(sessionUri);

    nextClaim = resumedClaim;
    const restartedWorker = createScheduledUploadWorker(harness.dependencies);
    const summary = await restartedWorker.runTick();

    expect(harness.dependencies.decryptSession).toHaveBeenCalledWith(
      expect.objectContaining({
        ciphertext: "opaque-ciphertext",
        keyVersion: "v1",
      }),
      "schedule-1:item-resume",
    );
    expect(harness.drive.queryUploadStatus).toHaveBeenCalledWith(
      sessionUri,
      262_145,
    );
    expect(harness.drive.uploadChunk).toHaveBeenCalledWith(
      expect.objectContaining({ start: 262_144, totalBytes: 262_145 }),
    );
    expect(summary.uploadedChunks).toBe(1);
    expect(harness.drive.startResumableUpload).toHaveBeenCalledOnce();
  });
});
