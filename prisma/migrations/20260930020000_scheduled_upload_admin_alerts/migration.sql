CREATE TYPE "ScheduledUploadAdminAlertStatus" AS ENUM (
  'OPEN',
  'ACKNOWLEDGED',
  'RESOLVED'
);

CREATE TYPE "ScheduledUploadAdminEmailStatus" AS ENUM (
  'PENDING',
  'SENDING',
  'SENT',
  'FAILED'
);

ALTER TABLE "ScheduledUpload"
ADD COLUMN "roleRevocationCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ScheduledUploadAdminAlert" (
  "id" TEXT NOT NULL,
  "scheduleId" TEXT NOT NULL,
  "occurrence" INTEGER NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "status" "ScheduledUploadAdminAlertStatus" NOT NULL DEFAULT 'OPEN',
  "emailStatus" "ScheduledUploadAdminEmailStatus" NOT NULL DEFAULT 'PENDING',
  "emailAttempts" INTEGER NOT NULL DEFAULT 0,
  "emailRetryAfter" TIMESTAMPTZ(3),
  "emailLeaseToken" TEXT,
  "emailLeaseUntil" TIMESTAMPTZ(3),
  "emailLastError" TEXT,
  "acknowledgedAt" TIMESTAMPTZ(3),
  "acknowledgedByEmail" TEXT,
  "resolvedAt" TIMESTAMPTZ(3),
  "resolvedByEmail" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "ScheduledUploadAdminAlert_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScheduledUploadAdminAlert_scheduleId_fkey"
    FOREIGN KEY ("scheduleId") REFERENCES "ScheduledUpload"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ScheduledUploadAdminAlert_occurrence_check" CHECK ("occurrence" > 0),
  CONSTRAINT "ScheduledUploadAdminAlert_emailAttempts_check" CHECK ("emailAttempts" >= 0)
);

CREATE UNIQUE INDEX "ScheduledUploadAdminAlert_emailLeaseToken_key"
ON "ScheduledUploadAdminAlert"("emailLeaseToken");

CREATE UNIQUE INDEX "ScheduledUploadAdminAlert_scheduleId_reasonCode_occurrence_key"
ON "ScheduledUploadAdminAlert"("scheduleId", "reasonCode", "occurrence");

CREATE INDEX "ScheduledUploadAdminAlert_status_createdAt_idx"
ON "ScheduledUploadAdminAlert"("status", "createdAt");

CREATE INDEX "ScheduledUploadAdminAlert_emailStatus_emailRetryAfter_emailLeaseUntil_idx"
ON "ScheduledUploadAdminAlert"("emailStatus", "emailRetryAfter", "emailLeaseUntil");
