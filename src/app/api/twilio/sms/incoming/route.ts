import { findTenantByTwilioNumber, normalizePhone } from "@/lib/tenant";
import { verifyTwilioSignature } from "@/lib/twilio-signature";
import { buildEmptyTwiml } from "@/lib/twiml";
import { handleInboundSms } from "@/lib/sms";
import { resolveWebhookRequestUrl } from "@/lib/webhook-url";

function parseTwilioFormBody(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body).entries());
}

function xmlResponse(status = 200): Response {
  return new Response(buildEmptyTwiml(), {
    status,
    headers: {
      "Content-Type": "text/xml; charset=utf-8"
    }
  });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const params = parseTwilioFormBody(rawBody);

  const validSignature = verifyTwilioSignature({
    authToken: process.env.TWILIO_AUTH_TOKEN,
    url: resolveWebhookRequestUrl(request),
    signatureHeader: request.headers.get("x-twilio-signature"),
    params
  });

  if (!validSignature) {
    return xmlResponse(403);
  }

  const toPhone = normalizePhone(params.To ?? "");
  const fromPhone = normalizePhone(params.From ?? "");
  const body = params.Body ?? "";
  const messageSid = params.MessageSid ?? params.SmsSid;

  if (!toPhone || !fromPhone || !body.trim()) {
    return xmlResponse(400);
  }

  const tenant = await findTenantByTwilioNumber(toPhone);
  if (!tenant) {
    return xmlResponse();
  }

  await handleInboundSms({
    tenant,
    fromPhone,
    toPhone,
    body,
    twilioMessageSid: messageSid
  });

  return xmlResponse();
}
