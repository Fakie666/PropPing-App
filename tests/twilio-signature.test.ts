import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyTwilioSignature } from "@/lib/twilio-signature";

function buildSignature(authToken: string, url: string, params: Record<string, string>): string {
  const payload = Object.keys(params)
    .sort((a, b) => a.localeCompare(b))
    .reduce((acc, key) => `${acc}${key}${params[key]}`, url);

  return createHmac("sha1", authToken).update(payload).digest("base64");
}

describe("verifyTwilioSignature", () => {
  it("accepts valid signatures", () => {
    const authToken = "test-token";
    const url = "https://example.ngrok.app/api/twilio/voice/dial-status";
    const params = {
      CallSid: "CA123",
      DialCallStatus: "no-answer",
      From: "+447700900100",
      To: "+442071234567"
    };
    const signature = buildSignature(authToken, url, params);

    expect(
      verifyTwilioSignature({
        authToken,
        url,
        params,
        signatureHeader: signature
      })
    ).toBe(true);
  });

  it("rejects invalid signatures when auth token is provided", () => {
    expect(
      verifyTwilioSignature({
        authToken: "test-token",
        url: "https://example.ngrok.app/api/twilio/voice/dial-status",
        params: { A: "1" },
        signatureHeader: "bad-signature"
      })
    ).toBe(false);
  });
});
