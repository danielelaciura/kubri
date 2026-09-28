import { describe, it, expect } from "vitest";
import {
  candidateFiltersSchema,
  toFiltersAndSort,
} from "@/lib/validations/candidate-filters";

describe("candidateFiltersSchema status", () => {
  it("maps a valid status into filters", () => {
    const parsed = candidateFiltersSchema.parse({ status: "INTERVIEW" });
    expect(toFiltersAndSort(parsed).filters.status).toBe("INTERVIEW");
  });

  it("rejects unknown statuses", () => {
    expect(candidateFiltersSchema.safeParse({ status: "MAYBE" }).success).toBe(
      false,
    );
  });

  it("omits status when not given", () => {
    const parsed = candidateFiltersSchema.parse({});
    expect(toFiltersAndSort(parsed).filters.status).toBeUndefined();
  });
});
