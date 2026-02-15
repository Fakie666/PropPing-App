import { db } from "../src/lib/db";
import { handleInboundSms } from "../src/lib/sms";
import { handleVoiceDialStatus } from "../src/lib/voice";

async function main() {
  const tenant = await db.tenant.findUnique({
    where: { twilioPhoneNumber: "+442071234567" }
  });

  if (!tenant) {
    throw new Error("Demo tenant not found. Run `npm run db:seed` first.");
  }

  const unique = Date.now();
  const callerPhone = `+447701${String(unique).slice(-6)}`;
  const callSid = `CA_STAGE3_${unique}`;

  await handleVoiceDialStatus({
    tenantId: tenant.id,
    fromPhone: callerPhone,
    toPhone: tenant.twilioPhoneNumber,
    twilioCallSid: callSid,
    dialStatus: "no-answer"
  });

  await handleInboundSms({
    tenant,
    fromPhone: callerPhone,
    toPhone: tenant.twilioPhoneNumber,
    body: "2",
    twilioMessageSid: `SM_STAGE3_${unique}_1`
  });

  let request = await db.maintenanceRequest.findFirst({
    where: {
      tenantId: tenant.id,
      callerPhone
    },
    orderBy: { createdAt: "desc" }
  });

  if (!request) {
    throw new Error("Maintenance request was not created from SMS intent '2'.");
  }

  await handleInboundSms({
    tenant,
    fromPhone: callerPhone,
    toPhone: tenant.twilioPhoneNumber,
    body: "My name is Jamie Smith",
    twilioMessageSid: `SM_STAGE3_${unique}_2`
  });
  await handleInboundSms({
    tenant,
    fromPhone: callerPhone,
    toPhone: tenant.twilioPhoneNumber,
    body: "22 River Road SE1 7PB",
    twilioMessageSid: `SM_STAGE3_${unique}_3`
  });
  await handleInboundSms({
    tenant,
    fromPhone: callerPhone,
    toPhone: tenant.twilioPhoneNumber,
    body: "Boiler pressure keeps dropping overnight",
    twilioMessageSid: `SM_STAGE3_${unique}_4`
  });
  await handleInboundSms({
    tenant,
    fromPhone: callerPhone,
    toPhone: tenant.twilioPhoneNumber,
    body: "urgent",
    twilioMessageSid: `SM_STAGE3_${unique}_5`
  });

  request = await db.maintenanceRequest.findUnique({
    where: { id: request.id }
  });

  if (!request) {
    throw new Error("Maintenance request disappeared unexpectedly.");
  }

  if (request.status !== "LOGGED") {
    throw new Error(`Expected maintenance status LOGGED, got ${request.status}.`);
  }

  if (!request.name || !request.propertyAddress || !request.issueDescription || !request.severity) {
    throw new Error("Maintenance request did not collect all expected fields.");
  }

  const messageCount = await db.message.count({
    where: { maintenanceRequestId: request.id }
  });

  if (messageCount < 6) {
    throw new Error(`Expected at least 6 maintenance-linked messages, got ${messageCount}.`);
  }

  console.log("Stage 3 smoke check passed.");
  console.log(
    JSON.stringify(
      {
        maintenanceRequestId: request.id,
        status: request.status,
        severity: request.severity,
        messageCount
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
