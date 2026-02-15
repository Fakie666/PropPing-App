import { describe, expect, it } from "vitest";
import { extractSmsSignals } from "@/lib/extraction";

describe("extractSmsSignals fallback extraction", () => {
  it("detects stop keyword", async () => {
    process.env.OPENAI_API_KEY = "";
    const result = await extractSmsSignals("STOP");
    expect(result.stop).toBe(true);
    expect(result.intent).toBe("UNKNOWN");
  });

  it("detects maintenance intent, postcode, and emergency severity", async () => {
    process.env.OPENAI_API_KEY = "";
    const result = await extractSmsSignals("2 Gas leak at 22 River Road, SE1 7PB");
    expect(result.intent).toBe("MAINTENANCE");
    expect(result.postcode).toBe("SE1 7PB");
    expect(result.severity).toBe("EMERGENCY");
    expect(result.safetyRisk).toBe(true);
  });

  it("detects viewing intent and name", async () => {
    process.env.OPENAI_API_KEY = "";
    const result = await extractSmsSignals("1 I am Alex Carter looking for a viewing");
    expect(result.intent).toBe("VIEWING");
    expect(result.name).toContain("Alex Carter");
  });
});
