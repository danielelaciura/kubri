import { describe, expect, it } from "vitest";
import {
  InterpretationSchema,
  isChoice,
  type Interpretation,
} from "../../../src/engine/interpretation";

const valid = {
  language: { code: "it", confidence: 0.98 },
  intent: "answer",
  patch: [{ field: "firstName", value: "Mario", confidence: 0.95, evidence: "mi chiamo Mario" }],
  currentQuestion: { completeness: "complete" },
};

describe("InterpretationSchema", () => {
  it("accepts the spec §8.3 shape", () => {
    expect(InterpretationSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts the optional fields", () => {
    const result = InterpretationSchema.safeParse({
      ...valid,
      intent: "edit_request",
      choice: "yes",
      currentQuestion: { completeness: "partial", missing: "cognome" },
      editTarget: { field: "firstName", newValue: "Marco" },
      offTopicReply: "Sono qui per il colloquio di lavoro.",
    });
    expect(result.success).toBe(true);
  });

  it.each(["chat", "", "ANSWER"])("rejects intent %j", (intent) => {
    expect(InterpretationSchema.safeParse({ ...valid, intent }).success).toBe(false);
  });

  it("rejects a confidence outside 0..1", () => {
    const result = InterpretationSchema.safeParse({
      ...valid,
      language: { code: "it", confidence: 1.2 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown keys: the LLM never chooses the next step", () => {
    expect(InterpretationSchema.safeParse({ ...valid, nextStep: "fine" }).success).toBe(false);
  });

  it("requires the patch array, even when empty", () => {
    const { patch: _patch, ...withoutPatch } = valid;
    expect(InterpretationSchema.safeParse(withoutPatch).success).toBe(false);
  });
});

describe("isChoice", () => {
  const choice = (id: string): Interpretation =>
    InterpretationSchema.parse({ ...valid, intent: "choice", choice: id });

  it("matches the chosen option", () => {
    expect(isChoice(choice("yes"), "yes")).toBe(true);
    expect(isChoice(choice("no"), "yes")).toBe(false);
  });

  it("is false for other intents and without an interpretation", () => {
    expect(isChoice(InterpretationSchema.parse({ ...valid, choice: "yes" }), "yes")).toBe(false);
    expect(isChoice(null, "yes")).toBe(false);
  });
});
