import { describe, expect, it } from "vitest";
import { CliError } from "../../../src/cli/deps";
import { createProgram } from "../../../src/cli/program";
import { calibrationProblem } from "../../../src/evals/translation/calibration-record";
import { FakeLlmProvider } from "../../../src/nlu/fake-provider";
import { fakeCli } from "./fake-deps";

const LINE = JSON.stringify({
  id: "a",
  language: "en",
  kind: "system",
  source: "Fatto.",
  translation: "Done.",
  human: { fidelity: 5, naturalness: 5 },
});
const RECORD = "evals/calibration/mistral-large-latest.json";

async function calibrate(reply: string) {
  const cli = fakeCli(
    { "evals/datasets/translation-calibration.jsonl": `${LINE}\n` },
    "test",
    [],
    new FakeLlmProvider([reply]),
  );
  let error: unknown;
  try {
    await createProgram(cli.deps).parseAsync(["node", "kubri-bot", "evals", "calibrate"]);
  } catch (e: unknown) {
    error = e;
  }
  return { ...cli, error };
}

describe("evals calibrate", () => {
  it("prints the agreement, saves a passing record and succeeds when the judge agrees", async () => {
    const { stdout, error, written } = await calibrate(
      '{"fidelity":5,"naturalness":4,"issues":[]}',
    );

    expect(error).toBeUndefined();
    expect(stdout.join("\n")).toContain("within ±1: fidelity 100.0% · naturalness 100.0%");
    expect(JSON.parse(written[RECORD] ?? "null")).toMatchObject({
      version: 1,
      model: "mistral-large-latest",
      promptVersion: "judge-v1",
      cases: 1,
      ok: true,
      answeredBy: ["mistral-large-latest"],
    });
    expect(
      calibrationProblem(written[RECORD] ?? null, "mistral-large-latest", "judge-v1"),
    ).toBeNull();
  });

  it("fails, and records the failure, when the judge does not agree (E8)", async () => {
    const { error, written } = await calibrate('{"fidelity":1,"naturalness":1,"issues":[]}');

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toMatch(/not calibrated/);
    expect(JSON.parse(written[RECORD] ?? "null")).toMatchObject({ ok: false });
    expect(calibrationProblem(written[RECORD] ?? null, "mistral-large-latest", "judge-v1")).toMatch(
      /did not pass/,
    );
  });
});
