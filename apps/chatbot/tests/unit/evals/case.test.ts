import { describe, expect, it } from "vitest";
import {
  buildState,
  DatasetError,
  parseDataset,
  toInterpretRequest,
} from "../../../src/evals/case";
import { campaign } from "../engine/helpers";
import { makeCase } from "./helpers";

const c = campaign();
const line = (raw: Record<string, unknown>): string =>
  JSON.stringify({
    id: "c1",
    language: "it",
    state: { step: "anagrafica", question: "nome" },
    message: "Mario",
    expected: { patch: { firstName: "Mario" } },
    ...raw,
  });

describe("parseDataset", () => {
  it("reads one case per line, with defaults, skipping blank lines", () => {
    const [first, second] = parseDataset(`${line({})}\n\n${line({ id: "c2" })}\n`, c, "x.jsonl");

    expect(first).toMatchObject({
      id: "c1",
      tags: [],
      history: [],
      state: { phase: "flow", sessionLanguage: "it", consentsAccepted: true, profile: {} },
      expected: { patch: { firstName: "Mario" } },
    });
    expect(second?.id).toBe("c2");
  });

  it("treats an omitted patch as 'nothing to extract' (D92)", () => {
    expect(parseDataset(line({ expected: { intent: "help" } }), c, "x")[0]?.expected.patch).toEqual(
      {},
    );
  });

  it.each([
    ["not json", "{ nope", "x:1: not valid JSON"],
    ["a bad id", line({ id: "Bad Id" }), "x:1: id:"],
    ["an unknown key", line({ mood: "happy" }), "x:1: (root):"],
    ["a bad language", line({ language: "ITA" }), "x:1: language:"],
    [
      "an unknown question",
      line({ state: { step: "anagrafica", question: "zzz" } }),
      'unknown question "zzz"',
    ],
    ["an unknown step", line({ state: { step: "nope" } }), 'unknown step "nope"'],
    ["a flow case without step", line({ state: {} }), "needs a step"],
    ["an unknown field", line({ expected: { patch: { colour: "red" } } }), 'field "colour"'],
    ["a system-only field", line({ expected: { patch: { lat: 1 } } }), 'field "lat"'],
  ])("rejects %s with the line number", (_name, text, message) => {
    expect(() => parseDataset(text, c, "x")).toThrow(DatasetError);
    expect(() => parseDataset(text, c, "x")).toThrow(message);
  });

  it("rejects a duplicate id, naming the line", () => {
    expect(() => parseDataset(`${line({})}\n${line({})}`, c, "x")).toThrow(
      'x:2: duplicate id "c1"',
    );
  });
});

describe("buildState", () => {
  it("builds the engine state from the sketch", () => {
    const state = buildState(
      makeCase({
        state: {
          step: "anagrafica",
          question: "nome",
          sessionLanguage: "ar",
          consentsAccepted: false,
          profile: { drivingLicense: true },
          pending: { kind: "value", field: "firstName" },
        },
      }),
    );

    expect(state).toMatchObject({
      phase: "flow",
      stepId: "anagrafica",
      questionId: "nome",
      language: "ar",
      consentsAccepted: false,
      profile: { drivingLicense: { value: true, confidence: 0.9, status: "inferred" } },
      pendingConfirmation: { kind: "value", field: "firstName" },
    });
  });

  it("has no language yet in the language phase, and builds each kind of pending", () => {
    expect(buildState(makeCase({ state: { phase: "language" } })).language).toBeNull();
    expect(
      buildState(makeCase({ state: { step: "anagrafica", pending: { kind: "delete_data" } } }))
        .pendingConfirmation,
    ).toEqual({ kind: "delete_data" });
    expect(
      buildState(
        makeCase({ state: { step: "anagrafica", pending: { kind: "edit", field: "email" } } }),
      ).pendingConfirmation,
    ).toMatchObject({ kind: "edit", field: "email" });
  });
});

describe("toInterpretRequest", () => {
  it("uses the case id as turn id (D96)", () => {
    const request = toInterpretRequest(makeCase({ history: ["ciao"] }), c);

    expect(request).toMatchObject({ text: "Mario", history: ["ciao"], turnId: "c1" });
    expect(request.campaign).toBe(c);
  });
});
