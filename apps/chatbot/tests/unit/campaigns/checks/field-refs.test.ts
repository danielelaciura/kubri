import { describe, expect, it } from "vitest";
import { checkFieldRefs } from "../../../../src/campaigns/checks/field-refs";
import type { CampaignInput } from "../../../../src/campaigns/schema/campaign";
import { minimalCampaign, parsed } from "../fixtures";

type StepInput = CampaignInput["flow"][number];

const questionsStep = (questions: object[]): StepInput =>
  ({ id: "anagrafica", type: "questions", questions }) as StepInput;

describe("checkFieldRefs", () => {
  it("passes on the minimal campaign", () => {
    expect(checkFieldRefs(parsed(minimalCampaign()))).toEqual([]);
  });

  it("reports unknown and undeclared custom fields", () => {
    const input = minimalCampaign();
    input.flow[3] = questionsStep([
      { id: "a", field: "nickname", prompt: { it: "?" } },
      { id: "b", field: "custom.uniform_size", prompt: { it: "?" } },
    ]);

    expect(checkFieldRefs(parsed(input))).toEqual([
      {
        path: "flow[3].questions[0].field",
        code: "unknown_field",
        message: 'Field "nickname" is neither standard nor declared in customFields',
      },
      {
        path: "flow[3].questions[1].field",
        code: "unknown_field",
        message: 'Field "custom.uniform_size" is neither standard nor declared in customFields',
      },
    ]);
  });

  it("reports questions on system-only fields", () => {
    const input = minimalCampaign();
    input.flow[3] = questionsStep([{ id: "tel", field: "phone", prompt: { it: "?" } }]);

    expect(checkFieldRefs(parsed(input)).map((i) => i.code)).toEqual(["system_only_field"]);
  });

  it("reports two questions writing the same field", () => {
    const input = minimalCampaign();
    input.flow[3] = questionsStep([
      { id: "a", field: "firstName", prompt: { it: "?" } },
      { id: "b", field: "firstName", prompt: { it: "??" } },
    ]);

    expect(checkFieldRefs(parsed(input)).map((i) => [i.path, i.code])).toEqual([
      ["flow[3].questions[1].field", "duplicate_field_question"],
    ]);
  });

  it("reports conditions on unknown fields", () => {
    const input = minimalCampaign();
    input.flow[0] = {
      id: "intro",
      type: "message",
      text: { it: "Ciao" },
      when: { field: "shoeSize", gt: 40 },
    };

    expect(checkFieldRefs(parsed(input))).toEqual([
      {
        path: "flow[0].when",
        code: "unknown_condition_field",
        message: 'Condition refers to unknown field "shoeSize"',
      },
    ]);
  });

  it("reports conditions on unknown steps or impossible outcomes", () => {
    const input = minimalCampaign();
    input.flow[3] = questionsStep([
      {
        id: "nome",
        field: "firstName",
        prompt: { it: "?" },
        when: { step: "ghost", outcome: "yes" },
        terminateIf: { step: "cv_info", outcome: "maybe" },
      },
    ]);

    expect(checkFieldRefs(parsed(input))).toEqual([
      {
        path: "flow[3].questions[0].when",
        code: "unknown_condition_step",
        message: 'Condition refers to unknown step "ghost"',
      },
      {
        path: "flow[3].questions[0].terminateIf",
        code: "unknown_condition_outcome",
        message: 'Step "cv_info" has no outcome "maybe"',
      },
    ]);
  });
});
