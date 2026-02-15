import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

export type SessionPayload = {
  userId: string;
  tenantId: string;
  iat: number;
  exp: number;
};

type SessionInput = {
  userId: string;
  tenantId: string;
};

function signPayload(payloadPart: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadPart).digest("base64url");
}

export function createSessionToken(
  input: SessionInput,
  secret: string,
  nowInSeconds: number = Math.floor(Date.now() / 1000)
): string {
  const payload: SessionPayload = {
    userId: input.userId,
    tenantId: input.tenantId,
    iat: nowInSeconds,
    exp: nowInSeconds + DEFAULT_TTL_SECONDS
  };

  const payloadPart = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signaturePart = signPayload(payloadPart, secret);
  return `${payloadPart}.${signaturePart}`;
}

export function parseSessionToken(
  token: string | undefined,
  secret: string,
  nowInSeconds: number = Math.floor(Date.now() / 1000)
): SessionPayload | null {
  if (!token) {
    return null;
  }

  const [payloadPart, signaturePart] = token.split(".");
  if (!payloadPart || !signaturePart) {
    return null;
  }

  const expected = signPayload(payloadPart, secret);
  const providedBuffer = Buffer.from(signaturePart, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  if (providedBuffer.length !== expectedBuffer.length) {
    return null;
  }

  if (!timingSafeEqual(providedBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as SessionPayload;
    if (payload.exp <= nowInSeconds) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
