import { describe, expect, it } from "vitest";
import type { InterpretContext } from "../../../src/nlu/context";
import {
  normalizeLanguageCode,
  parseInterpretationOutput,
} from "../../../src/nlu/interpretation-output";

const VALID = {
  language: { code: "it", confidence: 0.9 },
  intent: "answer",
  patch: [{ field: "firstName", value: "Mario", confidence: 0.95, evidence: "Mario" }],
  currentQuestion: { completeness: "complete" },
};

/** A questions step, with one withheld and one visible collected field. */
const AT_QUESTION: InterpretContext = {
  phase: "flow",
  sessionLanguage: "it",
  step: { id: "anagrafica", type: "questions" },
  question: null,
  openFields: [],
  collected: [
    { field: "lastName", description: "Cognome.", withheld: true },
    { field: "drivingLicense", description: "Patente.", value: true },
  ],
  pendingConfirmation: null,
  expectedChoices: [],
  history: [],
};

const AT_CHOICE: InterpretContext = {
  ...AT_QUESTION,
  step: { id: "cv_info", type: "choice", prompt: "Sai cos'è un CV?" },
  expectedChoices: [{ id: "yes", description: "sì" }],
};

const AT_CONSENT: InterpretContext = {
  ...AT_QUESTION,
  step: {
    id: "privacy",
    type: "consent",
    consentKey: "acme_privacy",
    optional: false,
    purpose: "informativa privacy",
  },
  expectedChoices: [{ id: "accepted", description: "accetta" }],
};

const parse = (value: unknown, context: InterpretContext = AT_QUESTION) =>
  parseInterpretationOutput(JSON.stringify(value), context);

describe("normalizeLanguageCode", () => {
  it.each([
    ["IT", "it"],
    ["it-IT", "it"],
    ["pt_BR", "pt"],
    [" En ", "en"],
    ["ita", "ita"],
  ])("%j → %j", (input, output) => {
    expect(normalizeLanguageCode(input)).toBe(output);
  });
});

describe("parseInterpretationOutput", () => {
  it("accepts a valid interpretation", () => {
    expect(parse(VALID)).toEqual({ ok: true, interpretation: VALID });
  });

  it("drops null and empty optional fields instead of failing (D83)", () => {
    const result = parse({
      ...VALID,
      choice: null,
      editTarget: null,
      offTopicReply: "",
      currentQuestion: { completeness: "complete", missing: null },
    });

    expect(result).toEqual({ ok: true, interpretation: VALID });
  });

  it("normalizes the language code", () => {
    expect(parse({ ...VALID, language: { code: "IT-it", confidence: 0.9 } })).toMatchObject({
      ok: true,
      interpretation: { language: { code: "it" } },
    });
  });

  it("reads a missing or null patch as empty, and a null evidence as empty", () => {
    const { patch: _patch, ...noPatch } = VALID;

    expect(parse(noPatch)).toMatchObject({ ok: true, interpretation: { patch: [] } });
    expect(parse({ ...VALID, patch: null })).toMatchObject({ interpretation: { patch: [] } });
    expect(
      parse({
        ...VALID,
        patch: [{ field: "firstName", value: "M", confidence: 0.9, evidence: null }],
      }),
    ).toMatchObject({ interpretation: { patch: [{ evidence: "" }] } });
  });

  it("removes a Markdown code fence around the JSON", () => {
    expect(
      parseInterpretationOutput("```json\n" + JSON.stringify(VALID) + "\n```", AT_QUESTION),
    ).toEqual({ ok: true, interpretation: VALID });
  });

  it("reports a reply that is not JSON", () => {
    expect(parseInterpretationOutput("Sure! Here it is", AT_QUESTION)).toEqual({
      ok: false,
      problems: ["the reply is not a JSON object"],
    });
  });

  it("reports a JSON value that is not an object", () => {
    expect(parseInterpretationOutput("[1, 2]", AT_QUESTION).ok).toBe(false);
  });

  it("reports schema problems with their path and no values", () => {
    const result = parse({ ...VALID, intent: "dance", language: { code: "ita", confidence: 2 } });

    expect(result.ok).toBe(false);
    const problems = result.ok ? [] : result.problems;
    expect(problems.some((p) => p.startsWith("intent:"))).toBe(true);
    expect(problems.some((p) => p.startsWith("language.code:"))).toBe(true);
    expect(problems.some((p) => p.startsWith("language.confidence:"))).toBe(true);
    expect(problems.join(" ")).not.toContain("dance");
  });

  it("still refuses unknown keys (strict schema)", () => {
    expect(parse({ ...VALID, reasoning: "because" }).ok).toBe(false);
  });
});

describe("parseInterpretationOutput: edit targets", () => {
  const editRequest = (editTarget: unknown) => ({
    ...VALID,
    intent: "edit_request",
    patch: [],
    currentQuestion: { completeness: "absent" },
    editTarget,
  });

  it("accepts an edit of a collected field, withheld or not", () => {
    expect(parse(editRequest({ field: "lastName", newValue: "Rossi" })).ok).toBe(true);
    expect(parse(editRequest({ field: "drivingLicense", newValue: false })).ok).toBe(true);
  });

  it("accepts an edit request without editTarget (the engine asks again)", () => {
    const { editTarget: _none, ...noTarget } = editRequest(undefined);
    expect(parse(noTarget).ok).toBe(true);
  });

  it("refuses an edit of a field that is not collected, naming the path only", () => {
    const result = parse(editRequest({ field: "custom.night_shifts", newValue: true }));

    expect(result).toEqual({
      ok: false,
      problems: [
        "editTarget.field: must be a key from context.collected; new information for an open field is intent answer",
      ],
    });
  });

  it.each([{ field: "lastName" }, { field: "lastName", newValue: null }])(
    "refuses an editTarget without a new value: %j",
    (editTarget) => {
      const result = parse(editRequest(editTarget));

      expect(result).toEqual({
        ok: false,
        problems: [
          "editTarget.newValue: required; leave out editTarget when the new value is not stated",
        ],
      });
    },
  );

  it("drops an editTarget that comes with another intent", () => {
    const result = parse({ ...VALID, editTarget: { field: "nope", newValue: 1 } });

    expect(result).toEqual({ ok: true, interpretation: VALID });
  });
});

