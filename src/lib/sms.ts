import {
  JobStatus,
  LeadIntent,
  LeadStatus,
  MaintenanceStatus,
  MessageDirection,
  type Lead,
  type MaintenanceRequest,
  type Tenant
} from "@prisma/client";
import { db } from "@/lib/db";
import { extractSmsSignals } from "@/lib/extraction";
import { getMessageTemplate } from "@/lib/templates";
import { sendSms } from "@/lib/twilio-client";

type SmsInboundInput = {
  tenant: Tenant;
  fromPhone: string;
  toPhone: string;
  body: string;
  twilioMessageSid?: string;
};

type ConversationRef = {
  leadId: string | null;
  maintenanceRequestId: string | null;
};

function normalizePrefix(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

function getPostcodeOutOfArea(postcode: string | null, allowedPrefixes: string[]): boolean {
  if (!postcode) {
    return false;
  }
  if (allowedPrefixes.length === 0) {
    return false;
  }

  const normalizedPostcode = normalizePrefix(postcode);
  const prefixes = allowedPrefixes.map(normalizePrefix);
  return !prefixes.some((prefix) => normalizedPostcode.startsWith(prefix));
}

function hasSafetyRisk(text: string): boolean {
  return /\b(gas leak|smell gas|fire|sparks|carbon monoxide|co alarm|electrical burning|flood|smoke)\b/i.test(text);
}

function summarizeInboundForOwner(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= 140) {
    return compact;
  }
  return `${compact.slice(0, 137)}...`;
}

async function cancelJobsForConversation(ref: ConversationRef): Promise<void> {
  if (!ref.leadId && !ref.maintenanceRequestId) {
    return;
  }

  await db.job.updateMany({
    where: {
      status: JobStatus.PENDING,
      OR: [
        ref.leadId ? { leadId: ref.leadId } : undefined,
        ref.maintenanceRequestId ? { maintenanceRequestId: ref.maintenanceRequestId } : undefined
      ].filter(Boolean) as Array<{ leadId?: string; maintenanceRequestId?: string }>
    },
    data: {
      status: JobStatus.CANCELED,
      canceledAt: new Date()
    }
  });
}

async function sendCustomerMessage(
  tenant: Tenant,
  toPhone: string,
  body: string,
  ref: ConversationRef
): Promise<void> {
  const outboundBody = body.trim();
  if (!outboundBody) {
    return;
  }

  const sendResult = await sendSms({
    from: tenant.twilioPhoneNumber,
    to: toPhone,
    body: outboundBody
  });

  await db.message.create({
    data: {
      tenantId: tenant.id,
      direction: MessageDirection.OUTBOUND,
      fromPhone: tenant.twilioPhoneNumber,
      toPhone,
      body: outboundBody,
      twilioMessageSid: sendResult.sid,
      leadId: ref.leadId,
      maintenanceRequestId: ref.maintenanceRequestId
    }
  });
}

async function sendOwnerNotification(
  tenant: Tenant,
  body: string,
  ref: ConversationRef
): Promise<void> {
  const outboundBody = body.trim();
  if (!outboundBody) {
    return;
  }

  const sendResult = await sendSms({
    from: tenant.twilioPhoneNumber,
    to: tenant.ownerNotificationPhoneNumber,
    body: outboundBody
  });

  await db.message.create({
    data: {
      tenantId: tenant.id,
      direction: MessageDirection.OUTBOUND,
      fromPhone: tenant.twilioPhoneNumber,
      toPhone: tenant.ownerNotificationPhoneNumber,
      body: outboundBody,
      twilioMessageSid: sendResult.sid,
      leadId: ref.leadId,
      maintenanceRequestId: ref.maintenanceRequestId
    }
  });
}

async function logInboundMessage(
  tenant: Tenant,
  fromPhone: string,
  toPhone: string,
  body: string,
  twilioMessageSid: string | undefined,
  ref: ConversationRef
): Promise<void> {
  await db.message.create({
    data: {
      tenantId: tenant.id,
      direction: MessageDirection.INBOUND,
      fromPhone,
      toPhone,
      body,
      twilioMessageSid,
      leadId: ref.leadId,
      maintenanceRequestId: ref.maintenanceRequestId
    }
  });
}

