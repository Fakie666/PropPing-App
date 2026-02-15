import { findTenantByTwilioNumber } from "@/lib/tenant";
import { buildDialForwardTwiml, buildEmptyTwiml } from "@/lib/twiml";
import { resolveWebhookPathUrl } from "@/lib/webhook-url";

export async function POST(request: Request) {
  const formData = await request.formData();
  const toPhone = String(formData.get("To") ?? "");

  const tenant = await findTenantByTwilioNumber(toPhone);
  const xml = tenant
    ? buildDialForwardTwiml({
        forwardToPhoneNumber: tenant.forwardToPhoneNumber,
        statusCallbackUrl: resolveWebhookPathUrl(request, "/api/twilio/voice/dial-status"),
        timeoutSeconds: 20
      })
    : buildEmptyTwiml();

  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "text/xml; charset=utf-8"
    }
  });
}
