import { CallOutcome, JobType, LeadIntent, LeadStatus, MessageDirection } from "@prisma/client";
import { db } from "@/lib/db";
import { computeMissedCallFollowUpRunTimes } from "@/lib/scheduling";
import { sendSms } from "@/lib/twilio-client";

const DEFAULT_MISSED_CALL_TRIAGE_MESSAGE =
  "Sorry we missed your call - are you contacting us about: 1) Renting/viewing a property 2) A repair/maintenance issue 3) Something else. Reply 1, 2, or 3.";

type DialStatusClassification = {
  outcome: CallOutcome;
  answered: boolean;
  shouldStartTriage: boolean;
};

type HandleDialStatusInput = {
  tenantId: string;
  fromPhone: string;
  toPhone: string;
  twilioCallSid?: string;
  dialStatus?: string;
};

function normalizeDialStatus(statusRaw: string | undefined): string {
  return (statusRaw ?? "").trim().toLowerCase();
}

export function classifyDialStatus(statusRaw: string | undefined): DialStatusClassification {
  const status = normalizeDialStatus(statusRaw);

  if (status === "no-answer") {
    return { outcome: CallOutcome.NO_ANSWER, answered: false, shouldStartTriage: true };
  }

  if (status === "busy") {
    return { outcome: CallOutcome.BUSY, answered: false, shouldStartTriage: true };
  }

  if (status === "failed") {
    return { outcome: CallOutcome.FAILED, answered: false, shouldStartTriage: true };
  }

  return { outcome: CallOutcome.ANSWERED, answered: true, shouldStartTriage: false };
}

function readMissedCallTemplate(messageTemplatesJson: unknown): string {
  if (!messageTemplatesJson || typeof messageTemplatesJson !== "object" || Array.isArray(messageTemplatesJson)) {
    return DEFAULT_MISSED_CALL_TRIAGE_MESSAGE;
  }

  const candidate = (messageTemplatesJson as Record<string, unknown>).missedCallTriage;
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate;
  }

  return DEFAULT_MISSED_CALL_TRIAGE_MESSAGE;
}

function buildOwnerNotificationBody(callerPhone: string): string {
  return `Missed call from ${callerPhone}. Triage SMS was sent and follow-ups are scheduled.`;
}

export async function handleVoiceDialStatus(input: HandleDialStatusInput): Promise<{
  callId: string;
  leadId: string | null;
  triageStarted: boolean;
}> {
  const tenant = await db.tenant.findUnique({
    where: { id: input.tenantId }
  });

  if (!tenant) {
    throw new Error(`Tenant not found: ${input.tenantId}`);
  }

  const classification = classifyDialStatus(input.dialStatus);

  const call = input.twilioCallSid
    ? await db.call.upsert({
        where: {
          twilioCallSid: input.twilioCallSid
        },
        update: {
          tenantId: tenant.id,
          callerPhone: input.fromPhone,
          toPhone: input.toPhone,
          dialStatus: input.dialStatus,
          outcome: classification.outcome,
          answered: classification.answered
        },
        create: {
          tenantId: tenant.id,
          callerPhone: input.fromPhone,
          toPhone: input.toPhone,
          twilioCallSid: input.twilioCallSid,
          dialStatus: input.dialStatus,
          outcome: classification.outcome,
          answered: classification.answered
        }
      })
    : await db.call.create({
        data: {
          tenantId: tenant.id,
          callerPhone: input.fromPhone,
          toPhone: input.toPhone,
          dialStatus: input.dialStatus,
          outcome: classification.outcome,
          answered: classification.answered
        }
      });

  if (!classification.shouldStartTriage) {
    return {
      callId: call.id,
      leadId: null,
      triageStarted: false
    };
  }

  const triageMessage = readMissedCallTemplate(tenant.messageTemplatesJson);
  const now = new Date();

  const lead = await db.lead.create({
    data: {
      tenantId: tenant.id,
      callerPhone: input.fromPhone,
      sourceCallSid: input.twilioCallSid,
      status: LeadStatus.OPEN,
      intent: LeadIntent.UNKNOWN,
      flowStep: 0,
      firstOutboundAt: now
    }
  });

  const triageSend = await sendSms({
    from: tenant.twilioPhoneNumber,
    to: input.fromPhone,
    body: triageMessage
  });

  await db.message.create({
    data: {
      tenantId: tenant.id,
      direction: MessageDirection.OUTBOUND,
      fromPhone: tenant.twilioPhoneNumber,
      toPhone: input.fromPhone,
      body: triageMessage,
      twilioMessageSid: triageSend.sid,
      leadId: lead.id
    }
  });

  const followUpRunTimes = computeMissedCallFollowUpRunTimes(now, tenant.timezone || "Europe/London");

  await db.job.createMany({
    data: followUpRunTimes.map((runAt, index) => ({
      tenantId: tenant.id,
      type: JobType.LEAD_FOLLOW_UP,
      runAt,
      payload: {
        reason: "MISSED_CALL_FOLLOW_UP",
        followUpSequence: index + 1,
        leadId: lead.id,
        callerPhone: input.fromPhone
      },
      leadId: lead.id
    }))
  });

  const ownerBody = buildOwnerNotificationBody(input.fromPhone);
  const ownerSend = await sendSms({
    from: tenant.twilioPhoneNumber,
    to: tenant.ownerNotificationPhoneNumber,
    body: ownerBody
  });

  await db.message.create({
    data: {
      tenantId: tenant.id,
      direction: MessageDirection.OUTBOUND,
      fromPhone: tenant.twilioPhoneNumber,
      toPhone: tenant.ownerNotificationPhoneNumber,
      body: ownerBody,
      twilioMessageSid: ownerSend.sid,
      leadId: lead.id
    }
  });

  return {
    callId: call.id,
    leadId: lead.id,
    triageStarted: true
  };
}
