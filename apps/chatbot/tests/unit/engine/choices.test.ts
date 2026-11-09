import { describe, expect, it } from "vitest";
import {
  awaitedChoices,
  interpretReply,
  OFFERED_LANGUAGES,
  type OfferedChoice,
} from "../../../src/engine/choices";
import { initialSessionState } from "../../../src/engine/state";
import { atQuestion, campaign, flowState } from "./helpers";

const ids = (options: readonly OfferedChoice[] | undefined) => options?.map((o) => o.id);

/** The minimal campaign with an enum question "mansione" at the end of "anagrafica". */
function withEnum(options: string[]) {
  return campaign((input) => {
    input.customFields = [
      {
        key: "mansione",
        type: "enum",
        options,
        label: { it: "Mansione" },
        description: "Mansione preferita",
      },
    ];
    const step = input.flow[3];
    if (step?.type !== "questions") throw new Error("fixture");
    step.questions.push({
      id: "mansione",
      field: "custom.mansione",
      prompt: { it: "Quale mansione?" },
    });
  });
}

describe("awaitedChoices (D113)", () => {
  const c = campaign();

  it("offers ten languages, named in their own language, when the language is not chosen", () => {
    const offer = awaitedChoices(initialSessionState(), c);

    expect(offer?.listButton).toBe("choice.language_button");
    expect(offer?.options).toHaveLength(10);
    expect(offer?.options[0]).toEqual({
      id: "lang:it",
      label: { kind: "literal", text: "Italiano" },
      meaning: { kind: "language", code: "it" },
    });
    expect(OFFERED_LANGUAGES.map((l) => l.code)).toContain("ar");
  });

  it.each([
    [
      "value",
      { kind: "value", field: "firstName", value: "Mrio", confidence: 0.5 },
      "confirm:value:firstName",
    ],
    [
      "edit",
      { kind: "edit", field: "firstName", oldValue: "A", newValue: "B" },
      "confirm:edit:firstName",
    ],
    ["delete_data", { kind: "delete_data" }, "confirm:delete_data"],
  ] as const)(
    "offers yes/no for a pending %s confirmation, in any phase",
    (_kind, pending, prefix) => {
      const expected = [`${prefix}:yes`, `${prefix}:no`];
      const atNome = awaitedChoices(atQuestion("nome", { pendingConfirmation: pending }), c);

      expect(ids(atNome?.options)).toEqual(expected);
      expect(atNome?.options.map((o) => o.meaning)).toEqual([
        { kind: "choice", choice: "yes" },
        { kind: "choice", choice: "no" },
      ]);
      expect(
        ids(awaitedChoices({ ...initialSessionState(), pendingConfirmation: pending }, c)?.options),
      ).toEqual(expected);
    },
  );

  it("offers accepted/declined on a consent step", () => {
    const offer = awaitedChoices(flowState({ stepId: "privacy" }), c);

    expect(offer?.options).toEqual([
      {
        id: "consent:privacy:accepted",
        label: { kind: "catalog", key: "choice.accepted" },
        meaning: { kind: "choice", choice: "accepted" },
      },
      {
        id: "consent:privacy:declined",
        label: { kind: "catalog", key: "choice.declined" },
        meaning: { kind: "choice", choice: "declined" },
      },
    ]);
    expect(offer?.listButton).toBe("choice.list_button");
  });

  it("offers the catalog labels for yes/no/idk on a choice step", () => {
    const offer = awaitedChoices(flowState({ stepId: "cv_info" }), c);

    expect(ids(offer?.options)).toEqual([
      "step:cv_info:yes",
      "step:cv_info:no",
      "step:cv_info:idk",
    ]);
    expect(offer?.options[2]?.label).toEqual({ kind: "catalog", key: "choice.idk" });
    expect(offer?.options[2]?.meaning).toEqual({ kind: "choice", choice: "idk" });
  });

  it("uses the labels of a choice step, and offers nothing if an option has none", () => {
    const labelled = campaign((input) => {
      const step = input.flow[1];
      if (step?.type !== "choice") throw new Error("fixture");
      step.options = [
        { id: "magazzino", description: "m", label: { it: "Magazzino" } },
        { id: "cucina", description: "c", label: { it: "Cucina" } },
      ];
    });
    const unlabelled = campaign((input) => {
      const step = input.flow[1];
      if (step?.type !== "choice") throw new Error("fixture");
      step.options = [
        { id: "yes", description: "y" },
        { id: "maybe", description: "m" },
      ];
    });

    expect(awaitedChoices(flowState({ stepId: "cv_info" }), labelled)?.options[0]).toEqual({
      id: "step:cv_info:magazzino",
      label: { kind: "text", text: { it: "Magazzino" } },
      meaning: { kind: "choice", choice: "magazzino" },
    });
    expect(awaitedChoices(flowState({ stepId: "cv_info" }), unlabelled)).toBeNull();
  });

  it("offers yes/no for a boolean question, meaning a value for the field", () => {
    const offer = awaitedChoices(atQuestion("patente"), c);

    expect(offer?.options.map((o) => o.meaning)).toEqual([
      { kind: "value", field: "drivingLicense", value: true },
      { kind: "value", field: "drivingLicense", value: false },
    ]);
    expect(ids(offer?.options)).toEqual(["q:patente:yes", "q:patente:no"]);
  });

  it("offers the options of an enum question, if they fit a list row", () => {
    const offer = awaitedChoices(
      atQuestion("mansione"),
      withEnum(["magazzino", "cucina", "pulizie"]),
    );

    expect(ids(offer?.options)).toEqual([
      "q:mansione:magazzino",
      "q:mansione:cucina",
      "q:mansione:pulizie",
    ]);
    expect(offer?.options[1]).toMatchObject({
      label: { kind: "text", text: { it: "cucina" } },
      meaning: { kind: "value", field: "custom.mansione", value: "cucina" },
    });

    expect(awaitedChoices(atQuestion("mansione"), withEnum(["a", "x".repeat(25)]))).toBeNull();
  });

  it("drops the widget when an id would exceed Meta's 200 characters (C1)", () => {
    const longId = campaign((input) => {
      const step = input.flow[1];
      if (step?.type !== "choice") throw new Error("fixture");
      step.options = [
        { id: "yes", description: "y" },
        { id: `o${"x".repeat(199)}`, description: "long", label: { it: "Lunga" } },
      ];
    });

    expect(awaitedChoices(flowState({ stepId: "cv_info" }), longId)).toBeNull();
  });

  it("offers nothing for a free-text question, outside the flow, or when closed", () => {
    expect(awaitedChoices(atQuestion("nome"), c)).toBeNull();
    expect(
      awaitedChoices({ ...initialSessionState(), phase: "post_completion", language: "it" }, c),
    ).toBeNull();
    expect(awaitedChoices({ ...initialSessionState(), phase: "closed" }, c)).toBeNull();
  });
});

