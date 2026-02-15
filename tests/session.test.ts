import { describe, expect, it } from "vitest";
import { createSessionToken, parseSessionToken } from "@/lib/session";

describe("session token helpers", () => {
  it("creates and parses a token", () => {
    const now = 1_700_000_000;
    const secret = "test-secret";

    const token = createSessionToken(
      {
        userId: "user_1",
        tenantId: "tenant_1"
      },
      secret,
      now
    );

    const parsed = parseSessionToken(token, secret, now + 60);
    expect(parsed).not.toBeNull();
    expect(parsed?.userId).toBe("user_1");
    expect(parsed?.tenantId).toBe("tenant_1");
  });

  it("rejects tampered token", () => {
    const token = createSessionToken({ userId: "u", tenantId: "t" }, "secret", 1_700_000_000);
    const tampered = `${token}x`;
    expect(parseSessionToken(tampered, "secret", 1_700_000_010)).toBeNull();
  });
});
