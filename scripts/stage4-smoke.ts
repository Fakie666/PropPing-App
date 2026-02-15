import { JobType, LeadIntent, LeadStatus } from "@prisma/client";
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
  const openLead = await db.lead.create({
    data: {
      tenantId: tenant.id,
      callerPhone: `+447702${String(now).slice(-6)}`,
      intent: LeadIntent.VIEWING,
      status: LeadStatus.OPEN,
      flowStep: 2,
      name: "Stage4 Open Lead"
    }
  });

  const closedLead = await db.lead.create({
    data: {
      tenantId: tenant.id,
      callerPhone: `+447703${String(now).slice(-6)}`,
      intent: LeadIntent.VIEWING,
      status: LeadStatus.SCHEDULED,
      flowStep: 5,
      name: "Stage4 Closed Lead"
    }
  });

  const [sendableJob, cancelableJob] = await Promise.all([
    db.job.create({
      data: {
        tenantId: tenant.id,
        type: JobType.LEAD_FOLLOW_UP,
        runAt: new Date(Date.now() - 1_000),
        payload: {
          reason: "STAGE4_SMOKE",
          followUpSequence: 1,
          leadId: openLead.id
        },
        leadId: openLead.id
      }
    }),
    db.job.create({
      data: {
        tenantId: tenant.id,
        type: JobType.LEAD_FOLLOW_UP,
        runAt: new Date(Date.now() - 1_000),
        payload: {
          reason: "STAGE4_SMOKE",
          followUpSequence: 2,
          leadId: closedLead.id
        },
        leadId: closedLead.id
      }
    })
  ]);

  const stats = await processDueJobs({
    workerId: "stage4-smoke",
    batchSize: 20,
    lockTimeoutMs: 600_000,
    retryDelayMs: 30_000
  });

  const refreshedSendableJob = await db.job.findUnique({ where: { id: sendableJob.id } });
  const refreshedCancelableJob = await db.job.findUnique({ where: { id: cancelableJob.id } });

  if (!refreshedSendableJob || refreshedSendableJob.status !== "SENT") {
    throw new Error(`Expected sendable job to be SENT, got ${refreshedSendableJob?.status ?? "missing"}.`);
  }

  if (!refreshedCancelableJob || refreshedCancelableJob.status !== "CANCELED") {
    throw new Error(`Expected cancelable job to be CANCELED, got ${refreshedCancelableJob?.status ?? "missing"}.`);
  }

  const openLeadMessageCount = await db.message.count({
    where: {
      leadId: openLead.id
    }
  });

  if (openLeadMessageCount < 1) {
    throw new Error("Expected at least one follow-up outbound message for the open lead.");
  }

  console.log("Stage 4 smoke check passed.");
  console.log(
    JSON.stringify(
      {
        stats,
        sendableJobStatus: refreshedSendableJob.status,
        cancelableJobStatus: refreshedCancelableJob.status,
        openLeadMessageCount
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
