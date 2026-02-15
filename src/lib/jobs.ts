import {
  ComplianceStatus,
  JobStatus,
  JobType,
  LeadStatus,
  MaintenanceStatus,
  MessageDirection,
  type Tenant,
  type Job,
  type Prisma
} from "@prisma/client";
import { db } from "./db";
import { deriveComplianceStatus, parseCompliancePolicy } from "./compliance";
import { getMessageTemplate } from "./templates";
import { sendSms } from "./twilio-client";

const LEAD_FOLLOW_UP_CANCEL_STATUSES = new Set<LeadStatus>([
  LeadStatus.CLOSED,
  LeadStatus.OPTED_OUT,
  LeadStatus.OUT_OF_AREA,
  LeadStatus.NEEDS_HUMAN,
  LeadStatus.SCHEDULED
]);

type ProcessJobsOptions = {
  workerId: string;
  batchSize: number;
  lockTimeoutMs: number;
  retryDelayMs: number;
};

type JobProcessingStats = {
  locked: number;
  sent: number;
  canceled: number;
  failed: number;
  retried: number;
};

export function shouldCancelLeadFollowUp(status: LeadStatus): boolean {
  return LEAD_FOLLOW_UP_CANCEL_STATUSES.has(status);
}

function parsePayloadObject(payload: Prisma.JsonValue): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  return payload as Record<string, unknown>;
}

function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function readNumber(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function getLeadFollowUpBody(sequence: number, tenant: Tenant): string {
  if (sequence <= 1) {
    return getMessageTemplate(tenant, "leadFollowUpFirst");
  }
  return getMessageTemplate(tenant, "leadFollowUpSecond");
}

async function markJobSent(jobId: string): Promise<void> {
  await db.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.SENT,
      sentAt: new Date(),
      attempts: { increment: 1 },
      lockedAt: null,
      lockedBy: null,
      lastError: null
    }
  });
}

async function markJobCanceled(jobId: string, reason: string): Promise<void> {
  await db.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.CANCELED,
      canceledAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: reason
    }
  });
}

async function markJobRetryOrFailed(job: Job, error: unknown, retryDelayMs: number): Promise<"retried" | "failed"> {
  const attempts = job.attempts + 1;
  const reason = error instanceof Error ? error.message : String(error);

  if (attempts >= job.maxAttempts) {
    await db.job.update({
      where: { id: job.id },
      data: {
        status: JobStatus.FAILED,
        attempts,
        lastError: reason,
        lockedAt: null,
        lockedBy: null
      }
    });
    return "failed";
  }

  await db.job.update({
    where: { id: job.id },
    data: {
      status: JobStatus.PENDING,
      attempts,
      runAt: new Date(Date.now() + retryDelayMs),
      lastError: reason,
      lockedAt: null,
      lockedBy: null
    }
  });
  return "retried";
}