async function findActiveLead(tenantId: string, callerPhone: string): Promise<Lead | null> {
  return db.lead.findFirst({
    where: {
      tenantId,
      callerPhone,
      status: {
        in: [LeadStatus.OPEN, LeadStatus.QUALIFIED]
      }
    },
    orderBy: { createdAt: "desc" }
  });
}

async function findActiveMaintenance(tenantId: string, callerPhone: string): Promise<MaintenanceRequest | null> {
  return db.maintenanceRequest.findFirst({
    where: {
      tenantId,
      callerPhone,
      status: {
        in: [MaintenanceStatus.OPEN, MaintenanceStatus.LOGGED, MaintenanceStatus.IN_PROGRESS]
      }
    },
    orderBy: { createdAt: "desc" }
  });
}

function intentFromIncoming(lead: Lead, extractedIntent: LeadIntent): LeadIntent {
  if (lead.intent !== LeadIntent.UNKNOWN) {
    return lead.intent;
  }
  return extractedIntent;
}

async function convertLeadToMaintenance(lead: Lead): Promise<MaintenanceRequest> {
  const existing = await db.maintenanceRequest.findFirst({
    where: {
      tenantId: lead.tenantId,
      callerPhone: lead.callerPhone,
      status: {
        in: [MaintenanceStatus.OPEN, MaintenanceStatus.LOGGED, MaintenanceStatus.IN_PROGRESS]
      }
    },
    orderBy: { createdAt: "desc" }
  });

  if (existing) {
    return existing;
  }

  const request = await db.maintenanceRequest.create({
    data: {
      tenantId: lead.tenantId,
      callerPhone: lead.callerPhone,
      sourceCallSid: lead.sourceCallSid,
      status: MaintenanceStatus.OPEN,
      flowStep: 1
    }
  });

  await db.lead.update({
    where: { id: lead.id },
    data: {
      intent: LeadIntent.MAINTENANCE,
      status: LeadStatus.CLOSED,
      notes: "Converted to maintenance flow"
    }
  });

  return request;
}

async function processStopFlow(input: {
  tenant: Tenant;
  fromPhone: string;
  toPhone: string;
  body: string;
  twilioMessageSid?: string;
  lead: Lead | null;
  maintenance: MaintenanceRequest | null;
}): Promise<void> {
  const ref: ConversationRef = {
    leadId: input.lead?.id ?? null,
    maintenanceRequestId: input.maintenance?.id ?? null
  };

  await logInboundMessage(input.tenant, input.fromPhone, input.toPhone, input.body, input.twilioMessageSid, ref);

  await db.optOut.upsert({
    where: {
      tenantId_phone: {
        tenantId: input.tenant.id,
        phone: input.fromPhone
      }
    },
    update: {
      active: true,
      reason: "STOP message"
    },
    create: {
      tenantId: input.tenant.id,
      phone: input.fromPhone,
      active: true,
      reason: "STOP message"
    }
  });

  if (input.lead) {
    await db.lead.update({
      where: { id: input.lead.id },
      data: { status: LeadStatus.OPTED_OUT }
    });
  }

  if (input.maintenance) {
    await db.maintenanceRequest.update({
      where: { id: input.maintenance.id },
      data: { status: MaintenanceStatus.OPTED_OUT }
    });
  }

  await cancelJobsForConversation(ref);

  await sendCustomerMessage(input.tenant, input.fromPhone, getMessageTemplate(input.tenant, "optOutConfirm"), ref);
}

async function processOutOfArea(input: {
  tenant: Tenant;
  fromPhone: string;
  leadId: string | null;
  maintenanceRequestId: string | null;
}): Promise<void> {
  const ref: ConversationRef = {
    leadId: input.leadId,
    maintenanceRequestId: input.maintenanceRequestId
  };

  if (input.leadId) {
    await db.lead.update({
      where: { id: input.leadId },
      data: { status: LeadStatus.OUT_OF_AREA }
    });
  }

  if (input.maintenanceRequestId) {
    await db.maintenanceRequest.update({
      where: { id: input.maintenanceRequestId },
      data: { status: MaintenanceStatus.OUT_OF_AREA }
    });
  }

  await cancelJobsForConversation(ref);
  await sendCustomerMessage(input.tenant, input.fromPhone, getMessageTemplate(input.tenant, "outOfArea"), ref);
}

