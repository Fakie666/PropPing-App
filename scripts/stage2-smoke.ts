import { db } from "../src/lib/db";
import { handleVoiceDialStatus } from "../src/lib/voice";

async function main() {
  const tenant = await db.tenant.findUnique({
    where: { twilioPhoneNumber: "+442071234567" }
  });

  if (!tenant) {
    throw new Error("Demo tenant not found. Run `npm run db:seed` first.");
  }

  const unique = Date.now();
  const callerPhone = `+4477009${String(unique).slice(-6)}`;
  const callSid = `CA_STAGE2_${unique}`;

  const result = await handleVoiceDialStatus({
    tenantId: tenant.id,
    fromPhone: callerPhone,
    toPhone: tenant.twilioPhoneNumber,
    twilioCallSid: callSid,
    dialStatus: "no-answer"
  });

  if (!result.triageStarted || !result.leadId) {
    throw new Error("Expected missed-call triage to start and create a lead.");
  }

  const call = await db.call.findFirst({
    where: { twilioCallSid: callSid }
  });
  const messageCount = await db.message.count({
    where: { leadId: result.leadId }
  });
  const followUpJobCount = await db.job.count({
    where: {
      leadId: result.leadId,
      type: "LEAD_FOLLOW_UP"
    }
  });

  if (!call) {
    throw new Error("Call log record was not created.");
  }

  if (messageCount < 2) {
    throw new Error(`Expected at least 2 messages for lead ${result.leadId}, found ${messageCount}.`);
  }

  if (followUpJobCount < 2) {
    throw new Error(`Expected at least 2 follow-up jobs for lead ${result.leadId}, found ${followUpJobCount}.`);
  }

  console.log("Stage 2 smoke check passed.");
  console.log(
    JSON.stringify(
      {
        callId: result.callId,
        leadId: result.leadId,
        messageCount,
        followUpJobCount
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
