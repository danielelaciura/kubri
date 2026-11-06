import { describe, expect, it } from "vitest";
import { FakeLlmProvider } from "../../../src/nlu/fake-provider";
import { assertIndependentJudge, createLlmJudge } from "../../../src/nlu/judge";
import { LlmError } from "../../../src/nlu/llm-provider";
import { JUDGE_PROMPT_VERSION, JUDGE_SYSTEM_PROMPT } from "../../../src/nlu/prompts/judge-v1";
import { fakeTiming } from "./helpers";

const INPUT = {
  source: "Accetti?",
  translation: "Do you accept?",
  language: "en",
  kind: "critical",
} as const;

const options = (provider: FakeLlmProvider) => ({
  provider,
  model: "judge-m",
  timeoutMs: 1000,
  timing: fakeTiming(),
});

describe("createLlmJudge", () => {
  it("sends the rubric and the texts, and returns the scores with the model that answered", async () => {
    const provider = new FakeLlmProvider([
      '{"fidelity":5,"naturalness":4,"issues":["slightly formal"]}',
    ]);

    const score = await createLlmJudge(options(provider)).score(INPUT);

    expect(score).toEqual({
      fidelity: 5,
      naturalness: 4,
      issues: ["slightly formal"],
      model: "judge-m",
    });
    expect(provider.requests[0]).toMatchObject({
      model: "judge-m",
      temperature: 0,
      responseFormat: "json",
    });
    expect(provider.requests[0]?.messages[0]).toEqual({
      role: "system",
      content: JUDGE_SYSTEM_PROMPT,
    });
    expect(JSON.parse(provider.requests[0]?.messages[1]?.content ?? "")).toEqual({
      targetLanguage: "en",
      kind: "critical",
      source: "Accetti?",
      translation: "Do you accept?",
    });
    expect(JUDGE_PROMPT_VERSION).toBe("judge-v1");
  });

  it.each(['{"fidelity":7,"naturalness":4}', "not json", '{"fidelity":4}'])(
    "returns null for the invalid reply %j",
    async (reply) => {
      expect(await createLlmJudge(options(new FakeLlmProvider([reply]))).score(INPUT)).toBeNull();
    },
  );

  it("returns null when the LLM is unavailable", async () => {
    const down = new LlmError("client", "Mistral HTTP 401", 401);

    expect(await createLlmJudge(options(new FakeLlmProvider([down]))).score(INPUT)).toBeNull();
  });

  it("never falls back to another model: a different judge is a different instrument (E8)", async () => {
    const busy = () => new LlmError("server", "Mistral HTTP 503", 503);
    const provider = new FakeLlmProvider([busy(), busy(), busy(), busy()]);

    expect(await createLlmJudge(options(provider)).score(INPUT)).toBeNull();
    expect(provider.requests.map((r) => r.model)).toEqual(["judge-m", "judge-m", "judge-m"]);
  });
});

describe("assertIndependentJudge (D100)", () => {
  const models = { interpret: "a", translate: "t", fallback: "f", judge: "j" };

  it("accepts a judge that differs from the translator", () => {
    expect(() => {
      assertIndependentJudge(models);
    }).not.toThrow();
  });

  it("refuses the translating model as judge", () => {
    expect(() => {
      assertIndependentJudge({ ...models, judge: "t" });
    }).toThrow(/NLU_JUDGE_MODEL/);
  });

  it("refuses the fallback model as judge: it translates when the translator fails", () => {
    expect(() => {
      assertIndependentJudge({ ...models, judge: "f" });
    }).toThrow(/NLU_JUDGE_MODEL must differ from NLU_FALLBACK_MODEL/);
  });
});