async function processCalmHandoff(input: {
  tenant: Tenant;
  fromPhone: string;
  lead: Lead | null;
  maintenance: MaintenanceRequest | null;
  inboundBody: string;
}): Promise<void> {
  const ref: ConversationRef = {
    leadId: input.lead?.id ?? null,
    maintenanceRequestId: input.maintenance?.id ?? null
  };

  if (input.lead) {
    await db.lead.update({
      where: { id: input.lead.id },
      data: {
        status: LeadStatus.NEEDS_HUMAN
      }
    });
  }

  if (input.maintenance) {
    await db.maintenanceRequest.update({
      where: { id: input.maintenance.id },
      data: {
        status: MaintenanceStatus.NEEDS_HUMAN,
        needsHuman: true
      }
    });
  }

  await cancelJobsForConversation(ref);

  await sendCustomerMessage(input.tenant, input.fromPhone, getMessageTemplate(input.tenant, "calmDeescalation"), ref);

  const ownerBody = `Calm-mode handoff required for ${input.fromPhone}. Last message: "${summarizeInboundForOwner(input.inboundBody)}"`;
  await sendOwnerNotification(input.tenant, ownerBody, ref);
}

async function processViewingFlow(input: {
  tenant: Tenant;
  lead: Lead;
  fromPhone: string;
  body: string;
  extraction: Awaited<ReturnType<typeof extractSmsSignals>>;
}): Promise<void> {
  const { tenant, lead, fromPhone, body, extraction } = input;
  const ref: ConversationRef = { leadId: lead.id, maintenanceRequestId: null };
  const step = lead.flowStep || 1;

  if (step <= 1) {
    if (extraction.name) {
      await db.lead.update({
        where: { id: lead.id },
        data: {
          name: extraction.name,
          flowStep: 2
        }
      });
      await sendCustomerMessage(tenant, fromPhone, getMessageTemplate(tenant, "viewingAskArea"), ref);
      return;
    }

    await sendCustomerMessage(tenant, fromPhone, getMessageTemplate(tenant, "viewingAskName"), ref);
    return;
  }

  if (step === 2) {
    const outOfArea = getPostcodeOutOfArea(extraction.postcode, tenant.allowedPostcodePrefixes);
    if (outOfArea) {
      await processOutOfArea({
        tenant,
        fromPhone,
        leadId: lead.id,
        maintenanceRequestId: null
      });
      return;
    }

    const areaOrProperty = extraction.areaOrProperty ?? body.trim();
    if (!areaOrProperty && !extraction.postcode) {
      await sendCustomerMessage(tenant, fromPhone, getMessageTemplate(tenant, "viewingAskArea"), ref);
      return;
    }

    await db.lead.update({
      where: { id: lead.id },
      data: {
        desiredArea: extraction.postcode ? null : areaOrProperty,
        postcode: extraction.postcode ?? lead.postcode,
        propertyQuery: areaOrProperty,
        flowStep: 3
      }
    });
    await sendCustomerMessage(tenant, fromPhone, getMessageTemplate(tenant, "viewingAskRequirements"), ref);
    return;
  }

  if (step === 3) {
    const requirements = body.trim();
    if (!requirements) {
      await sendCustomerMessage(tenant, fromPhone, getMessageTemplate(tenant, "viewingAskRequirements"), ref);
      return;
    }

    await db.lead.update({
      where: { id: lead.id },
      data: {
        requirements,
        flowStep: 4
      }
    });
    await sendCustomerMessage(tenant, fromPhone, getMessageTemplate(tenant, "viewingAskBooking"), ref);
    return;
  }

  const wantsBooking = /\b(book|booking|schedule|link|slot)\b/i.test(body);
  const hasCallback = Boolean(extraction.callbackText) || /\b(call|callback|ring|tomorrow|am|pm)\b/i.test(body);

  if (wantsBooking && tenant.bookingUrlViewings) {
    await db.lead.update({
      where: { id: lead.id },
      data: {
        status: LeadStatus.SCHEDULED,
        flowStep: 5
      }
    });
    await cancelJobsForConversation(ref);
    await sendCustomerMessage(
      tenant,
      fromPhone,
      getMessageTemplate(tenant, "viewingBookingLink", {
        bookingUrlViewings: tenant.bookingUrlViewings ?? ""
      }),
      ref
    );
    await sendOwnerNotification(
      tenant,
      `Viewing lead scheduled: ${lead.name ?? "Unknown name"} (${fromPhone})`,
      ref
    );
    return;
  }

  if (hasCallback) {
    await db.lead.update({
      where: { id: lead.id },
      data: {
        status: LeadStatus.QUALIFIED,
        flowStep: 5,
        notes: extraction.callbackText ?? body
      }
    });
    await sendCustomerMessage(
      tenant,
      fromPhone,
      getMessageTemplate(tenant, "viewingQualified", {
        name: lead.name ?? "there"
      }),
      ref
    );
    await sendOwnerNotification(
      tenant,
      `Viewing lead qualified: ${lead.name ?? "Unknown name"} (${fromPhone}). Callback requested: ${extraction.callbackText ?? body}`,
      ref
    );
    return;
  }

  await sendCustomerMessage(tenant, fromPhone, getMessageTemplate(tenant, "viewingAskBooking"), ref);
}

