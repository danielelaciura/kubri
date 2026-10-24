import { describe, expect, it } from "vitest";
import {
  conditionRefs,
  evaluateCondition,
  type ConditionContext,
} from "../../../src/campaigns/conditions/evaluate";
import { ConditionSchema, type Condition } from "../../../src/campaigns/schema/conditions";

const ctx: ConditionContext = {
  values: { drivingLicense: true, transport: "bici", languages: ["en", "fr"], age: 30 },
  outcomes: { cv_info: "yes" },
};

const evaluate = (c: Condition): boolean => evaluateCondition(c, ctx);

describe("ConditionSchema", () => {
  it("accepts nested conditions", () => {
    const result = ConditionSchema.safeParse({
      all: [{ field: "drivingLicense", eq: true }, { not: { step: "cv_info", outcome: "no" } }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects two operators on the same field condition", () => {
    expect(ConditionSchema.safeParse({ field: "x", eq: 1, neq: 2 }).success).toBe(false);
  });

  it("rejects an empty all", () => {
    expect(ConditionSchema.safeParse({ all: [] }).success).toBe(false);
  });
});

describe("evaluateCondition", () => {
  it("eq / neq on scalars", () => {
    expect(evaluate({ field: "transport", eq: "bici" })).toBe(true);
    expect(evaluate({ field: "transport", neq: "auto" })).toBe(true);
  });

  it("eq / in mean 'contains' on lists", () => {
    expect(evaluate({ field: "languages", eq: "fr" })).toBe(true);
    expect(evaluate({ field: "languages", in: ["de", "en"] })).toBe(true);
    expect(evaluate({ field: "languages", notIn: ["de"] })).toBe(true);
  });

  it("gt / lt on numbers only", () => {
    expect(evaluate({ field: "age", gt: 18 })).toBe(true);
    expect(evaluate({ field: "transport", lt: 5 })).toBe(false);
  });

  it("missing values: only neq, notIn and notExists are true", () => {
    expect(evaluate({ field: "email", eq: "x" })).toBe(false);
    expect(evaluate({ field: "email", in: ["x"] })).toBe(false);
    expect(evaluate({ field: "email", gt: 1 })).toBe(false);
    expect(evaluate({ field: "email", neq: "x" })).toBe(true);
    expect(evaluate({ field: "email", notIn: ["x"] })).toBe(true);
    expect(evaluate({ field: "email", notExists: true })).toBe(true);
    expect(evaluate({ field: "email", exists: true })).toBe(false);
  });

  it("treats empty lists as missing", () => {
    expect(
      evaluateCondition({ field: "l", exists: true }, { values: { l: [] }, outcomes: {} }),
    ).toBe(false);
  });

  it("step outcomes", () => {
    expect(evaluate({ step: "cv_info", outcome: "yes" })).toBe(true);
    expect(evaluate({ step: "privacy", outcome: "accepted" })).toBe(false);
  });

  it("all / any / not", () => {
    expect(
      evaluate({
        all: [
          { field: "drivingLicense", eq: true },
          { field: "age", gt: 18 },
        ],
      }),
    ).toBe(true);
    expect(
      evaluate({
        any: [
          { field: "age", lt: 18 },
          { field: "transport", eq: "bici" },
        ],
      }),
    ).toBe(true);
    expect(evaluate({ not: { field: "drivingLicense", eq: true } })).toBe(false);
  });
});

describe("conditionRefs", () => {
  it("collects field and step references from nested conditions", () => {
    const refs = conditionRefs({
      any: [
        { field: "drivingLicense", eq: true },
        { not: { step: "cv_info", outcome: "yes" } },
        { all: [{ field: "custom.night_shifts", exists: true }] },
      ],
    });
    expect(refs).toEqual({
      fields: ["drivingLicense", "custom.night_shifts"],
      outcomes: [{ step: "cv_info", outcome: "yes" }],
    });
  });
});
