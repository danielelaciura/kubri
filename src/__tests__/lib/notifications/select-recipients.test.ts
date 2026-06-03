import { describe, it, expect } from "vitest";
import { isWeeklyDue } from "@/lib/notifications/select-recipients";

describe("isWeeklyDue", () => {
  it("is due on Monday (WEEKLY_SEND_DAY=1)", () => {
    // 2026-06-01 is a Monday
    expect(isWeeklyDue(new Date("2026-06-01T07:00:00Z"))).toBe(true);
  });

  it("is not due on Tuesday", () => {
    expect(isWeeklyDue(new Date("2026-06-02T07:00:00Z"))).toBe(false);
  });
});
