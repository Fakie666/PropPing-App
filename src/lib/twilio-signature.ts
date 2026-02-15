import { createHmac, timingSafeEqual } from "node:crypto";

type TwilioVerifyInput = {
  authToken: string | undefined;
  url: string;
  signatureHeader: string | null;
  params: Record<string, string>;
};

function computeExpectedSignature(authToken: string, url: string, params: Record<string, string>): string {
  const sortedKeys = Object.keys(params).sort((a, b) => a.localeCompare(b));
  const payload = sortedKeys.reduce((acc, key) => `${acc}${key}${params[key]}`, url);
  return createHmac("sha1", authToken).update(payload).digest("base64");
}

export function verifyTwilioSignature(input: TwilioVerifyInput): boolean {
  const authToken = input.authToken?.trim();
  const signature = input.signatureHeader?.trim();

  if (!authToken) {
    return process.env.NODE_ENV !== "production";
  }

  if (!signature) {
    return false;
  }

  const expected = computeExpectedSignature(authToken, input.url, input.params);
  const providedBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}
