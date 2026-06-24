import { describe, it, expect } from "vitest";
import { assessmentSubmissionSchema } from "./index";

const VALID = {
  contact: { firstName: "Amir", lastName: "K", phone: "+393331234567" },
  assessment: { q1: "a", q2: 3 },
};

describe("assessmentSubmissionSchema", () => {
  it("accepts a valid submission", () => {
    expect(assessmentSubmissionSchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects a missing phone", () => {
    const r = assessmentSubmissionSchema.safeParse({
      contact: { firstName: "Amir", lastName: "K" },
      assessment: {},
    });
    expect(r.success).toBe(false);
  });

  it("rejects a malformed phone", () => {
    const r = assessmentSubmissionSchema.safeParse({
      contact: { firstName: "A", lastName: "B", phone: "not-a-number" },
      assessment: {},
    });
    expect(r.success).toBe(false);
  });
});