async function lockDueJobs(workerId: string, batchSize: number, lockTimeoutMs: number): Promise<Job[]> {
  const lockExpiredBefore = new Date(Date.now() - lockTimeoutMs);

  const ids = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      WITH due AS (
        SELECT id
        FROM "Job"
        WHERE status = 'PENDING'
          AND "runAt" <= NOW()
          AND ("lockedAt" IS NULL OR "lockedAt" <= ${lockExpiredBefore})
        ORDER BY "runAt" ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "Job" AS j
      SET "lockedAt" = NOW(), "lockedBy" = ${workerId}
      FROM due
      WHERE j.id = due.id
      RETURNING j.id;
    `;
    return rows.map((row) => row.id);
  });

  if (ids.length === 0) {
    return [];
  }

  return db.job.findMany({
    where: { id: { in: ids } },
    orderBy: { runAt: "asc" }
  });
}

async function executeLeadFollowUp(job: Job): Promise<"sent" | "canceled"> {
  const payload = parsePayloadObject(job.payload);
  const leadId = job.leadId ?? readString(payload, "leadId");
  const sequence = readNumber(payload, "followUpSequence") ?? 1;

  if (!leadId) {
    await markJobCanceled(job.id, "Missing leadId on follow-up job payload.");
    return "canceled";
  }

  const lead = await db.lead.findUnique({
    where: { id: leadId }
  });
  if (!lead) {
    await markJobCanceled(job.id, `Lead not found: ${leadId}`);
    return "canceled";
  }

  if (shouldCancelLeadFollowUp(lead.status)) {
    await markJobCanceled(job.id, `Lead status ${lead.status} is terminal for follow-up.`);
    return "canceled";
  }

  const tenant = await db.tenant.findUnique({ where: { id: lead.tenantId } });
  if (!tenant) {
    await markJobCanceled(job.id, `Tenant not found for lead ${leadId}`);
    return "canceled";
  }

  const optOut = await db.optOut.findUnique({
    where: {
      tenantId_phone: {
        tenantId: tenant.id,
        phone: lead.callerPhone
      }
    }
  });

  if (optOut?.active) {
    await db.lead.update({
      where: { id: lead.id },
      data: { status: LeadStatus.OPTED_OUT }
    });
    await markJobCanceled(job.id, "Caller has opted out.");
    return "canceled";
  }

  const body = getLeadFollowUpBody(sequence, tenant);
  const sendResult = await sendSms({
    from: tenant.twilioPhoneNumber,
    to: lead.callerPhone,
    body
  });

  await db.message.create({
    data: {
      tenantId: tenant.id,
      direction: MessageDirection.OUTBOUND,
      fromPhone: tenant.twilioPhoneNumber,
      toPhone: lead.callerPhone,
      body,
      twilioMessageSid: sendResult.sid,
      leadId: lead.id
    }
  });

  await markJobSent(job.id);
  return "sent";
}

async function executeComplianceReminder(job: Job): Promise<"sent" | "canceled"> {
  const payload = parsePayloadObject(job.payload);
  const documentId = readString(payload, "complianceDocumentId");

  if (!documentId) {
    await markJobCanceled(job.id, "Missing complianceDocumentId in payload.");
    return "canceled";
  }

  const document = await db.complianceDocument.findUnique({
    where: { id: documentId },
    include: {
      property: true
    }
  });

  if (!document) {
    await markJobCanceled(job.id, `Compliance document not found: ${documentId}`);
    return "canceled";
  }

  const tenant = await db.tenant.findUnique({
    where: { id: document.tenantId }
  });

  if (!tenant) {
    await markJobCanceled(job.id, `Tenant not found for compliance document ${documentId}`);
    return "canceled";
  }

  const policy = parseCompliancePolicy(tenant.compliancePolicyJson);
  const now = new Date();
  const status = deriveComplianceStatus(document.expiryDate, now, policy);

  await db.complianceDocument.update({
    where: { id: document.id },
    data: {
      status,
      lastReminderAt: now
    }
  });

  if (status === ComplianceStatus.OK) {
    await markJobCanceled(job.id, "Compliance document is no longer due/overdue.");
    return "canceled";
  }

  const expiryPart = document.expiryDate ? `Expiry: ${document.expiryDate.toISOString().slice(0, 10)}.` : "No expiry date.";
  const body = `Compliance reminder: ${document.documentType} for ${document.property.propertyRef} is ${status}. ${expiryPart}`;

  const sendResult = await sendSms({
    from: tenant.twilioPhoneNumber,
    to: tenant.ownerNotificationPhoneNumber,
    body
  });

  await db.message.create({
    data: {
      tenantId: tenant.id,
      direction: MessageDirection.OUTBOUND,
      fromPhone: tenant.twilioPhoneNumber,
      toPhone: tenant.ownerNotificationPhoneNumber,
      body,
      twilioMessageSid: sendResult.sid
    }
  });

  if (status === ComplianceStatus.OVERDUE) {
    const hasPendingOverdue = await db.job.count({
      where: {
        NOT: {
          id: job.id
        },
        type: JobType.COMPLIANCE_REMINDER,
        status: JobStatus.PENDING,
        AND: [
          {
            payload: {
              path: ["complianceDocumentId"],
              equals: document.id
            }
          },
          {
            payload: {
              path: ["reminderKind"],
              equals: "OVERDUE"
            }
          }
        ]
      }
    });

    if (hasPendingOverdue === 0) {
      await db.job.create({
        data: {
          tenantId: tenant.id,
          type: JobType.COMPLIANCE_REMINDER,
          runAt: new Date(now.getTime() + policy.overdueReminderDays * 24 * 60 * 60 * 1000),
          payload: {
            complianceDocumentId: document.id,
            reminderKind: "OVERDUE",
            thresholdDays: null
          }
        }
      });
    }
  }

  await markJobSent(job.id);
  return "sent";
}

async function executeOwnerNotification(job: Job): Promise<"sent" | "canceled"> {
  const payload = parsePayloadObject(job.payload);
  const body = readString(payload, "body");
  const toPhoneOverride = readString(payload, "toPhone");

  if (!body) {
    await markJobCanceled(job.id, "Missing owner notification body in payload.");
    return "canceled";
  }

  const tenant = await db.tenant.findUnique({
    where: { id: job.tenantId }
  });
  if (!tenant) {
    await markJobCanceled(job.id, `Tenant not found: ${job.tenantId}`);
    return "canceled";
  }

  const toPhone = toPhoneOverride ?? tenant.ownerNotificationPhoneNumber;

  const sendResult = await sendSms({
    from: tenant.twilioPhoneNumber,
    to: toPhone,
    body
  });

  await db.message.create({
    data: {
      tenantId: tenant.id,
      direction: MessageDirection.OUTBOUND,
      fromPhone: tenant.twilioPhoneNumber,
      toPhone,
      body,
      twilioMessageSid: sendResult.sid,
      leadId: job.leadId,
      maintenanceRequestId: job.maintenanceRequestId
    }
  });

  await markJobSent(job.id);
  return "sent";
}

async function executeSingleJob(job: Job): Promise<"sent" | "canceled"> {
  if (job.type === JobType.LEAD_FOLLOW_UP) {
    return executeLeadFollowUp(job);
  }

  if (job.type === JobType.COMPLIANCE_REMINDER) {
    return executeComplianceReminder(job);
  }

  if (job.type === JobType.OWNER_NOTIFICATION) {
    return executeOwnerNotification(job);
  }

  await markJobCanceled(job.id, `Unsupported job type: ${job.type}`);
  return "canceled";
}

export async function processDueJobs(options: ProcessJobsOptions): Promise<JobProcessingStats> {
  const stats: JobProcessingStats = {
    locked: 0,
    sent: 0,
    canceled: 0,
    failed: 0,
    retried: 0
  };

  while (true) {
    const jobs = await lockDueJobs(options.workerId, options.batchSize, options.lockTimeoutMs);
    if (jobs.length === 0) {
      break;
    }

    stats.locked += jobs.length;

    for (const job of jobs) {
      try {
        const result = await executeSingleJob(job);
        if (result === "sent") {
          stats.sent += 1;
        } else {
          stats.canceled += 1;
        }
      } catch (error) {
        const failureResult = await markJobRetryOrFailed(job, error, options.retryDelayMs);
        if (failureResult === "failed") {
          stats.failed += 1;
        } else {
          stats.retried += 1;
        }
      }
    }
  }

  return stats;
}

export async function cancelPendingJobsForClosedConversations(): Promise<number> {
  const leads = await db.lead.findMany({
    where: {
      status: {
        in: [LeadStatus.CLOSED, LeadStatus.SCHEDULED, LeadStatus.NEEDS_HUMAN, LeadStatus.OUT_OF_AREA, LeadStatus.OPTED_OUT]
      }
    },
    select: { id: true }
  });

  const maintenance = await db.maintenanceRequest.findMany({
    where: {
      status: {
        in: [
          MaintenanceStatus.CLOSED,
          MaintenanceStatus.NEEDS_HUMAN,
          MaintenanceStatus.OUT_OF_AREA,
          MaintenanceStatus.OPTED_OUT
        ]
      }
    },
    select: { id: true }
  });

  const clauses = [
    leads.length > 0
      ? {
          leadId: {
            in: leads.map((row) => row.id)
          }
        }
      : null,
    maintenance.length > 0
      ? {
          maintenanceRequestId: {
            in: maintenance.map((row) => row.id)
          }
        }
      : null
  ].filter(Boolean) as Array<{ leadId?: { in: string[] }; maintenanceRequestId?: { in: string[] } }>;

  if (clauses.length === 0) {
    return 0;
  }

  const result = await db.job.updateMany({
    where: {
      status: JobStatus.PENDING,
      OR: clauses
    },
    data: {
      status: JobStatus.CANCELED,
      canceledAt: new Date(),
      lastError: "Conversation reached terminal status before job execution."
    }
  });

  return result.count;
}
