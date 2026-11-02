import { describe, expect, it } from "vitest";
import type { Interpretation } from "../../../src/engine/interpretation";
import { scoreCase } from "../../../src/evals/score-case";
import { campaign, interpretation } from "../engine/helpers";
import { makeCase, STATS } from "./helpers";

const c = campaign();
const entry = (field: string, value: unknown) => ({ field, value, confidence: 0.95, evidence: "" });
const score = (raw: Record<string, unknown>, interp: Interpretation | null = interpretation()) =>
  scoreCase(makeCase(raw), c, interp, STATS);

describe("scoreCase", () => {
  it("passes when every expectation is met", () => {
    const result = score(
      {
        expected: {
          intent: "answer",
          completeness: "complete",
          language: "it",
          patch: { firstName: "Mario" },
        },
      },
      interpretation({
        patch: [entry("firstName", "mario")],
        currentQuestion: { completeness: "complete" },
      }),
    );

    expect(result.pass).toBe(true);
    expect(result.patch).toEqual({
      correct: ["firstName"],
      wrong: [],
      invented: [],
      missing: [],
      extracted: 1,
    });
    expect(result.checks.intent).toEqual({ expected: "answer", actual: "answer", ok: true });
    expect(result.actual).toMatchObject({
      intent: "answer",
      language: "it",
      patch: { firstName: "mario" },
    });
  });

  it("only checks what the case expects", () => {
    expect(
      score({ expected: { intent: "help" } }, interpretation({ intent: "help" })).checks,
    ).toEqual({
      intent: { expected: "help", actual: "help", ok: true },
    });
  });

  it.each([
    ["intent", { intent: "help" }, interpretation({ intent: "answer" })],
    ["choice", { choice: "yes" }, interpretation({ intent: "choice", choice: "no" })],
    ["language", { language: "ar" }, interpretation()],
    ["completeness", { completeness: "complete" }, interpretation()],
  ] as const)("fails a wrong %s", (key, expected, interp) => {
    const result = score({ expected }, interp);

    expect(result.pass).toBe(false);
    expect(result.checks[key]?.ok).toBe(false);
  });

  it("splits the patch into correct, wrong, invented and missing", () => {
    const result = score(
      { expected: { patch: { firstName: "Mario", drivingLicense: true, transport: "auto" } } },
      interpretation({
        patch: [
          entry("firstName", "Mario"),
          entry("drivingLicense", false),
          entry("email", "a@b.it"),
        ],
      }),
    );

    expect(result.patch).toEqual({
      correct: ["firstName"],
      wrong: ["drivingLicense"],
      invented: ["email"],
      missing: ["transport"],
      extracted: 3,
    });
    expect(result.pass).toBe(false);
  });

  it("counts an unknown field as invented, and the last entry of a field as the answer", () => {
    const result = score(
      { expected: { patch: { firstName: "Mario" } } },
      interpretation({
        patch: [entry("firstName", "Maria"), entry("firstName", "Mario"), entry("colour", "red")],
      }),
    );

    expect(result.patch).toMatchObject({
      correct: ["firstName"],
      invented: ["colour"],
      extracted: 2,
    });
  });

  it("does not count the patch of an intent the engine ignores (D93)", () => {
    const result = score(
      { expected: { intent: "off_topic" } },
      interpretation({ intent: "off_topic", patch: [entry("firstName", "Mario")] }),
    );

    expect(result.patch.invented).toEqual([]);
    expect(result.patch.extracted).toBe(0);
    expect(result.pass).toBe(true);
  });

  it("still counts expected fields as missing when the intent makes the engine ignore them", () => {
    const result = score(
      { expected: { patch: { firstName: "Mario" } } },
      interpretation({ intent: "help", patch: [entry("firstName", "Mario")] }),
    );

    expect(result.patch.missing).toEqual(["firstName"]);
    expect(result.pass).toBe(false);
  });

  it("checks the edit target field and value", () => {
    const expected = {
      intent: "edit_request",
      editTarget: { field: "location", newValue: "Modena" },
    };
    const right = interpretation({
      intent: "edit_request",
      editTarget: { field: "location", newValue: "modena" },
    });
    const wrong = interpretation({
      intent: "edit_request",
      editTarget: { field: "location", newValue: "Parma" },
    });

    expect(score({ expected }, right).pass).toBe(true);
    expect(score({ expected }, wrong).checks.editTarget?.ok).toBe(false);
    expect(
      score({ expected }, interpretation({ intent: "edit_request" })).checks.editTarget?.actual,
    ).toBeNull();
  });

  it("fails everything when the NLU was unavailable", () => {
    const result = score({ expected: { intent: "answer", patch: { firstName: "Mario" } } }, null);

    expect(result).toMatchObject({ pass: false, actual: null });
    expect(result.checks.intent).toEqual({ expected: "answer", actual: null, ok: false });
    expect(result.patch.missing).toEqual(["firstName"]);
  });

  it("names the failure when the NLU was unavailable", () => {
    expect(score({}, null)).toMatchObject({
      failure: "unavailable",
      nlu: { runs: 1, passed: 0, unavailable: 1, invalidOutput: 0 },
    });
  });

  it("fails an output that stayed invalid after the repair, even if it looks right (E2)", () => {
    // createLlmInterpreter turns a broken reply into `unclear`: it must not pass an unclear case.
    const result = scoreCase(
      makeCase({ expected: { intent: "unclear" } }),
      c,
      interpretation({ intent: "unclear" }),
      { ...STATS, valid: false, repaired: true },
    );

    expect(result).toMatchObject({
      pass: false,
      failure: "invalid_output",
      nlu: { runs: 1, passed: 0, repaired: 1, invalidOutput: 1, unavailable: 0 },
    });
    expect(result.checks.intent?.ok).toBe(true);
  });

  it("counts a repair that worked, and a run over the deadline, without failing the case", () => {
    const result = scoreCase(makeCase(), c, interpretation(), {
      ...STATS,
      repaired: true,
      overDeadline: true,
    });

    expect(result).toMatchObject({
      pass: true,
      failure: null,
      nlu: { runs: 1, passed: 1, repaired: 1, invalidOutput: 0, overDeadline: 1 },
    });
  });

  it("carries id, language, tags and the run's latency and cost", () => {
    expect(
      scoreCase(makeCase({ tags: ["x"] }), c, interpretation(), {
        ...STATS,
        latencyMs: 42,
        costEstimate: 0.001,
      }),
    ).toMatchObject({ id: "c1", language: "it", tags: ["x"], latencyMs: 42, costEstimate: 0.001 });
  });
});