async function processGeneralFlow(input: {
  tenant: Tenant;
  lead: Lead;
  fromPhone: string;
  body: string;
  extraction: Awaited<ReturnType<typeof extractSmsSignals>>;
}): Promise<void> {
  const { tenant, lead, fromPhone, body, extraction } = input;
  const ref: ConversationRef = { leadId: lead.id, maintenanceRequestId: null };
  const step = lead.flowStep || 1;

  if (step <= 1) {
    if (extraction.name) {
      await db.lead.update({
        where: { id: lead.id },
        data: {
          name: extraction.name,
          flowStep: 2
        }
      });
      await sendCustomerMessage(tenant, fromPhone, getMessageTemplate(tenant, "generalAskTopic"), ref);
      return;
    }

    await sendCustomerMessage(tenant, fromPhone, getMessageTemplate(tenant, "generalAskName"), ref);
    return;
  }

  if (step === 2) {
    const topic = body.trim();
    if (!topic) {
      await sendCustomerMessage(tenant, fromPhone, getMessageTemplate(tenant, "generalAskTopic"), ref);
      return;
    }

    await db.lead.update({
      where: { id: lead.id },
      data: {
        notes: topic,
        flowStep: 3
      }
    });
    await sendCustomerMessage(tenant, fromPhone, getMessageTemplate(tenant, "generalAskCallback"), ref);
    return;
  }

  if (!extraction.callbackText && !/\b(call|callback|ring|am|pm|tomorrow|today)\b/i.test(body)) {
    await sendCustomerMessage(tenant, fromPhone, getMessageTemplate(tenant, "generalAskCallback"), ref);
    return;
  }

  await db.lead.update({
    where: { id: lead.id },
    data: {
      status: LeadStatus.QUALIFIED,
      flowStep: 4,
      notes: `${lead.notes ?? ""}\nCallback: ${extraction.callbackText ?? body}`.trim()
    }
  });

  await sendCustomerMessage(
    tenant,
    fromPhone,
    getMessageTemplate(tenant, "generalQualified", { name: lead.name ?? "there" }),
    ref
  );

  await sendOwnerNotification(
    tenant,
    `General enquiry qualified: ${lead.name ?? "Unknown name"} (${fromPhone}). Callback: ${extraction.callbackText ?? body}`,
    ref
  );
}

