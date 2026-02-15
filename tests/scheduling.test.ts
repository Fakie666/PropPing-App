import { describe, expect, it } from "vitest";
import { computeMissedCallFollowUpRunTimes } from "@/lib/scheduling";

describe("computeMissedCallFollowUpRunTimes", () => {
  it("returns +2h and next business-day run times", () => {
    const now = new Date("2026-02-13T16:00:00.000Z"); // Friday
    const [first, second] = computeMissedCallFollowUpRunTimes(now, "Europe/London");

    expect(first.getTime()).toBe(now.getTime() + 2 * 60 * 60 * 1000);
    expect(second.getUTCDay()).toBe(1); // Monday
  });
});
