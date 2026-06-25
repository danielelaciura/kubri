import { describe, it, expect } from "vitest";
import { assessmentAnswersSchema } from "./schema";

describe("assessmentAnswersSchema", () => {
  it("accepts a partial set of well-typed answers", () => {
    expect(assessmentAnswersSchema.safeParse({ q1: "analitico", q3: 4 }).success).toBe(true);
  });
  it("accepts an empty object (all answers optional)", () => {
    expect(assessmentAnswersSchema.safeParse({}).success).toBe(true);
  });
  it("rejects a single_choice value outside its options", () => {
    expect(assessmentAnswersSchema.safeParse({ q1: "nope" }).success).toBe(false);
  });
  it("rejects a scale value out of range", () => {
    expect(assessmentAnswersSchema.safeParse({ q3: 99 }).success).toBe(false);
  });
});
