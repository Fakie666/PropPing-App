import {
  JobStatus,
  LeadIntent,
  LeadStatus,
  MaintenanceStatus,
  MessageDirection,
  Severity
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

type LeadRow = {
  id: string;
  tenantId: string;
  callerPhone: string;
  sourceCallSid: string | null;
  status: LeadStatus;
  intent: LeadIntent;
  flowStep: number;
  name: string | null;
  desiredArea: string | null;
  postcode: string | null;
  propertyQuery: string | null;
  requirements: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type MaintenanceRow = {
  id: string;
  tenantId: string;
  callerPhone: string;
  sourceCallSid: string | null;
  status: MaintenanceStatus;
  flowStep: number;
  severity: Severity | null;
  name: string | null;
  propertyAddress: string | null;
  postcode: string | null;
  issueDescription: string | null;
  notes: string | null;
  needsHuman: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type JobRow = {
  id: string;
  tenantId: string;
  status: JobStatus;
  leadId: string | null;
  maintenanceRequestId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type OptOutRow = {
  id: string;
  tenantId: string;
  phone: string;
  active: boolean;
  reason: string | null;
};

type MessageRow = {
  id: string;
  tenantId: string;
  direction: MessageDirection;
  fromPhone: string;
  toPhone: string;
  body: string;
  leadId: string | null;
  maintenanceRequestId: string | null;
  createdAt: Date;
};

const { state, dbMock, sendSmsMock } = vi.hoisted(() => {
  const state = {
    leads: [] as LeadRow[],
    maintenance: [] as MaintenanceRow[],
    jobs: [] as JobRow[],
    optOuts: [] as OptOutRow[],
    messages: [] as MessageRow[],
    idCounter: 0,
    smsCounter: 0
  };

  function nextId(prefix: string): string {
    state.idCounter += 1;
    return `${prefix}_${state.idCounter}`;
  }

  function now(): Date {
    return new Date();
  }

  const dbMock = {
    lead: {
      findFirst: vi.fn(async ({ where }: { where: any }) => {
        const filtered = state.leads
          .filter((row) => row.tenantId === where.tenantId && row.callerPhone === where.callerPhone)
          .filter((row) => {
            if (!where.status?.in) {
              return true;
            }
            return where.status.in.includes(row.status);
          })
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

        return filtered[0] ?? null;
      }),
      create: vi.fn(async ({ data }: { data: any }) => {
        const created: LeadRow = {
          id: nextId("lead"),
          tenantId: data.tenantId,
          callerPhone: data.callerPhone,
          sourceCallSid: data.sourceCallSid ?? null,
          status: data.status ?? LeadStatus.OPEN,
          intent: data.intent ?? LeadIntent.UNKNOWN,
          flowStep: data.flowStep ?? 0,
          name: data.name ?? null,
          desiredArea: data.desiredArea ?? null,
          postcode: data.postcode ?? null,
          propertyQuery: data.propertyQuery ?? null,
          requirements: data.requirements ?? null,
          notes: data.notes ?? null,
          createdAt: now(),
          updatedAt: now()
        };
        state.leads.push(created);
        return created;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: any }) => {
        const target = state.leads.find((row) => row.id === where.id);
        if (!target) {
          throw new Error(`Lead not found: ${where.id}`);
        }
        Object.assign(target, data, { updatedAt: now() });
        return target;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return state.leads.find((row) => row.id === where.id) ?? null;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: any; data: any }) => {
        let count = 0;
        for (const row of state.leads) {
          const statusMatch = where.status ? row.status === where.status : true;
          if (row.id === where.id && row.tenantId === where.tenantId && statusMatch) {
            Object.assign(row, data, { updatedAt: now() });
            count += 1;
          }
        }
        return { count };
      })
    },
    maintenanceRequest: {
      findFirst: vi.fn(async ({ where }: { where: any }) => {
        const filtered = state.maintenance
          .filter((row) => row.tenantId === where.tenantId && row.callerPhone === where.callerPhone)
          .filter((row) => {
            if (!where.status?.in) {
              return true;
            }
            return where.status.in.includes(row.status);
          })
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

        return filtered[0] ?? null;
      }),
      create: vi.fn(async ({ data }: { data: any }) => {
        const created: MaintenanceRow = {
          id: nextId("maint"),
          tenantId: data.tenantId,
          callerPhone: data.callerPhone,
          sourceCallSid: data.sourceCallSid ?? null,
          status: data.status ?? MaintenanceStatus.OPEN,
          flowStep: data.flowStep ?? 0,
          severity: data.severity ?? null,
          name: data.name ?? null,
          propertyAddress: data.propertyAddress ?? null,
          postcode: data.postcode ?? null,
          issueDescription: data.issueDescription ?? null,
          notes: data.notes ?? null,
          needsHuman: data.needsHuman ?? false,
          createdAt: now(),
          updatedAt: now()
        };
        state.maintenance.push(created);
        return created;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: any }) => {
        const target = state.maintenance.find((row) => row.id === where.id);
        if (!target) {
          throw new Error(`Maintenance request not found: ${where.id}`);
        }
        Object.assign(target, data, { updatedAt: now() });
        return target;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: any; data: any }) => {
        let count = 0;
        for (const row of state.maintenance) {
          const statusMatch = where.status ? row.status === where.status : true;
          if (row.id === where.id && row.tenantId === where.tenantId && statusMatch) {
            Object.assign(row, data, { updatedAt: now() });
            count += 1;
          }
        }
        return { count };
      })
    },
    job: {
      updateMany: vi.fn(async ({ where, data }: { where: any; data: any }) => {
        const clauses: Array<{ leadId?: string; maintenanceRequestId?: string }> = where.OR ?? [];
        let count = 0;

        for (const row of state.jobs) {
          if (where.status && row.status !== where.status) {
            continue;
          }

          const matched = clauses.some((clause) => {
            if (clause.leadId) {
              return row.leadId === clause.leadId;
            }
            if (clause.maintenanceRequestId) {
              return row.maintenanceRequestId === clause.maintenanceRequestId;
            }
            return false;
          });

          if (!matched) {
            continue;
          }

          Object.assign(row, data, { updatedAt: now() });
          count += 1;
        }

        return { count };
      })
    },
    message: {
      create: vi.fn(async ({ data }: { data: any }) => {
        const created: MessageRow = {
          id: nextId("msg"),
          tenantId: data.tenantId,
          direction: data.direction,
          fromPhone: data.fromPhone,
          toPhone: data.toPhone,
          body: data.body,
          leadId: data.leadId ?? null,
          maintenanceRequestId: data.maintenanceRequestId ?? null,
          createdAt: now()
        };
        state.messages.push(created);
        return created;
      })
    },
    optOut: {
      upsert: vi.fn(async ({ where, update, create }: { where: any; update: any; create: any }) => {
        const target = state.optOuts.find(
          (row) => row.tenantId === where.tenantId_phone.tenantId && row.phone === where.tenantId_phone.phone
        );
        if (target) {
          Object.assign(target, update);
          return target;
        }

        const createdRow: OptOutRow = {
          id: nextId("opt"),
          tenantId: create.tenantId,
          phone: create.phone,
          active: create.active,
          reason: create.reason ?? null
        };
        state.optOuts.push(createdRow);
        return createdRow;
      }),
      findUnique: vi.fn(async ({ where }: { where: any }) => {
        return (
          state.optOuts.find(
            (row) => row.tenantId === where.tenantId_phone.tenantId && row.phone === where.tenantId_phone.phone
          ) ?? null
        );
      })
    }
  };

  const sendSmsMock = vi.fn(async () => {
    state.smsCounter += 1;
    return {
      sid: `SM_SMS_${state.smsCounter}`,
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

import { handleInboundSms } from "@/lib/sms";

function createTenant(overrides?: Partial<Record<string, unknown>>): any {
  return {
    id: "tenant_1",
    name: "PropPing Demo",
    twilioPhoneNumber: "+442071234567",
    forwardToPhoneNumber: "+447700900555",
    ownerNotificationPhoneNumber: "+447700900999",
    timezone: "Europe/London",
    allowedPostcodePrefixes: ["SW1", "SE1"],
    bookingUrlViewings: "https://example.test/viewings",
    bookingUrlCalls: "https://example.test/calls",
    messageTemplatesJson: {},
    compliancePolicyJson: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

function insertLead(row: Partial<LeadRow>): LeadRow {
  const created: LeadRow = {
    id: row.id ?? `lead_seed_${state.leads.length + 1}`,
    tenantId: row.tenantId ?? "tenant_1",
    callerPhone: row.callerPhone ?? "+447700900100",
    sourceCallSid: row.sourceCallSid ?? null,
    status: row.status ?? LeadStatus.OPEN,
    intent: row.intent ?? LeadIntent.UNKNOWN,
    flowStep: row.flowStep ?? 0,
    name: row.name ?? null,
    desiredArea: row.desiredArea ?? null,
    postcode: row.postcode ?? null,
    propertyQuery: row.propertyQuery ?? null,
    requirements: row.requirements ?? null,
    notes: row.notes ?? null,
    createdAt: row.createdAt ?? new Date(),
    updatedAt: row.updatedAt ?? new Date()
  };
  state.leads.push(created);
  return created;
}

function insertMaintenance(row: Partial<MaintenanceRow>): MaintenanceRow {
  const created: MaintenanceRow = {
    id: row.id ?? `maint_seed_${state.maintenance.length + 1}`,
    tenantId: row.tenantId ?? "tenant_1",
    callerPhone: row.callerPhone ?? "+447700900100",
    sourceCallSid: row.sourceCallSid ?? null,
    status: row.status ?? MaintenanceStatus.OPEN,
    flowStep: row.flowStep ?? 0,
    severity: row.severity ?? null,
    name: row.name ?? null,
    propertyAddress: row.propertyAddress ?? null,
    postcode: row.postcode ?? null,
    issueDescription: row.issueDescription ?? null,
    notes: row.notes ?? null,
    needsHuman: row.needsHuman ?? false,
    createdAt: row.createdAt ?? new Date(),
    updatedAt: row.updatedAt ?? new Date()
  };
  state.maintenance.push(created);
  return created;
}

function insertJob(row: Partial<JobRow>): JobRow {
  const created: JobRow = {
    id: row.id ?? `job_seed_${state.jobs.length + 1}`,
    tenantId: row.tenantId ?? "tenant_1",
    status: row.status ?? JobStatus.PENDING,
    leadId: row.leadId ?? null,
    maintenanceRequestId: row.maintenanceRequestId ?? null,
    createdAt: row.createdAt ?? new Date(),
    updatedAt: row.updatedAt ?? new Date()
  };
  state.jobs.push(created);
  return created;
}

describe("handleInboundSms state machine", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "";
    state.leads = [];
    state.maintenance = [];
    state.jobs = [];
    state.optOuts = [];
    state.messages = [];
    state.idCounter = 0;
    state.smsCounter = 0;
    sendSmsMock.mockClear();
  });

  it('inbound "2" creates maintenance conversation and progresses flow', async () => {
    const tenant = createTenant();
    const callerPhone = "+447700900201";

    await handleInboundSms({
      tenant,
      fromPhone: callerPhone,
      toPhone: tenant.twilioPhoneNumber,
      body: "2"
    });

    expect(state.maintenance).toHaveLength(1);
    expect(state.maintenance[0].status).toBe(MaintenanceStatus.OPEN);
    expect(state.maintenance[0].flowStep).toBe(1);
    expect(state.leads).toHaveLength(1);
    expect(state.leads[0].status).toBe(LeadStatus.CLOSED);

    expect(sendSmsMock).toHaveBeenCalledTimes(1);
    expect(sendSmsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        to: callerPhone,
        body: expect.stringContaining("full name")
      })
    );

    await handleInboundSms({
      tenant,
      fromPhone: callerPhone,
      toPhone: tenant.twilioPhoneNumber,
      body: "My name is John Smith"
    });

    expect(state.maintenance[0].name).toBe("John Smith");
    expect(state.maintenance[0].flowStep).toBe(2);
    expect(sendSmsMock).toHaveBeenCalledTimes(2);
    expect(sendSmsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        to: callerPhone,
        body: expect.stringContaining("property address or postcode")
      })
    );
  });

  it("safety keyword triggers emergency flow, NEEDS_HUMAN, and owner notification", async () => {
    const tenant = createTenant();
    const callerPhone = "+447700900202";
    const request = insertMaintenance({
      tenantId: tenant.id,
      callerPhone,
      status: MaintenanceStatus.OPEN,
      flowStep: 3,
      issueDescription: null
    });
    insertJob({
      tenantId: tenant.id,
      status: JobStatus.PENDING,
      maintenanceRequestId: request.id
    });

    await handleInboundSms({
      tenant,
      fromPhone: callerPhone,
      toPhone: tenant.twilioPhoneNumber,
      body: "There is a gas leak and smoke from the boiler"
    });

    expect(state.maintenance[0].status).toBe(MaintenanceStatus.NEEDS_HUMAN);
    expect(state.maintenance[0].needsHuman).toBe(true);
    expect(state.maintenance[0].severity).toBe(Severity.EMERGENCY);
    expect(state.jobs[0].status).toBe(JobStatus.CANCELED);

    expect(sendSmsMock).toHaveBeenCalledTimes(2);
    expect(sendSmsMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        to: callerPhone,
        body: expect.stringContaining("safety-critical")
      })
    );
    expect(sendSmsMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        to: tenant.ownerNotificationPhoneNumber
      })
    );
  });

  it("STOP opt-out blocks future automated sends and cancels pending jobs", async () => {
    const tenant = createTenant();
    const callerPhone = "+447700900203";
    const lead = insertLead({
      tenantId: tenant.id,
      callerPhone,
      status: LeadStatus.OPEN,
      intent: LeadIntent.GENERAL,
      flowStep: 2
    });
    insertJob({
      tenantId: tenant.id,
      leadId: lead.id,
      status: JobStatus.PENDING
    });

    await handleInboundSms({
      tenant,
      fromPhone: callerPhone,
      toPhone: tenant.twilioPhoneNumber,
      body: "STOP"
    });

    expect(state.optOuts).toHaveLength(1);
    expect(state.optOuts[0].active).toBe(true);
    expect(state.leads[0].status).toBe(LeadStatus.OPTED_OUT);
    expect(state.jobs[0].status).toBe(JobStatus.CANCELED);
    expect(sendSmsMock).toHaveBeenCalledTimes(1);

    sendSmsMock.mockClear();
    const messageCountBefore = state.messages.length;

    await handleInboundSms({
      tenant,
      fromPhone: callerPhone,
      toPhone: tenant.twilioPhoneNumber,
      body: "Can someone still call me?"
    });

    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(state.messages.length).toBe(messageCountBefore + 1);
    expect(state.messages[state.messages.length - 1].direction).toBe(MessageDirection.INBOUND);
  });

  it("out-of-area postcode marks OUT_OF_AREA and cancels follow-ups", async () => {
    const tenant = createTenant({
      allowedPostcodePrefixes: ["M1"]
    });
    const callerPhone = "+447700900204";
    const lead = insertLead({
      tenantId: tenant.id,
      callerPhone,
      status: LeadStatus.OPEN,
      intent: LeadIntent.VIEWING,
      flowStep: 2
    });
    insertJob({
      tenantId: tenant.id,
      leadId: lead.id,
      status: JobStatus.PENDING
    });

    await handleInboundSms({
      tenant,
      fromPhone: callerPhone,
      toPhone: tenant.twilioPhoneNumber,
      body: "SW1A 1AA"
    });

    expect(state.leads[0].status).toBe(LeadStatus.OUT_OF_AREA);
    expect(state.jobs[0].status).toBe(JobStatus.CANCELED);
    expect(sendSmsMock).toHaveBeenCalledTimes(1);
    expect(sendSmsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: callerPhone,
        body: expect.stringContaining("outside our current area")
      })
    );
  });

  it("anger heuristics trigger calm-mode handoff and owner notification", async () => {
    const tenant = createTenant();
    const callerPhone = "+447700900205";
    const lead = insertLead({
      tenantId: tenant.id,
      callerPhone,
      status: LeadStatus.OPEN,
      intent: LeadIntent.GENERAL,
      flowStep: 2
    });
    insertJob({
      tenantId: tenant.id,
      leadId: lead.id,
      status: JobStatus.PENDING
    });

    await handleInboundSms({
      tenant,
      fromPhone: callerPhone,
      toPhone: tenant.twilioPhoneNumber,
      body: "I have made a complaint and I will call my lawyer"
    });

    expect(state.leads[0].status).toBe(LeadStatus.NEEDS_HUMAN);
    expect(state.jobs[0].status).toBe(JobStatus.CANCELED);
    expect(sendSmsMock).toHaveBeenCalledTimes(2);
    expect(sendSmsMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        to: callerPhone,
        body: expect.stringContaining("A human colleague will review")
      })
    );
    expect(sendSmsMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        to: tenant.ownerNotificationPhoneNumber,
        body: expect.stringContaining("Calm-mode handoff required")
      })
    );
  });
});
