import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateCampaign } from "../../../src/campaigns/validate";
import { parseDataset, toInterpretRequest } from "../../../src/evals/case";
import { computeMetrics } from "../../../src/evals/metrics";
import { runCases } from "../../../src/evals/runner";
import { buildInterpretContext } from "../../../src/nlu/context";
import { oracleInterpret } from "./oracle";

const ROOT = join(__dirname, "../../..");
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

const loaded = validateCampaign(JSON.parse(read("campaigns/kubri-standard.json")));
if (!loaded.ok) throw new Error("the standard campaign must be valid");
const campaign = loaded.campaign;

const SUITES = ["extraction", "intent", "choice", "language"] as const;

describe.each(SUITES)("dataset %s", (suite) => {
  const path = `evals/datasets/${suite}.jsonl`;
  const cases = parseDataset(read(path), campaign, path);

  it("is valid on the standard campaign and big enough to start with", () => {
    expect(cases.length).toBeGreaterThanOrEqual(5);
  });

  it("is consistent with the scorers: an oracle passes every case (D101)", async () => {
    const results = await runCases({
      cases,
      campaign,
      interpret: oracleInterpret(cases),
      historyMessages: 3,
      clock: () => 0,
      deadlineMs: 20_000,
    });

    expect(results.filter((r) => !r.pass).map((r) => r.id)).toEqual([]);
    expect(computeMetrics(results).hallucination.invented).toBe(0);
  });

  it("expects only the choices the context offers to the LLM", () => {
    const offending = cases.filter((c) => {
      if (c.expected.choice === undefined) return false;
      const context = buildInterpretContext(toInterpretRequest(c, campaign), 3);
      return !context.expectedChoices.some((choice) => choice.id === c.expected.choice);
    });

    expect(offending.map((c) => c.id)).toEqual([]);
  });

  it("holds synthetic data only: no real-looking e-mail or phone number", () => {
    const text = read(path);
    expect(text).not.toMatch(/[\w.+-]+@(?!example\.)[\w-]+\.\w+/);
    expect(text).not.toMatch(/\+\d{9,}/);
  });
});

describe("the suites together", () => {
  it("cover several languages", () => {
    const languages = new Set(
      SUITES.flatMap((suite) => {
        const path = `evals/datasets/${suite}.jsonl`;
        return parseDataset(read(path), campaign, path).map((c) => c.language);
      }),
    );

    expect([...languages].sort()).toEqual(expect.arrayContaining(["ar", "en", "fr", "it"]));
  });
});