async function processMaintenanceFlow(input: {
  tenant: Tenant;
  request: MaintenanceRequest;
  fromPhone: string;
  body: string;
  extraction: Awaited<ReturnType<typeof extractSmsSignals>>;
}): Promise<void> {
  const { tenant, request, fromPhone, body, extraction } = input;
  const ref: ConversationRef = { leadId: null, maintenanceRequestId: request.id };
  const step = request.flowStep || 1;
  const safety = extraction.safetyRisk || hasSafetyRisk(body);

  if (safety) {
    await db.maintenanceRequest.update({
      where: { id: request.id },
      data: {
        status: MaintenanceStatus.NEEDS_HUMAN,
        needsHuman: true,
        severity: "EMERGENCY",
        issueDescription: request.issueDescription ?? body
      }
    });
    await cancelJobsForConversation(ref);
    await sendCustomerMessage(tenant, fromPhone, getMessageTemplate(tenant, "emergencySafety"), ref);
    await sendOwnerNotification(
      tenant,
      `Emergency maintenance handoff: ${request.name ?? "Unknown name"} (${fromPhone}).`,
      ref
    );
    return;
  }

  if (step <= 1) {
    if (extraction.name) {
      await db.maintenanceRequest.update({
        where: { id: request.id },
        data: {
          name: extraction.name,
          flowStep: 2
        }
      });
      await sendCustomerMessage(tenant, fromPhone, getMessageTemplate(tenant, "maintenanceAskAddress"), ref);
      return;
    }

    await sendCustomerMessage(tenant, fromPhone, getMessageTemplate(tenant, "maintenanceAskName"), ref);
    return;
  }

  if (step === 2) {
    const outOfArea = getPostcodeOutOfArea(extraction.postcode, tenant.allowedPostcodePrefixes);
    if (outOfArea) {
      await processOutOfArea({
        tenant,
        fromPhone,
        leadId: null,
        maintenanceRequestId: request.id
      });
      return;
    }

    const address = extraction.areaOrProperty ?? body.trim();
    if (!address && !extraction.postcode) {
      await sendCustomerMessage(tenant, fromPhone, getMessageTemplate(tenant, "maintenanceAskAddress"), ref);
      return;
    }

    await db.maintenanceRequest.update({
      where: { id: request.id },
      data: {
        propertyAddress: address || request.propertyAddress,
        postcode: extraction.postcode ?? request.postcode,
        flowStep: 3
      }
    });
    await sendCustomerMessage(tenant, fromPhone, getMessageTemplate(tenant, "maintenanceAskIssue"), ref);
    return;
  }

  if (step === 3) {
    const issue = extraction.issueDescription ?? body.trim();
    if (!issue) {
      await sendCustomerMessage(tenant, fromPhone, getMessageTemplate(tenant, "maintenanceAskIssue"), ref);
      return;
    }

    await db.maintenanceRequest.update({
      where: { id: request.id },
      data: {
        issueDescription: issue,
        flowStep: 4
      }
    });
    await sendCustomerMessage(tenant, fromPhone, getMessageTemplate(tenant, "maintenanceAskSeverity"), ref);
    return;
  }

  if (!extraction.severity) {
    await sendCustomerMessage(tenant, fromPhone, getMessageTemplate(tenant, "maintenanceAskSeverity"), ref);
    return;
  }

  await db.maintenanceRequest.update({
    where: { id: request.id },
    data: {
      severity: extraction.severity,
      status: MaintenanceStatus.LOGGED,
      flowStep: 5
    }
  });

  await sendCustomerMessage(
    tenant,
    fromPhone,
    getMessageTemplate(tenant, "maintenanceLogged", { name: request.name ?? "there" }),
    ref
  );

  await sendOwnerNotification(
    tenant,
    `Maintenance logged (${extraction.severity}): ${request.name ?? "Unknown name"} (${fromPhone}).`,
    ref
  );
}

function coerceLeadIntent(intent: string): LeadIntent {
  if (intent === "VIEWING") {
    return LeadIntent.VIEWING;
  }
  if (intent === "MAINTENANCE") {
    return LeadIntent.MAINTENANCE;
  }
  if (intent === "GENERAL") {
    return LeadIntent.GENERAL;
  }
  return LeadIntent.UNKNOWN;
}

async function ensureLeadConversation(tenantId: string, callerPhone: string): Promise<Lead> {
  const existing = await findActiveLead(tenantId, callerPhone);
  if (existing) {
    return existing;
  }

  return db.lead.create({
    data: {
      tenantId,
      callerPhone,
      status: LeadStatus.OPEN,
      intent: LeadIntent.UNKNOWN,
      flowStep: 0
    }
  });
}

async function processIntentSelection(input: {
  tenant: Tenant;
  lead: Lead;
  fromPhone: string;
  extractedIntent: LeadIntent;
}): Promise<Lead | null> {
  const { tenant, lead, fromPhone, extractedIntent } = input;
  const ref: ConversationRef = { leadId: lead.id, maintenanceRequestId: null };

  if (extractedIntent === LeadIntent.UNKNOWN) {
    await sendCustomerMessage(tenant, fromPhone, getMessageTemplate(tenant, "missedCallTriage"), ref);
    return lead;
  }

  if (extractedIntent === LeadIntent.VIEWING) {
    await db.lead.update({
      where: { id: lead.id },
      data: {
        intent: LeadIntent.VIEWING,
        flowStep: 1
      }
    });
    await sendCustomerMessage(tenant, fromPhone, getMessageTemplate(tenant, "viewingAskName"), ref);
    return await db.lead.findUnique({ where: { id: lead.id } });
  }

  if (extractedIntent === LeadIntent.GENERAL) {
    await db.lead.update({
      where: { id: lead.id },
      data: {
        intent: LeadIntent.GENERAL,
        flowStep: 1
      }
    });
    await sendCustomerMessage(tenant, fromPhone, getMessageTemplate(tenant, "generalAskName"), ref);
    return await db.lead.findUnique({ where: { id: lead.id } });
  }

  await db.lead.update({
    where: { id: lead.id },
    data: {
      intent: LeadIntent.MAINTENANCE
    }
  });

  const request = await convertLeadToMaintenance(lead);
  const maintenanceRef: ConversationRef = { leadId: null, maintenanceRequestId: request.id };
  await sendCustomerMessage(tenant, fromPhone, getMessageTemplate(tenant, "maintenanceAskName"), maintenanceRef);
  return null;
}

