import { describe, expect, it } from "vitest";
import { classifyDialStatus } from "@/lib/voice";

describe("classifyDialStatus", () => {
  it("flags no-answer as missed call triage candidate", () => {
    const result = classifyDialStatus("no-answer");
    expect(result.answered).toBe(false);
    expect(result.shouldStartTriage).toBe(true);
    expect(result.outcome).toBe("NO_ANSWER");
  });

  it("flags busy as missed call triage candidate", () => {
    const result = classifyDialStatus("busy");
    expect(result.answered).toBe(false);
    expect(result.shouldStartTriage).toBe(true);
    expect(result.outcome).toBe("BUSY");
  });

  it("flags failed as missed call triage candidate", () => {
    const result = classifyDialStatus("failed");
    expect(result.answered).toBe(false);
    expect(result.shouldStartTriage).toBe(true);
    expect(result.outcome).toBe("FAILED");
  });

  it("treats completed as answered", () => {
    const result = classifyDialStatus("completed");
    expect(result.answered).toBe(true);
    expect(result.shouldStartTriage).toBe(false);
    expect(result.outcome).toBe("ANSWERED");
  });
});
