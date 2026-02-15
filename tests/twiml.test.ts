import { describe, expect, it } from "vitest";
import { buildDialForwardTwiml } from "@/lib/twiml";

describe("buildDialForwardTwiml", () => {
  it("returns Dial TwiML with timeout and action URL", () => {
    const xml = buildDialForwardTwiml({
      forwardToPhoneNumber: "+447700900111",
      statusCallbackUrl: "https://example.ngrok.app/api/twilio/voice/dial-status",
      timeoutSeconds: 20
    });

    expect(xml).toContain("<Response>");
    expect(xml).toContain('<Dial timeout="20"');
    expect(xml).toContain('action="https://example.ngrok.app/api/twilio/voice/dial-status"');
    expect(xml).toContain("<Number>+447700900111</Number>");
  });
});
