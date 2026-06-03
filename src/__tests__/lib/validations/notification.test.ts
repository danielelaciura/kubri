import { describe, it, expect } from "vitest";
import { notificationPrefsSchema } from "@/lib/validations/notification";

describe("notificationPrefsSchema", () => {
  it("accepts valid preferences", () => {
    const r = notificationPrefsSchema.safeParse({
      notifyEnabled: true,
      notifyFrequency: "DAILY",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown frequency", () => {
    const r = notificationPrefsSchema.safeParse({
      notifyEnabled: false,
      notifyFrequency: "MONTHLY",
    });
    expect(r.success).toBe(false);
  });
});
