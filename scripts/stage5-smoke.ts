import { DocumentType, JobStatus, JobType } from "@prisma/client";
import { scheduleComplianceReminderJobsForDocument } from "../src/lib/compliance";
import { db } from "../src/lib/db";
import { processDueJobs } from "../src/lib/jobs";

async function main() {
  const tenant = await db.tenant.findUnique({
    where: { twilioPhoneNumber: "+442071234567" }
  });

  if (!tenant) {
    throw new Error("Demo tenant not found. Run `npm run db:seed` first.");
  }

  const now = Date.now();
  const property = await db.property.create({
    data: {
      tenantId: tenant.id,
      propertyRef: `SM5-${now}`,
      addressLine1: "5 Stage Five Road",
      city: "London",
      postcode: "SW1A 2AB"
    }
  });

  const soonExpiryDoc = await db.complianceDocument.create({
    data: {
      tenantId: tenant.id,
      propertyId: property.id,
      documentType: DocumentType.OTHER,
      issueDate: new Date(),
      expiryDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
      status: "DUE_SOON"
    }
  });

  const overdueDoc = await db.complianceDocument.create({
    data: {
      tenantId: tenant.id,
      propertyId: property.id,
      documentType: DocumentType.EPC,
      issueDate: new Date(),
      expiryDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      status: "OVERDUE"
    }
  });

  const [soonCount, overdueCount] = await Promise.all([
    scheduleComplianceReminderJobsForDocument(soonExpiryDoc.id),
    scheduleComplianceReminderJobsForDocument(overdueDoc.id)
  ]);

  if (soonCount < 3) {
    throw new Error(`Expected at least 3 scheduled reminders for soon-expiry doc, got ${soonCount}.`);
  }

  if (overdueCount < 1) {
    throw new Error(`Expected at least 1 scheduled reminder for overdue doc, got ${overdueCount}.`);
  }

  await db.job.updateMany({
    where: {
      type: JobType.COMPLIANCE_REMINDER,
      status: JobStatus.PENDING,
      payload: {
        path: ["complianceDocumentId"],
        equals: overdueDoc.id
      }
    },
    data: {
      runAt: new Date(Date.now() - 5_000)
    }
  });

  const stats = await processDueJobs({
    workerId: "stage5-smoke",
    batchSize: 20,
    lockTimeoutMs: 600_000,
    retryDelayMs: 30_000
  });

  const sentForOverdue = await db.job.count({
    where: {
      type: JobType.COMPLIANCE_REMINDER,
      status: JobStatus.SENT,
      payload: {
        path: ["complianceDocumentId"],
        equals: overdueDoc.id
      }
    }
  });

  const pendingOverdue = await db.job.count({
    where: {
      type: JobType.COMPLIANCE_REMINDER,
      status: JobStatus.PENDING,
      AND: [
        {
          payload: {
            path: ["complianceDocumentId"],
            equals: overdueDoc.id
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

  if (sentForOverdue < 1) {
    throw new Error("Expected an overdue compliance reminder to be sent.");
  }

  if (pendingOverdue < 1) {
    throw new Error("Expected a next overdue reminder to be scheduled.");
  }

  console.log("Stage 5 smoke check passed.");
  console.log(
    JSON.stringify(
      {
        stats,
        soonScheduled: soonCount,
        overdueScheduledInitially: overdueCount,
        sentForOverdue,
        pendingOverdue
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
