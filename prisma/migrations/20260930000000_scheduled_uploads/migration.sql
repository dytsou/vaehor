CREATE TYPE "ScheduledUploadStatus" AS ENUM (
  'STAGING',
  'WAITING',
  'RELEASING',
  'PARTIAL',
  'NEEDS_ATTENTION',
  'COMPLETED',
  'CANCELED',
  'ABANDONED'
);

CREATE TYPE "ScheduledUploadItemKind" AS ENUM ('FILE', 'FOLDER');

CREATE TYPE "ScheduledUploadItemStatus" AS ENUM (
  'PENDING',
  'STAGING',
  'STAGED',
  'UPLOADING',
  'COMPLETE',
  'FAILED'
);

CREATE TYPE "ScheduledUploadCleanupStatus" AS ENUM ('NONE', 'PENDING', 'COMPLETE');

CREATE TABLE "ScheduledUpload" (
  "id" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "creatorEmail" TEXT NOT NULL,
  "destinationId" TEXT NOT NULL,
  "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
  "scheduledTimeZone" TEXT NOT NULL,
  "scheduledLocalTime" TEXT NOT NULL,
  "scheduledUtcOffset" TEXT NOT NULL,
  "status" "ScheduledUploadStatus" NOT NULL DEFAULT 'STAGING',
  "itemCount" INTEGER NOT NULL,
  "totalBytes" BIGINT NOT NULL DEFAULT 0,
  "stagedBytes" BIGINT NOT NULL DEFAULT 0,
  "stageCompleteAt" TIMESTAMPTZ(3),
  "releaseLeaseToken" TEXT,
  "releaseLeaseUntil" TIMESTAMPTZ(3),
  "firstWriteAt" TIMESTAMPTZ(3),
  "retryAfter" TIMESTAMPTZ(3),
  "lastErrorCode" TEXT,
  "lastErrorMessage" TEXT,
  "adminAlertStatus" TEXT,
  "adminAlertedAt" TIMESTAMPTZ(3),
  "adminAlertLastError" TEXT,
  "cleanupStatus" "ScheduledUploadCleanupStatus" NOT NULL DEFAULT 'NONE',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ScheduledUpload_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScheduledUpload_creatorId_fkey"
    FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ScheduledUploadItem" (
  "id" TEXT NOT NULL,
  "scheduleId" TEXT NOT NULL,
  "manifestPath" TEXT NOT NULL,
  "kind" "ScheduledUploadItemKind" NOT NULL,
  "status" "ScheduledUploadItemStatus" NOT NULL DEFAULT 'PENDING',
  "size" BIGINT NOT NULL DEFAULT 0,
  "sha256" TEXT,
  "contentType" TEXT,
  "storageKey" TEXT,
  "uploadedBytes" BIGINT NOT NULL DEFAULT 0,
  "uploadToken" TEXT,
  "uploadLeaseUntil" TIMESTAMPTZ(3),
  "stagedAt" TIMESTAMPTZ(3),
  "remoteFileId" TEXT,
  "encryptedUploadSession" TEXT,
  "uploadSessionKeyVersion" TEXT,
  "remoteUploadOffset" BIGINT NOT NULL DEFAULT 0,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "retryAfter" TIMESTAMPTZ(3),
  "lastErrorCode" TEXT,
  "lastErrorMessage" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ScheduledUploadItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScheduledUploadItem_scheduleId_fkey"
    FOREIGN KEY ("scheduleId") REFERENCES "ScheduledUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ScheduledUploadAttempt" (
  "id" TEXT NOT NULL,
  "scheduleId" TEXT NOT NULL,
  "itemId" TEXT,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMPTZ(3),
  "retryAfter" TIMESTAMPTZ(3),
  "errorCode" TEXT,
  "errorMessage" TEXT,
  CONSTRAINT "ScheduledUploadAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScheduledUploadAttempt_scheduleId_fkey"
    FOREIGN KEY ("scheduleId") REFERENCES "ScheduledUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ScheduledUploadAttempt_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "ScheduledUploadItem"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ScheduledUpload_releaseLeaseToken_key"
  ON "ScheduledUpload"("releaseLeaseToken");
CREATE INDEX "ScheduledUpload_creatorId_status_scheduledAt_idx"
  ON "ScheduledUpload"("creatorId", "status", "scheduledAt");
CREATE INDEX "ScheduledUpload_status_scheduledAt_idx"
  ON "ScheduledUpload"("status", "scheduledAt");
CREATE INDEX "ScheduledUpload_cleanupStatus_updatedAt_idx"
  ON "ScheduledUpload"("cleanupStatus", "updatedAt");
CREATE UNIQUE INDEX "ScheduledUploadItem_scheduleId_manifestPath_key"
  ON "ScheduledUploadItem"("scheduleId", "manifestPath");
CREATE INDEX "ScheduledUploadItem_scheduleId_status_idx"
  ON "ScheduledUploadItem"("scheduleId", "status");
CREATE INDEX "ScheduledUploadItem_status_retryAfter_idx"
  ON "ScheduledUploadItem"("status", "retryAfter");
CREATE INDEX "ScheduledUploadAttempt_scheduleId_startedAt_idx"
  ON "ScheduledUploadAttempt"("scheduleId", "startedAt");
CREATE INDEX "ScheduledUploadAttempt_itemId_startedAt_idx"
  ON "ScheduledUploadAttempt"("itemId", "startedAt");