describe("interpretReply (D114)", () => {
  const c = campaign();

  it("turns a tap on a consent into a choice with full confidence, with no NLU", () => {
    const state = flowState({ stepId: "privacy", language: "ar" });

    expect(interpretReply(state, c, { id: "consent:privacy:accepted", title: "أوافق" })).toEqual({
      language: { code: "ar", confidence: 1 },
      intent: "choice",
      choice: "accepted",
      patch: [],
      currentQuestion: { completeness: "absent" },
    });
  });

  it("turns a tap on a boolean question into an answer with a patch", () => {
    expect(interpretReply(atQuestion("patente"), c, { id: "q:patente:no", title: "No" })).toEqual({
      language: { code: "it", confidence: 1 },
      intent: "answer",
      patch: [{ field: "drivingLicense", value: false, confidence: 1, evidence: "No" }],
      currentQuestion: { completeness: "complete" },
    });
  });

  it("turns a tap on an enum question into its value", () => {
    const reply = { id: "q:mansione:cucina", title: "cucina" };

    expect(
      interpretReply(atQuestion("mansione"), withEnum(["magazzino", "cucina"]), reply)?.patch,
    ).toEqual([{ field: "custom.mansione", value: "cucina", confidence: 1, evidence: "cucina" }]);
  });

  it("turns a tap on a language into that language", () => {
    expect(interpretReply(initialSessionState(), c, { id: "lang:ar", title: "العربية" })).toEqual({
      language: { code: "ar", confidence: 1 },
      intent: "answer",
      patch: [],
      currentQuestion: { completeness: "absent" },
    });
  });

  it("does not know an id that is not awaited any more (a tap on an old widget)", () => {
    expect(
      interpretReply(atQuestion("nome"), c, { id: "consent:privacy:accepted", title: "Accetto" }),
    ).toBeNull();
    expect(
      interpretReply(flowState({ stepId: "privacy" }), c, { id: "q:patente:yes", title: "Sì" }),
    ).toBeNull();
    // Both yes/no questions: the old "Sì" of "patente" does not answer "notte".
    expect(interpretReply(atQuestion("notte"), c, { id: "q:patente:yes", title: "Sì" })).toBeNull();
  });
});
