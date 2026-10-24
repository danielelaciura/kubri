import { describe, expect, it } from "vitest";
import { INTENTS } from "../../../src/engine/interpretation";
import { buildInterpretContext } from "../../../src/nlu/context";
import { interpretMessages, repairMessages } from "../../../src/nlu/interpret-messages";
import {
  INTERPRET_PROMPT_VERSION,
  INTERPRET_SYSTEM_PROMPT,
} from "../../../src/nlu/prompts/interpret-v1";
import { atQuestion, campaign } from "../engine/helpers";

const context = buildInterpretContext(
  { text: "Mario", state: atQuestion("nome"), campaign: campaign(), history: [], turnId: null },
  3,
);

describe("interpret-v1 prompt", () => {
  it("is versioned", () => {
    expect(INTERPRET_PROMPT_VERSION).toBe("interpret-v1");
  });

  it.each(INTENTS)("explains the %s intent", (intent) => {
    expect(INTERPRET_SYSTEM_PROMPT).toContain(intent);
  });

  it("explains the pending confirmation and the free texts' language (D84, D86)", () => {
    expect(INTERPRET_SYSTEM_PROMPT).toContain("pendingConfirmation");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("NOT the current question");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("language of the conversation");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("Never use null");
  });

  it("covers optional questions, consents, CV regeneration and edits (D56, D86)", () => {
    expect(INTERPRET_SYSTEM_PROMPT).toContain('"required" is false');
    expect(INTERPRET_SYSTEM_PROMPT).toContain("accepted");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("declined");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("regenerate_cv");
    expect(INTERPRET_SYSTEM_PROMPT).toContain("editTarget.field");
  });
});

describe("interpretMessages", () => {
  it("sends the rules, then the context and the message as one JSON object", () => {
    const [system, user, ...rest] = interpretMessages(context, "Mario");

    expect(system).toEqual({ role: "system", content: INTERPRET_SYSTEM_PROMPT });
    expect(user?.role).toBe("user");
    expect(JSON.parse(user?.content ?? "")).toEqual({ context, message: "Mario" });
    expect(rest).toEqual([]);
  });
});

describe("repairMessages", () => {
  it("adds the invalid reply and the problems, asking for JSON only", () => {
    const original = interpretMessages(context, "Mario");

    const repair = repairMessages(original, '{"intent":"dance"}', ["intent: Invalid option"]);

    expect(repair.slice(0, 2)).toEqual(original);
    expect(repair[2]).toEqual({ role: "assistant", content: '{"intent":"dance"}' });
    expect(repair[3]?.role).toBe("user");
    expect(repair[3]?.content).toContain("intent: Invalid option");
    expect(repair[3]?.content).toContain("one corrected JSON object only");
  });
});
