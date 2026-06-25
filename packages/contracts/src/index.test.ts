import { describe, it, expect } from "vitest";
import { assessmentSubmissionSchema } from "./index";

const VALID = {
  contact: {
    firstName: "Amir",
    lastName: "K",
    phone: "+393331234567",
    location: "Roma (RM)",
    latitude: 41.89,
    longitude: 12.48,
    privacyAccepted: true as const,
  },
  assessment: { q1: "analitico", q3: 4 },
};

describe("assessmentSubmissionSchema", () => {
  it("accepts a valid submission", () => {
    expect(assessmentSubmissionSchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects a missing location", () => {
    const { location, ...contact } = VALID.contact;
    const r = assessmentSubmissionSchema.safeParse({ contact, assessment: {} });
    expect(r.success).toBe(false);
  });

  it("rejects coordinates outside Italy", () => {
    const r = assessmentSubmissionSchema.safeParse({
      contact: { ...VALID.contact, latitude: 0, longitude: 0 },
      assessment: {},
    });
    expect(r.success).toBe(false);
  });

  it("rejects a missing phone", () => {
    const { phone, ...contact } = VALID.contact;
    const r = assessmentSubmissionSchema.safeParse({ contact, assessment: {} });
    expect(r.success).toBe(false);
  });

  it("rejects a malformed phone", () => {
    const r = assessmentSubmissionSchema.safeParse({
      contact: { ...VALID.contact, phone: "not-a-number" },
      assessment: {},
    });
    expect(r.success).toBe(false);
  });
});
