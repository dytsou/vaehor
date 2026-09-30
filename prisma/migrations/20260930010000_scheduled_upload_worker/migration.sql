ALTER TABLE "ScheduledUpload"
  ADD COLUMN "claimedAt" TIMESTAMPTZ(3),
  ADD COLUMN "firstWriteAttemptAt" TIMESTAMPTZ(3),
  ADD COLUMN "completedAt" TIMESTAMPTZ(3),
  ADD COLUMN "pollerLagMs" BIGINT,
  ADD COLUMN "leaseRecoveryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "leaseRecoveredAt" TIMESTAMPTZ(3),
  ADD COLUMN "workerRetryCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ScheduledUploadItem"
  ADD COLUMN "uploadSessionNonce" TEXT,
  ADD COLUMN "uploadSessionTag" TEXT,
  ADD COLUMN "releaseVerifiedAt" TIMESTAMPTZ(3);

CREATE INDEX "ScheduledUpload_status_scheduledAt_retryAfter_releaseLeaseUntil_idx"
  ON "ScheduledUpload"("status", "scheduledAt", "retryAfter", "releaseLeaseUntil");
