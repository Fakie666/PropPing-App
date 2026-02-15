import { ComplianceStatus, JobStatus, JobType, type Prisma } from "@prisma/client";
import { db } from "./db";

const DAY_MS = 24 * 60 * 60 * 1000;

export type CompliancePolicy = {
  dueSoonDays: number[];
  overdueReminderDays: number;
};

export type ComplianceReminderEvent = {
  runAt: Date;
  reminderKind: "DUE_SOON" | "OVERDUE";
  thresholdDays: number | null;
};

export function parseCompliancePolicy(source: Prisma.JsonValue | null): CompliancePolicy {
  const defaults: CompliancePolicy = {
    dueSoonDays: [30, 14, 7],
    overdueReminderDays: 7
  };

  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return defaults;
  }

  const record = source as Record<string, unknown>;
  const dueSoonRaw = record.dueSoonDays;
  const overdueRaw = record.overdueReminderDays;

  const dueSoonDays = Array.isArray(dueSoonRaw)
    ? dueSoonRaw
        .filter((v) => typeof v === "number" && Number.isFinite(v))
        .map((v) => Math.max(1, Math.floor(Number(v))))
        .filter((v, i, all) => all.indexOf(v) === i)
        .sort((a, b) => b - a)
    : defaults.dueSoonDays;

  const overdueReminderDays =
    typeof overdueRaw === "number" && Number.isFinite(overdueRaw)
      ? Math.max(1, Math.floor(Number(overdueRaw)))
      : defaults.overdueReminderDays;

  return {
    dueSoonDays: dueSoonDays.length > 0 ? dueSoonDays : defaults.dueSoonDays,
    overdueReminderDays
  };
}

export function deriveComplianceStatus(expiryDate: Date | null, now: Date, policy: CompliancePolicy): ComplianceStatus {
  if (!expiryDate) {
    return ComplianceStatus.MISSING;
  }

  const daysToExpiry = Math.ceil((expiryDate.getTime() - now.getTime()) / DAY_MS);
  if (daysToExpiry < 0) {
    return ComplianceStatus.OVERDUE;
  }

  if (daysToExpiry <= Math.max(...policy.dueSoonDays)) {
    return ComplianceStatus.DUE_SOON;
  }

  return ComplianceStatus.OK;
}

export function computeComplianceReminderEvents(
  expiryDate: Date | null,
  policy: CompliancePolicy,
  now: Date
): ComplianceReminderEvent[] {
  if (!expiryDate) {
    return [];
  }

  const events: ComplianceReminderEvent[] = [];

  for (const days of policy.dueSoonDays) {
    const runAt = new Date(expiryDate.getTime() - days * DAY_MS);
    if (runAt > now) {
      events.push({
        runAt,
        reminderKind: "DUE_SOON",
        thresholdDays: days
      });
    }
  }

  const overdueRunAt = new Date(expiryDate.getTime() + policy.overdueReminderDays * DAY_MS);
  events.push({
    runAt: overdueRunAt > now ? overdueRunAt : new Date(now.getTime() + 1_000),
    reminderKind: "OVERDUE",
    thresholdDays: null
  });

  return events.sort((a, b) => a.runAt.getTime() - b.runAt.getTime());
}

export async function cancelPendingComplianceJobsForDocument(
  complianceDocumentId: string,
  reason: string
): Promise<number> {
  const result = await db.job.updateMany({
    where: {
      type: JobType.COMPLIANCE_REMINDER,
      status: JobStatus.PENDING,
      payload: {
        path: ["complianceDocumentId"],
        equals: complianceDocumentId
      }
    },
    data: {
      status: JobStatus.CANCELED,
      canceledAt: new Date(),
      lastError: reason
    }
  });

  return result.count;
}

export async function scheduleComplianceReminderJobsForDocument(complianceDocumentId: string): Promise<number> {
  const document = await db.complianceDocument.findUnique({
    where: { id: complianceDocumentId },
    include: {
      tenant: true
    }
  });

  if (!document) {
    return 0;
  }

  const now = new Date();
  const policy = parseCompliancePolicy(document.tenant.compliancePolicyJson);
  const status = deriveComplianceStatus(document.expiryDate, now, policy);

  await db.complianceDocument.update({
    where: { id: document.id },
    data: { status }
  });

  await cancelPendingComplianceJobsForDocument(document.id, "Replaced by latest compliance schedule.");

  const events = computeComplianceReminderEvents(document.expiryDate, policy, now);
  if (events.length === 0) {
    return 0;
  }

  const result = await db.job.createMany({
    data: events.map((event) => ({
      tenantId: document.tenantId,
      type: JobType.COMPLIANCE_REMINDER,
      status: JobStatus.PENDING,
      runAt: event.runAt,
      payload: {
        complianceDocumentId: document.id,
        reminderKind: event.reminderKind,
        thresholdDays: event.thresholdDays
      }
    }))
  });

  return result.count;
}

export async function scheduleComplianceReminderJobsForTenant(tenantId: string): Promise<number> {
  const documents = await db.complianceDocument.findMany({
    where: { tenantId },
    select: { id: true }
  });

  let count = 0;
  for (const document of documents) {
    count += await scheduleComplianceReminderJobsForDocument(document.id);
  }
  return count;
}
