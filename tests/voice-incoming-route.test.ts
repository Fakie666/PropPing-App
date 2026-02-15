import { beforeEach, describe, expect, it, vi } from "vitest";

const { findTenantByTwilioNumberMock } = vi.hoisted(() => {
  return {
    findTenantByTwilioNumberMock: vi.fn()
  };
});

vi.mock("@/lib/tenant", () => ({
  findTenantByTwilioNumber: findTenantByTwilioNumberMock
}));

import { POST } from "@/app/api/twilio/voice/incoming/route";

describe("POST /api/twilio/voice/incoming", () => {
  beforeEach(() => {
    findTenantByTwilioNumberMock.mockReset();
  });

  it("returns TwiML Dial forwarding to tenant number", async () => {
    findTenantByTwilioNumberMock.mockResolvedValue({
      id: "tenant_1",
      forwardToPhoneNumber: "+447700900111"
    });

    const request = new Request("http://localhost:3000/api/twilio/voice/incoming", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "To=%2B442071234567&From=%2B447700900222&CallSid=CA_TEST"
    });

    const response = await POST(request);
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(xml).toContain("<Dial timeout=\"20\"");
    expect(xml).toContain("<Number>+447700900111</Number>");
    expect(xml).toContain('action="http://localhost:3000/api/twilio/voice/dial-status"');
  });
});
