import { describe, expect, it } from "vitest";
import { checkTransitions } from "../../../../src/campaigns/checks/transitions";
import { minimalCampaign, parsed } from "../fixtures";

describe("checkTransitions", () => {
  it("passes on the minimal campaign", () => {
    expect(checkTransitions(parsed(minimalCampaign()))).toEqual([]);
  });

  it("reports outcomes the step cannot produce", () => {
    const input = minimalCampaign();
    input.flow[2] = {
      id: "privacy",
      type: "consent",
      consentKey: "acme_privacy",
      textVersion: "1",
      text: { it: "?" },
      on: { maybe: "@stop" },
    };

    expect(checkTransitions(parsed(input))).toEqual([
      {
        path: "flow[2].on.maybe",
        code: "unknown_outcome",
        message:
          'Step "privacy" (consent) has no outcome "maybe"; expected one of: accepted, declined',
      },
    ]);
  });

  it("reports targets that are not steps", () => {
    const input = minimalCampaign();
    input.flow[0] = { id: "intro", type: "message", text: { it: "Ciao" }, on: { next: "ghost" } };

    expect(checkTransitions(parsed(input))).toEqual([
      {
        path: "flow[0].on.next",
        code: "unknown_target",
        message: 'Target "ghost" is not a step id nor @stop / @repeat / @end',
      },
    ]);
  });

  it("checks the target of reply-then transitions", () => {
    const input = minimalCampaign();
    input.flow[1] = {
      id: "cv_info",
      type: "choice",
      prompt: { it: "?" },
      options: [
        { id: "yes", description: "sì" },
        { id: "idk", description: "non so" },
      ],
      on: { idk: { reply: "cv_explain", then: "ghost" } },
    };

    expect(checkTransitions(parsed(input)).map((i) => i.path)).toEqual(["flow[1].on.idk.then"]);
  });

  it("forbids @repeat on message steps", () => {
    const input = minimalCampaign();
    input.flow[0] = {
      id: "intro",
      type: "message",
      text: { it: "Ciao" },
      on: { next: "@repeat" },
    };

    expect(checkTransitions(parsed(input)).map((i) => i.code)).toEqual(["repeat_on_message"]);
  });

  it.each(["completed", "terminated"])(
    "forbids @repeat on the %s outcome of questions",
    (outcome) => {
      const input = minimalCampaign();
      const block = input.flow[3];
      if (block?.type === "questions")
        block.on = { [outcome]: { reply: "cv_explain", then: "@repeat" } };

      expect(checkTransitions(parsed(input))).toEqual([
        expect.objectContaining({
          path: `flow[3].on.${outcome}.then`,
          code: "repeat_on_questions",
        }),
      ]);
    },
  );

  describe("mandatory consent refusal", () => {
    const consent = (
      optional: boolean,
      declined: object | string,
    ): ReturnType<typeof minimalCampaign> => {
      const input = minimalCampaign();
      input.flow[2] = {
        id: "privacy",
        type: "consent",
        consentKey: "acme_privacy",
        textVersion: "1",
        text: { it: "?" },
        optional,
        on: { declined },
      } as never;
      return input;
    };

    it("rejects a mandatory consent whose decline goes past the consent", () => {
      expect(checkTransitions(parsed(consent(false, "anagrafica")))).toEqual([
        {
          path: "flow[2].on.declined",
          code: "mandatory_consent_declined_not_stop",
          message:
            'Consent "privacy" is mandatory: declining it must lead to @stop, not "anagrafica"',
        },
      ]);
    });

    it("reports the exact path of the target in a reply-then transition", () => {
      const input = consent(false, { reply: "cv_explain", then: "@end" });

      expect(checkTransitions(parsed(input)).map((i) => [i.path, i.code])).toEqual([
        ["flow[2].on.declined.then", "mandatory_consent_declined_not_stop"],
      ]);
    });

    it("accepts @stop, directly or after a reply", () => {
      expect(checkTransitions(parsed(consent(false, "@stop")))).toEqual([]);
      expect(
        checkTransitions(parsed(consent(false, { reply: "cv_explain", then: "@stop" }))),
      ).toEqual([]);
    });

    it("lets an optional consent go anywhere", () => {
      expect(checkTransitions(parsed(consent(true, "anagrafica")))).toEqual([]);
    });
  });
});
