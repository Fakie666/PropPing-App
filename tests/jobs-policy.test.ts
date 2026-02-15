import { LeadStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { shouldCancelLeadFollowUp } from "@/lib/jobs";

describe("shouldCancelLeadFollowUp", () => {
  it("returns true for terminal statuses", () => {
    expect(shouldCancelLeadFollowUp(LeadStatus.CLOSED)).toBe(true);
    expect(shouldCancelLeadFollowUp(LeadStatus.SCHEDULED)).toBe(true);
    expect(shouldCancelLeadFollowUp(LeadStatus.NEEDS_HUMAN)).toBe(true);
    expect(shouldCancelLeadFollowUp(LeadStatus.OUT_OF_AREA)).toBe(true);
    expect(shouldCancelLeadFollowUp(LeadStatus.OPTED_OUT)).toBe(true);
  });

  it("returns false for active statuses", () => {
    expect(shouldCancelLeadFollowUp(LeadStatus.OPEN)).toBe(false);
    expect(shouldCancelLeadFollowUp(LeadStatus.QUALIFIED)).toBe(false);
  });
});
