import { describe, expect, it } from "vitest";
import { parseInput, USAGE } from "../../../../src/cli/simulate/commands";
import { atQuestion, campaign, flowState } from "../../engine/helpers";

const c = campaign();
const BASE = {
  language: { code: "it", confidence: 0.5 },
  intent: "answer",
  patch: [],
  currentQuestion: { completeness: "absent" },
};

describe("parseInput", () => {
  it("sends plain text to the interpreter", () => {
    expect(parseInput("  Mario  ", atQuestion("nome"), c)).toEqual({ kind: "text", text: "Mario" });
  });

  it("refuses an empty line", () => {
    expect(parseInput("   ", atQuestion("nome"), c).kind).toBe("invalid");
  });

  it.each([
    ["/quit", "quit"],
    ["/q", "quit"],
    ["/state", "state"],
    ["/?", "usage"],
  ])("%s is a simulator command", (line, kind) => {
    expect(parseInput(line, flowState(), c).kind).toBe(kind);
  });

  it("forces a choice", () => {
    expect(parseInput("/choice idk", flowState({ stepId: "cv_info" }), c)).toEqual({
      kind: "forced",
      text: "idk",
      interpretation: { ...BASE, intent: "choice", choice: "idk" },
    });
  });

  it("simulates an unavailable NLU, keeping the text for the keywords", () => {
    expect(parseInput("/null cancella i miei dati", flowState(), c)).toEqual({
      kind: "forced",
      text: "cancella i miei dati",
      interpretation: null,
    });
  });

  it.each([
    ["/help", { ...BASE, intent: "help" }],
    ["/refuse", { ...BASE, intent: "refusal" }],
    ["/unclear", { ...BASE, intent: "unclear" }],
    ["/offtopic", { ...BASE, intent: "off_topic" }],
    ["/offtopic Oggi piove.", { ...BASE, intent: "off_topic", offTopicReply: "Oggi piove." }],
  ])("%s forces its intent", (line, interpretation) => {
    expect(parseInput(line, atQuestion("nome"), c)).toMatchObject({
      kind: "forced",
      interpretation,
    });
  });

  it("forces a partial answer with what is missing", () => {
    expect(parseInput("/partial l'anno di fine", atQuestion("nome"), c)).toMatchObject({
      interpretation: { currentQuestion: { completeness: "partial", missing: "l'anno di fine" } },
    });
  });

  it("forces a low-confidence value for the current question", () => {
    expect(parseInput("/low sì", atQuestion("patente"), c)).toMatchObject({
      interpretation: {
        patch: [{ field: "drivingLicense", value: true, confidence: 0.5, evidence: "sì" }],
        currentQuestion: { completeness: "complete" },
      },
    });
  });

  it("refuses /low outside a question or with a value of the wrong type", () => {
    expect(parseInput("/low x", flowState({ stepId: "cv_info" }), c).kind).toBe("invalid");
    expect(parseInput("/low boh", atQuestion("patente"), c).kind).toBe("invalid");
  });

  it("forces an edit request, converting the value to the field's type", () => {
    expect(parseInput("/edit drivingLicense no", atQuestion("nome"), c)).toMatchObject({
      interpretation: {
        intent: "edit_request",
        editTarget: { field: "drivingLicense", newValue: false },
      },
    });
    expect(parseInput("/edit location San Lazzaro", atQuestion("nome"), c)).toMatchObject({
      interpretation: { editTarget: { field: "location", newValue: "San Lazzaro" } },
    });
  });

  it("accepts a full interpretation as JSON", () => {
    const json = JSON.stringify({ ...BASE, intent: "opt_out" });

    expect(parseInput(`/nlu ${json}`, flowState(), c)).toEqual({
      kind: "forced",
      text: "",
      interpretation: { ...BASE, intent: "opt_out" },
    });
  });

  it.each(["/nlu {nope", '/nlu {"intent":"dance"}', "/choice", "/partial", "/dance"])(
    "refuses %j",
    (line) => {
      expect(parseInput(line, atQuestion("nome"), c).kind).toBe("invalid");
    },
  );

  it("documents every command", () => {
    for (const command of [
      "/choice",
      "/low",
      "/partial",
      "/edit",
      "/offtopic",
      "/help",
      "/refuse",
      "/unclear",
      "/null",
      "/nlu",
      "/state",
      "/?",
      "/quit",
    ]) {
      expect(USAGE.join("\n")).toContain(command);
    }
  });
});
