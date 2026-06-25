import { describe, it, expect } from "vitest";
import { ASSESSMENT_SECTIONS, allQuestions } from "./registry";

describe("assessment registry", () => {
  it("has unique question ids", () => {
    const ids = allQuestions().map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every question has a target and a known component", () => {
    const components = new Set(["single_choice","multi_choice","scale","text","textarea","select","repeatable_group"]);
    for (const q of allQuestions()) {
      expect(components.has(q.component)).toBe(true);
      expect(q.target).toBeTruthy();
    }
  });

  it("choice questions carry options; scale questions carry a scale", () => {
    for (const q of allQuestions()) {
      if (q.component === "single_choice" || q.component === "multi_choice") {
        expect(Array.isArray(q.options) && q.options.length > 0).toBe(true);
      }
      if (q.component === "scale") expect(q.scale).toBeTruthy();
    }
  });

  it("sections are ordered and non-empty", () => {
    expect(ASSESSMENT_SECTIONS.length).toBeGreaterThan(0);
    const orders = ASSESSMENT_SECTIONS.map((s) => s.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });
});
