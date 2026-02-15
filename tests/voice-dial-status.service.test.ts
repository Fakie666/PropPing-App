import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobType, LeadIntent, LeadStatus, MessageDirection } from "@prisma/client";

type TestCall = {
  id: string;
  tenantId: string;
  callerPhone: string;
  toPhone: string;
  twilioCallSid?: string;
  dialStatus?: string;
  outcome: string;
  answered: boolean;
  createdAt: Date;
};

const { state, dbMock, sendSmsMock } = vi.hoisted(() => {
  const state = {
    tenant: null as Record<string, unknown> | null,
    calls: [] as TestCall[],
    leads: [] as Array<Record<string, unknown>>,
    messages: [] as Array<Record<string, unknown>>,
    jobs: [] as Array<Record<string, unknown>>,
    sidCounter: 0
  };

  const dbMock = {
    tenant: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (state.tenant && state.tenant.id === where.id) {
          return state.tenant;
        }
        return null;
      })
    },
    call: {
      upsert: vi.fn(async ({ where, update, create }: { where: { twilioCallSid: string }; update: any; create: any }) => {
        const existing = state.calls.find((row) => row.twilioCallSid === where.twilioCallSid);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }

        const created: TestCall = {
          id: `call_${state.calls.length + 1}`,
          ...create,
          createdAt: new Date()
        };
        state.calls.push(created);
        return created;
      }),
      create: vi.fn(async ({ data }: { data: any }) => {
        const created: TestCall = {
          id: `call_${state.calls.length + 1}`,
          ...data,
          createdAt: new Date()
        };
        state.calls.push(created);
        return created;
      })
    },
    lead: {
      create: vi.fn(async ({ data }: { data: any }) => {
        const created = {
          id: `lead_${state.leads.length + 1}`,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        state.leads.push(created);
        return created;
      })
    },
    message: {
      create: vi.fn(async ({ data }: { data: any }) => {
        const created = {
          id: `msg_${state.messages.length + 1}`,
          ...data,
          createdAt: new Date()
        };
        state.messages.push(created);
        return created;
      })
    },
    job: {
      createMany: vi.fn(async ({ data }: { data: any[] }) => {
        for (const row of data) {
          state.jobs.push({
            id: `job_${state.jobs.length + 1}`,
            ...row,
            createdAt: new Date(),
            updatedAt: new Date()
          });
        }
        return { count: data.length };
      })
    }
  };

  const sendSmsMock = vi.fn(async () => {
    state.sidCounter += 1;
    return {
      sid: `SM_TEST_${state.sidCounter}`,
      provider: "mock" as const
    };
  });

  return { state, dbMock, sendSmsMock };
});

vi.mock("@/lib/db", () => ({
  db: dbMock
}));

vi.mock("@/lib/twilio-client", () => ({
  sendSms: sendSmsMock
}));

import { handleVoiceDialStatus } from "@/lib/voice";

describe("handleVoiceDialStatus", () => {
  beforeEach(() => {
    state.tenant = {
      id: "tenant_1",
      name: "PropPing Demo",
      twilioPhoneNumber: "+442071234567",
      ownerNotificationPhoneNumber: "+447700900999",
      timezone: "Europe/London",
      messageTemplatesJson: {}
    };
    state.calls = [];
    state.leads = [];
    state.messages = [];
    state.jobs = [];
    state.sidCounter = 0;
    sendSmsMock.mockClear();
  });

  it("no-answer starts triage, sends customer+owner SMS, and schedules follow-ups", async () => {
    const result = await handleVoiceDialStatus({
      tenantId: "tenant_1",
      fromPhone: "+447700900111",
      toPhone: "+442071234567",
      twilioCallSid: "CA_TEST_1",
      dialStatus: "no-answer"
    });

    expect(result.triageStarted).toBe(true);
    expect(result.leadId).toBeTruthy();

    expect(state.calls).toHaveLength(1);
    expect(state.leads).toHaveLength(1);
    expect((state.leads[0] as { status: LeadStatus }).status).toBe(LeadStatus.OPEN);
    expect((state.leads[0] as { intent: LeadIntent }).intent).toBe(LeadIntent.UNKNOWN);

    expect(sendSmsMock).toHaveBeenCalledTimes(2);
    expect(sendSmsMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        from: "+442071234567",
        to: "+447700900111"
      })
    );
    expect(sendSmsMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        from: "+442071234567",
        to: "+447700900999"
      })
    );

    expect(state.messages).toHaveLength(2);
    expect((state.messages[0] as { direction: MessageDirection }).direction).toBe(MessageDirection.OUTBOUND);
    expect((state.messages[1] as { direction: MessageDirection }).direction).toBe(MessageDirection.OUTBOUND);

    expect(state.jobs).toHaveLength(2);
    expect((state.jobs[0] as { type: JobType }).type).toBe(JobType.LEAD_FOLLOW_UP);
    expect((state.jobs[1] as { type: JobType }).type).toBe(JobType.LEAD_FOLLOW_UP);
  });
});
