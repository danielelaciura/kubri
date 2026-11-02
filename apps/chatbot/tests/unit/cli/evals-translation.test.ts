import { describe, expect, it } from "vitest";
import { CliError } from "../../../src/cli/deps";
import { createProgram } from "../../../src/cli/program";
import { FakeLlmProvider } from "../../../src/nlu/fake-provider";
import { datasetHash } from "../../../src/evals/report";
import { fakeCli } from "./fake-deps";

const DATASET = `${JSON.stringify({
  id: "progress-en",
  language: "en",
  kind: "system",
  text: "Sezione {current} di {total}",
})}\n`;
const CALIBRATION = "evals/calibration/mistral-large-latest.json";
const CALIBRATION_DATASET = "evals/datasets/translation-calibration.jsonl";
const CALIBRATION_LINES = '{"id":"a"}\n';
const record = (
  ok: boolean,
  overrides: { promptVersion?: string; datasetHash?: string; answeredModel?: string } = {},
): string =>
  JSON.stringify({
    version: 1,
    model: "mistral-large-latest",
    promptVersion: overrides.promptVersion ?? "judge-v1",
    createdAt: "2026-10-24T09:00:00.000Z",
    datasetHash: overrides.datasetHash ?? datasetHash(CALIBRATION_LINES),
    cases: 7,
    judged: 7,
    withinOne: { fidelity: ok ? 1 : 0.5, naturalness: 1 },
    answeredBy: [overrides.answeredModel ?? "mistral-large-latest"],
    answeredModel: overrides.answeredModel ?? "mistral-large-latest",
    ok,
  });
const REPLIES = [
  '{"text":"Section {current} of {total}"}',
  '{"fidelity":5,"naturalness":5,"issues":[]}',
];

async function run(files: Record<string, string>, args: string[] = []) {
  const llm = new FakeLlmProvider(REPLIES);
  const cli = fakeCli(
    {
      "evals/datasets/translation.jsonl": DATASET,
      [CALIBRATION_DATASET]: CALIBRATION_LINES,
      ...files,
    },
    "test",
    [],
    llm,
  );
  let error: unknown;
  try {
    await createProgram(cli.deps).parseAsync([
      "node",
      "kubri-bot",
      "evals",
      "translation",
      ...args,
    ]);
  } catch (e: unknown) {
    error = e;
  }
  return { ...cli, llm, error };
}

const reportJson = (written: Record<string, string>): unknown =>
  JSON.parse(Object.entries(written).find(([path]) => path.endsWith(".json"))?.[1] ?? "null");

describe("evals translation", () => {
  it("translates with the LLM, judges with the judge model, and writes the report", async () => {
    const { llm, written, stdout, error } = await run({ [CALIBRATION]: record(true) });

    expect(error).toBeUndefined();
    expect(llm.requests.map((r) => r.model)).toEqual([
      "mistral-small-latest",
      "mistral-large-latest",
    ]);
    expect(Object.keys(written).sort()).toEqual([
      expect.stringMatching(/^evals\/reports\/translation-[\dT-]+Z\.json$/),
      expect.stringMatching(/^evals\/reports\/translation-[\dT-]+Z\.md$/),
    ]);
    expect(reportJson(written)).toMatchObject({
      judgeModel: "mistral-large-latest",
      judgePromptVersion: "judge-v1",
      calibration: "calibrated",
      summary: { answeredBy: { judge: ["mistral-large-latest"] } },
    });
    expect(stdout.join("\n")).toContain("1/1 translations passed");
  });

  it.each([
    ["no calibration", {}],
    ["a failed calibration", { [CALIBRATION]: record(false) }],
    [
      "a calibration of another judge prompt",
      { [CALIBRATION]: record(true, { promptVersion: "judge-v0" }) },
    ],
    [
      "a calibration on another calibration dataset",
      { [CALIBRATION]: record(true, { datasetHash: datasetHash("older lines\n") }) },
    ],
    ["an unreadable calibration", { [CALIBRATION]: "{ nope" }],
  ])("refuses to run with %s (E8)", async (_name, files) => {
    const { error, llm } = await run(files);

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toMatch(/evals calibrate/);
    expect((error as CliError).message).toMatch(/--uncalibrated/);
    expect(llm.requests).toHaveLength(0);
  });

  it("aborts after the first grade when the judge answers as another model than calibrated (E8)", async () => {
    const { error, llm, written } = await run({
      [CALIBRATION]: record(true, { answeredModel: "mistral-large-2411" }),
    });

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toMatch(
      /answered as mistral-large-latest.*calibrated.*mistral-large-2411.*evals calibrate/,
    );
    expect(llm.requests).toHaveLength(2);
    expect(written).toEqual({});
  });

  it("runs an uncalibrated judge on request, and records it in the report (E8)", async () => {
    const { error, written, stdout } = await run({}, ["--uncalibrated"]);

    expect(error).toBeUndefined();
    expect(reportJson(written)).toMatchObject({ calibration: "uncalibrated" });
    expect(stdout.join("\n")).toContain("the judge is not calibrated");
  });

  it("refuses a judge that is also the translator (D100)", async () => {
    const llm = new FakeLlmProvider(REPLIES);
    const cli = fakeCli({ "evals/datasets/translation.jsonl": DATASET }, "test", [], llm);
    const deps = {
      ...cli.deps,
      nlu: () => {
        const services = cli.deps.nlu();
        return {
          ...services,
          config: {
            ...services.config,
            models: { ...services.config.models, judge: services.config.models.translate },
          },
        };
      },
    };

    await expect(
      createProgram(deps).parseAsync(["node", "kubri-bot", "evals", "translation"]),
    ).rejects.toThrow(/NLU_JUDGE_MODEL must differ/);
  });
});