describe("parseInterpretationOutput: patches on a choice", () => {
  const yesWithPatch = (choice: string) => ({ ...VALID, intent: "choice", choice });

  it("drops the patch of a choice outside a consent step", () => {
    expect(parse(yesWithPatch("yes"), AT_CHOICE)).toMatchObject({
      ok: true,
      interpretation: { intent: "choice", patch: [] },
    });
  });

  it("keeps the patch of a consent answer (same-turn data)", () => {
    expect(parse(yesWithPatch("accepted"), AT_CONSENT)).toMatchObject({
      ok: true,
      interpretation: { patch: VALID.patch },
    });
  });

  it("drops it on a consent step when the choice answers a pending confirmation (D84)", () => {
    const pending: InterpretContext = {
      ...AT_CONSENT,
      pendingConfirmation: { kind: "value", field: "firstName" },
    };

    expect(parse(yesWithPatch("yes"), pending)).toMatchObject({
      ok: true,
      interpretation: { patch: [] },
    });
  });
});

describe("parseInterpretationOutput: texts shown to the candidate", () => {
  const offTopic = (offTopicReply: string) => ({
    ...VALID,
    intent: "off_topic",
    patch: [],
    currentQuestion: { completeness: "absent" },
    offTopicReply,
  });
  const partial = (missing: string) => ({
    ...VALID,
    currentQuestion: { completeness: "partial", missing },
  });

  it("keeps a short, plain text", () => {
    const reply = "Capisco! Torniamo all'intervista: rispondi alla domanda, per favore.";
    expect(parse(offTopic(reply))).toMatchObject({ interpretation: { offTopicReply: reply } });
    expect(parse(partial("gli anni di esperienza"))).toMatchObject({
      interpretation: { currentQuestion: { missing: "gli anni di esperienza" } },
    });
  });

  it("keeps a 25-word text and drops a longer one (the engine uses its own text)", () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `parola${i}`).join(" ");

    expect(parse(offTopic(words(25)))).toMatchObject({
      interpretation: { offTopicReply: words(25) },
    });
    const long = parse(offTopic(words(26)));
    expect(long.ok).toBe(true);
    expect(long.ok && "offTopicReply" in long.interpretation).toBe(false);
  });

  it.each([
    "Visita https://example.com per info",
    "Vai su www.lavoro.it",
    "Guarda kubri.it per le offerte",
    "Scrivi a info@example.com",
    "Chiama il +39 333 123 4567",
    "Chiama lo 0612345678",
  ])("drops a text with a link, an e-mail or a phone number: %j", (text) => {
    const reply = parse(offTopic(text));
    const missing = parse(partial(text));

    expect(reply.ok && "offTopicReply" in reply.interpretation).toBe(false);
    expect(missing).toEqual({
      ok: true,
      interpretation: { ...VALID, currentQuestion: { completeness: "partial" } },
    });
  });

  it.each(["dal 2020-2023", "Sig.ra Rossi, ok", "nel 2019 o 2020"])(
    "keeps a text with years and abbreviations: %j",
    (text) => {
      expect(parse(offTopic(text))).toMatchObject({ interpretation: { offTopicReply: text } });
    },
  );
});

describe("parseInterpretationOutput: currentQuestion left out", () => {
  const ASKING: InterpretContext = {
    ...AT_QUESTION,
    question: {
      id: "nome",
      field: "firstName",
      type: "text",
      description: "Nome.",
      prompt: "Come ti chiami?",
      required: true,
    },
  };
  const { currentQuestion: _omit, ...withoutQuestion } = VALID;

  // Mistral omits currentQuestion when nothing is being asked (real output, plan 06 manual run).
  it("is absent on a consent answer, where no question is asked", () => {
    const result = parse(
      {
        language: { code: "en", confidence: 0.9 },
        intent: "choice",
        choice: "accepted",
        patch: [],
      },
      AT_CONSENT,
    );
    expect(result).toEqual({
      ok: true,
      interpretation: expect.objectContaining({
        intent: "choice",
        choice: "accepted",
        currentQuestion: { completeness: "absent" },
      }) as unknown,
    });
  });

  it("is absent for an intent that does not answer the current question", () => {
    const result = parse({ ...withoutQuestion, intent: "help", patch: [] }, ASKING);
    expect(result.ok && result.interpretation.currentQuestion).toEqual({ completeness: "absent" });
  });

  it("is absent for an answer when no question is asked", () => {
    const result = parse(withoutQuestion, AT_QUESTION);
    expect(result.ok && result.interpretation.currentQuestion).toEqual({ completeness: "absent" });
  });

  it("stays invalid on an answer to the current question: completeness can't be guessed", () => {
    expect(parse(withoutQuestion, ASKING)).toEqual({
      ok: false,
      problems: ["currentQuestion: Invalid input: expected object, received undefined"],
    });
  });
});
