import { describe, expect, it } from "vitest";
import {
  computeComplianceReminderEvents,
  deriveComplianceStatus,
  parseCompliancePolicy
} from "@/lib/compliance";

describe("compliance scheduling", () => {
  it("parses policy defaults and custom values", () => {
    const defaults = parseCompliancePolicy(null);
    expect(defaults.dueSoonDays).toEqual([30, 14, 7]);
    expect(defaults.overdueReminderDays).toBe(7);

    const custom = parseCompliancePolicy({
      dueSoonDays: [21, 7, 14],
      overdueReminderDays: 5
    });
    expect(custom.dueSoonDays).toEqual([21, 14, 7]);
    expect(custom.overdueReminderDays).toBe(5);
  });

  it("computes reminder events at thresholds and overdue", () => {
    const now = new Date("2026-02-01T00:00:00.000Z");
    const expiry = new Date("2026-02-21T00:00:00.000Z");
    const policy = parseCompliancePolicy({
      dueSoonDays: [30, 14, 7],
      overdueReminderDays: 7
    });

    const events = computeComplianceReminderEvents(expiry, policy, now);
    expect(events.length).toBe(3);
    expect(events[0].thresholdDays).toBe(14);
    expect(events[1].thresholdDays).toBe(7);
    expect(events[2].reminderKind).toBe("OVERDUE");
  });

  it("derives compliance statuses by expiry date", () => {
    const policy = parseCompliancePolicy({
      dueSoonDays: [30, 14, 7],
      overdueReminderDays: 7
    });
    const now = new Date("2026-02-01T00:00:00.000Z");

    expect(deriveComplianceStatus(null, now, policy)).toBe("MISSING");
    expect(deriveComplianceStatus(new Date("2026-04-01T00:00:00.000Z"), now, policy)).toBe("OK");
    expect(deriveComplianceStatus(new Date("2026-02-10T00:00:00.000Z"), now, policy)).toBe("DUE_SOON");
    expect(deriveComplianceStatus(new Date("2026-01-15T00:00:00.000Z"), now, policy)).toBe("OVERDUE");
  });

  it("creates due-soon reminders at 30/14/7 day thresholds plus overdue", () => {
    const now = new Date("2026-02-01T00:00:00.000Z");
    const expiry = new Date("2026-03-15T00:00:00.000Z");
    const policy = parseCompliancePolicy({
      dueSoonDays: [30, 14, 7],
      overdueReminderDays: 7
    });

    const events = computeComplianceReminderEvents(expiry, policy, now);
    expect(events.map((event) => event.thresholdDays)).toEqual([30, 14, 7, null]);
    expect(events[0].runAt.toISOString()).toBe("2026-02-13T00:00:00.000Z");
    expect(events[1].runAt.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(events[2].runAt.toISOString()).toBe("2026-03-08T00:00:00.000Z");
    expect(events[3].runAt.toISOString()).toBe("2026-03-22T00:00:00.000Z");
  });
});
