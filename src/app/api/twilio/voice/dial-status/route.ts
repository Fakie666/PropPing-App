import { findTenantByTwilioNumber, normalizePhone } from "@/lib/tenant";
import { verifyTwilioSignature } from "@/lib/twilio-signature";
import { buildEmptyTwiml } from "@/lib/twiml";
import { handleVoiceDialStatus } from "@/lib/voice";
import { resolveWebhookRequestUrl } from "@/lib/webhook-url";

function parseTwilioFormBody(body: string): Record<string, string> {
  const entries = new URLSearchParams(body).entries();
  return Object.fromEntries(entries);
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

  const signatureHeader = request.headers.get("x-twilio-signature");
  const validSignature = verifyTwilioSignature({
    authToken: process.env.TWILIO_AUTH_TOKEN,
    url: resolveWebhookRequestUrl(request),
    signatureHeader,
    params
  });

  if (!validSignature) {
    return xmlResponse(403);
  }

  const toPhone = normalizePhone(params.To ?? "");
  const fromPhone = normalizePhone(params.From ?? "");
  const twilioCallSid = params.CallSid;
  const dialStatus = params.DialCallStatus ?? params.CallStatus;

  if (!toPhone || !fromPhone) {
    return xmlResponse(400);
  }

  const tenant = await findTenantByTwilioNumber(toPhone);
  if (!tenant) {
    return xmlResponse();
  }

  await handleVoiceDialStatus({
    tenantId: tenant.id,
    fromPhone,
    toPhone,
    twilioCallSid,
    dialStatus
  });

  return xmlResponse();
}
