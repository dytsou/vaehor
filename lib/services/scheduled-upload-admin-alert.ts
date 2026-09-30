import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { collectAdminEmails } from "@/lib/incident-monitor";
import { sendMail } from "@/lib/mailer";

type AdminAlertStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED";

interface AlertEmailClaim {
  id: string;
  scheduleId: string;
  occurrence: number;
  reasonCode: string;
  emailAttempts: number;
}

function emailRetryDelayMilliseconds(attempts: number) {
  return Math.min(
    30_000 * 2 ** Math.min(Math.max(attempts - 1, 0), 7),
    60 * 60 * 1000,
  );
}

async function claimNextAdminAlertEmail(): Promise<
  (AlertEmailClaim & { leaseToken: string }) | null
> {
  const leaseToken = randomUUID();
  const claimed = await db.$queryRaw<Array<AlertEmailClaim>>`
    WITH candidate AS (
      SELECT "id"
      FROM "ScheduledUploadAdminAlert"
      WHERE "emailStatus" IN ('PENDING', 'FAILED', 'SENDING')
        AND ("emailRetryAfter" IS NULL OR "emailRetryAfter" <= statement_timestamp())
        AND (
          "emailLeaseToken" IS NULL
          OR "emailLeaseUntil" IS NULL
          OR "emailLeaseUntil" <= statement_timestamp()
        )
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE "ScheduledUploadAdminAlert" AS alert
    SET
      "emailStatus" = 'SENDING',
      "emailAttempts" = alert."emailAttempts" + 1,
      "emailRetryAfter" = NULL,
      "emailLeaseToken" = ${leaseToken},
      "emailLeaseUntil" = statement_timestamp() + INTERVAL '2 minutes',
      "emailLastError" = NULL,
      "updatedAt" = statement_timestamp()
    FROM candidate
    WHERE alert."id" = candidate."id"
    RETURNING
      alert."id",
      alert."scheduleId",
      alert."occurrence",
      alert."reasonCode",
      alert."emailAttempts"
  `;
  return claimed[0] ? { ...claimed[0], leaseToken } : null;
}

async function markAdminAlertEmailSent(
  claim: AlertEmailClaim & { leaseToken: string },
) {
  const updated = await db.$executeRaw`
    UPDATE "ScheduledUploadAdminAlert"
    SET
      "emailStatus" = 'SENT',
      "emailLeaseToken" = NULL,
      "emailLeaseUntil" = NULL,
      "emailRetryAfter" = NULL,
      "emailLastError" = NULL,
      "updatedAt" = statement_timestamp()
    WHERE "id" = ${claim.id}
      AND "emailStatus" = 'SENDING'
      AND "emailLeaseToken" = ${claim.leaseToken}
  `;
  return Number(updated) === 1;
}

async function markAdminAlertEmailFailed(
  claim: AlertEmailClaim & { leaseToken: string },
  errorMessage: string,
) {
  const retryDelay = emailRetryDelayMilliseconds(claim.emailAttempts);
  const updated = await db.$executeRaw`
    UPDATE "ScheduledUploadAdminAlert"
    SET
      "emailStatus" = 'FAILED',
      "emailLeaseToken" = NULL,
      "emailLeaseUntil" = NULL,
      "emailRetryAfter" = statement_timestamp() + (${retryDelay} * INTERVAL '1 millisecond'),
      "emailLastError" = ${errorMessage},
      "updatedAt" = statement_timestamp()
    WHERE "id" = ${claim.id}
      AND "emailStatus" = 'SENDING'
      AND "emailLeaseToken" = ${claim.leaseToken}
  `;
  return Number(updated) === 1;
}

export async function deliverNextScheduledUploadAdminAlertEmail() {
  const claim = await claimNextAdminAlertEmail();
  if (!claim) return { processed: 0, sent: 0, failed: 0 };

  let recipients: string[];
  try {
    recipients = await collectAdminEmails();
  } catch {
    recipients = [];
  }

  if (recipients.length === 0) {
    await markAdminAlertEmailFailed(
      claim,
      "No administrator email recipients are configured.",
    );
    return { processed: 1, sent: 0, failed: 1 };
  }

  let sent = false;
  try {
    sent = await sendMail({
      to: recipients,
      subject: "[vaehor Alert] Scheduled upload needs attention",
      html: [
        "<p>A scheduled Drive upload is paused because the creator no longer has editor access.</p>",
        "<p>Schedule reference: " + claim.scheduleId + "</p>",
        "<p>Sign in and open Admin &gt; Scheduled uploads to acknowledge or cancel it.</p>",
      ].join(""),
    });
  } catch {
    sent = false;
  }

  if (!sent) {
    await markAdminAlertEmailFailed(
      claim,
      "Administrator alert email delivery failed.",
    );
    return { processed: 1, sent: 0, failed: 1 };
  }

  const recorded = await markAdminAlertEmailSent(claim);
  return {
    processed: 1,
    sent: recorded ? 1 : 0,
    failed: recorded ? 0 : 1,
  };
}

export async function listScheduledUploadAdminAlerts(
  status?: AdminAlertStatus,
) {
  return db.scheduledUploadAdminAlert.findMany({
    where: status ? { status } : undefined,
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
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function updateScheduledUploadAdminAlertStatus(input: {
  alertId: string;
  status: Exclude<AdminAlertStatus, "OPEN">;
  actorEmail: string;
}) {
  const current = await db.scheduledUploadAdminAlert.findUnique({
    where: { id: input.alertId },
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
  });
  if (!current) return null;
  if (current.status === input.status) return current;
  if (current.status === "RESOLVED") return null;

  const timestamp = new Date();
  const result = await db.scheduledUploadAdminAlert.updateMany({
    where: {
      id: input.alertId,
      status: current.status,
    },
    data:
      input.status === "ACKNOWLEDGED"
        ? {
            status: "ACKNOWLEDGED",
            acknowledgedAt: timestamp,
            acknowledgedByEmail: input.actorEmail,
          }
        : {
            status: "RESOLVED",
            resolvedAt: timestamp,
            resolvedByEmail: input.actorEmail,
          },
  });
  if (result.count !== 1) return null;

  return db.scheduledUploadAdminAlert.findUnique({
    where: { id: input.alertId },
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
  });
}
