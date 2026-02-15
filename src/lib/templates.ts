import type { Tenant } from "@prisma/client";

const DEFAULT_TEMPLATES: Record<string, string> = {
  missedCallTriage:
    "Sorry we missed your call - are you contacting us about: 1) Renting/viewing a property 2) A repair/maintenance issue 3) Something else. Reply 1, 2, or 3.",
  optOutConfirm: "You are now opted out and will not receive further automated messages from us.",
  outOfArea:
    "Thanks for your message. It looks like this postcode is outside our current area. We have marked this as out-of-area.",
  viewingAskName: "Thanks for your interest. Can I take your full name?",
  viewingAskArea:
    "Please share your desired area/postcode, or the property reference/address you are enquiring about.",
  viewingAskRequirements: "Please share brief requirements (beds and budget are helpful but optional).",
  viewingAskBooking:
    "Would you like to book directly online, or prefer a callback time? Reply with BOOK or share a callback time.",
  viewingBookingLink: "Please book your viewing here: {{bookingUrlViewings}}",
  viewingQualified:
    "Thanks {{name}}. We have logged your details and a colleague will contact you to confirm next steps.",
  generalAskName: "Thanks for contacting us. Can I take your full name?",
  generalAskTopic: "Please share what this is about in one or two lines.",
  generalAskCallback: "Please share the best callback time for you.",
  generalQualified:
    "Thanks {{name}}. We have logged this and a colleague will get back to you at the requested time.",
  maintenanceAskName: "Thanks for reporting this. Can I take your full name?",
  maintenanceAskAddress: "Please share the property address or postcode.",
  maintenanceAskIssue: "Please describe the issue briefly.",
  maintenanceAskSeverity: "How severe is this issue? Reply ROUTINE, URGENT, or EMERGENCY.",
  maintenanceLogged:
    "Thanks {{name}}. We have logged your maintenance request and will follow up shortly.",
  leadFollowUpFirst:
    "Just checking in on your enquiry. Reply 1, 2, or 3 so we can route this quickly.",
  leadFollowUpSecond:
    "We are still here to help with your enquiry. Reply with details and we will follow up as soon as possible.",
  emergencySafety:
    "This sounds safety-critical. Please call emergency services if there is immediate danger. A human team member is taking over now.",
  calmDeescalation:
    "Thanks for raising this. We are sorry for the frustration. A human colleague will review and contact you within one business day."
};

function readTemplateOverrides(tenant: Tenant): Record<string, string> {
  const source = tenant.messageTemplatesJson;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return {};
  }

  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim().length > 0) {
      output[key] = value;
    }
  }
  return output;
}

function renderTemplate(template: string, variables?: Record<string, string | undefined>): string {
  if (!variables) {
    return template;
  }

  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => variables[key] ?? "");
}

export function getMessageTemplate(
  tenant: Tenant,
  key: string,
  variables?: Record<string, string | undefined>
): string {
  const overrides = readTemplateOverrides(tenant);
  const template = overrides[key] ?? DEFAULT_TEMPLATES[key] ?? "";
  return renderTemplate(template, variables).trim();
}
