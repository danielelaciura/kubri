import { describe, expect, it } from "vitest";
import { step } from "../../../src/engine/step";
import { atQuestion, campaign, flowState, interpretation, others, sent, userTurn } from "./helpers";

const c = campaign();
const atChoice = flowState({ stepId: "cv_info" });

describe("off-topic and help", () => {
  it("sends the LLM's short off-topic reply as is, then the question again", () => {
    const interp = interpretation({
      intent: "off_topic",
      offTopicReply: "Sono qui per il colloquio di lavoro.",
    });
    const result = step(atChoice, userTurn("che tempo fa?", interp), c);

    expect(result.effects[0]).toEqual({
      type: "SendText",
      text: { kind: "generated", text: "Sono qui per il colloquio di lavoro." },
    });
    expect(sent(result.effects)).toEqual(["generated", "cv_info"]);
  });

  it("falls back to the system off-topic text without a reply", () => {
    const result = step(
      atChoice,
      userTurn("che tempo fa?", interpretation({ intent: "off_topic" })),
      c,
    );
    expect(sent(result.effects)).toEqual(["system.off_topic", "cv_info"]);
  });

  it("sends the help text on help", () => {
    const result = step(atChoice, userTurn("aiuto", interpretation({ intent: "help" })), c);
    expect(sent(result.effects)).toEqual(["system.help", "cv_info"]);
  });

  it("works inside a questions block too", () => {
    const result = step(
      atQuestion("nome"),
      userTurn("?", interpretation({ intent: "off_topic" })),
      c,
    );
    expect(sent(result.effects)).toEqual(["system.off_topic", "anagrafica.nome"]);
  });

  it("saves nothing extracted from an off-topic or help message", () => {
    const interp = interpretation({
      intent: "help",
      patch: [{ field: "drivingLicense", value: true, confidence: 0.95, evidence: "patente" }],
    });
    const result = step(atQuestion("nome"), userTurn("serve la patente?", interp), c);

    expect(others(result.effects)).toEqual([]);
    expect(sent(result.effects)).toEqual(["system.help", "anagrafica.nome"]);
  });
});