export async function handleInboundSms(input: SmsInboundInput): Promise<void> {
  const { tenant, fromPhone, toPhone, body, twilioMessageSid } = input;
  const trimmedBody = body.trim();
  if (!trimmedBody) {
    return;
  }

  const extraction = await extractSmsSignals(trimmedBody);
  const lead = await findActiveLead(tenant.id, fromPhone);
  const maintenance = await findActiveMaintenance(tenant.id, fromPhone);

  if (extraction.stop) {
    await processStopFlow({
      tenant,
      fromPhone,
      toPhone,
      body: trimmedBody,
      twilioMessageSid,
      lead,
      maintenance
    });
    return;
  }

  const optOut = await db.optOut.findUnique({
    where: {
      tenantId_phone: {
        tenantId: tenant.id,
        phone: fromPhone
      }
    }
  });

  if (optOut?.active) {
    await logInboundMessage(
      tenant,
      fromPhone,
      toPhone,
      trimmedBody,
      twilioMessageSid,
      { leadId: lead?.id ?? null, maintenanceRequestId: maintenance?.id ?? null }
    );
    return;
  }

  const currentMaintenance = maintenance;
  let currentLead = lead;

  if (!currentMaintenance && !currentLead) {
    currentLead = await ensureLeadConversation(tenant.id, fromPhone);
  }

  if (currentMaintenance) {
    await logInboundMessage(
      tenant,
      fromPhone,
      toPhone,
      trimmedBody,
      twilioMessageSid,
      { leadId: null, maintenanceRequestId: currentMaintenance.id }
    );

    const maintenanceSafety = extraction.safetyRisk || hasSafetyRisk(trimmedBody);
    if (extraction.angerSignals && !maintenanceSafety) {
      await processCalmHandoff({
        tenant,
        fromPhone,
        lead: null,
        maintenance: currentMaintenance,
        inboundBody: trimmedBody
      });
      return;
    }

    await processMaintenanceFlow({
      tenant,
      request: currentMaintenance,
      fromPhone,
      body: trimmedBody,
      extraction
    });
    return;
  }

  if (!currentLead) {
    return;
  }

  const intent = intentFromIncoming(currentLead, coerceLeadIntent(extraction.intent));
  const leadRef: ConversationRef = { leadId: currentLead.id, maintenanceRequestId: null };
  await logInboundMessage(tenant, fromPhone, toPhone, trimmedBody, twilioMessageSid, leadRef);

  if (extraction.angerSignals) {
    await processCalmHandoff({
      tenant,
      fromPhone,
      lead: currentLead,
      maintenance: null,
      inboundBody: trimmedBody
    });
    return;
  }

  if (currentLead.intent === LeadIntent.UNKNOWN) {
    await processIntentSelection({
      tenant,
      lead: currentLead,
      fromPhone,
      extractedIntent: intent
    });
    return;
  }

  if (intent === LeadIntent.MAINTENANCE) {
    const request = await convertLeadToMaintenance(currentLead);
    await processMaintenanceFlow({
      tenant,
      request,
      fromPhone,
      body: trimmedBody,
      extraction
    });
    return;
  }

  if (intent === LeadIntent.VIEWING) {
    await processViewingFlow({
      tenant,
      lead: currentLead,
      fromPhone,
      body: trimmedBody,
      extraction
    });
    return;
  }

  await processGeneralFlow({
    tenant,
    lead: currentLead,
    fromPhone,
    body: trimmedBody,
    extraction
  });
}
