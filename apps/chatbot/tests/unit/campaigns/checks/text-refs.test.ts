import { describe, expect, it } from "vitest";
import { checkTextRefs } from "../../../../src/campaigns/checks/text-refs";
import { minimalCampaign, parsed } from "../fixtures";

describe("checkTextRefs", () => {
  it("passes on the minimal campaign (cv_explain is declared)", () => {
    expect(checkTextRefs(parsed(minimalCampaign()))).toEqual([]);
  });

  it("reports an undeclared {ref} text", () => {
    const input = minimalCampaign();
    input.flow[0] = { id: "intro", type: "message", text: { ref: "welcome" } };

    expect(checkTextRefs(parsed(input))).toEqual([
      {
        path: "flow[0].text.ref",
        code: "unknown_text_ref",
        message: 'Text "welcome" is not declared in texts',
      },
    ]);
  });

  it("reports an undeclared reply in a transition", () => {
    const input = minimalCampaign();
    input.texts = {};

    expect(checkTextRefs(parsed(input))).toEqual([
      {
        path: "flow[1].on.idk.reply",
        code: "unknown_text_ref",
        message: 'Text "cv_explain" is not declared in texts',
      },
    ]);
  });

  it("checks question prompts and block titles", () => {
    const input = minimalCampaign();
    input.flow[3] = {
      id: "anagrafica",
      type: "questions",
      title: { ref: "missing_title" },
      questions: [{ id: "nome", field: "firstName", prompt: { ref: "missing_prompt" } }],
    };

    expect(checkTextRefs(parsed(input)).map((i) => i.path)).toEqual([
      "flow[3].title.ref",
      "flow[3].questions[0].prompt.ref",
    ]);
  });
});
