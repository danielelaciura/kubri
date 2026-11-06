import type { Command } from "commander";
import { parseJsonl } from "../../evals/jsonl";
import { datasetHash } from "../../evals/report";
import {
  calibrate,
  CalibrationCaseSchema,
  MIN_AGREEMENT,
} from "../../evals/translation/calibration";
import {
  CALIBRATION_DATASET,
  calibrationPath,
  type CalibrationRecord,
} from "../../evals/translation/calibration-record";
import { REAL_TIMING } from "../../nlu/call-policy";
import { createLlmJudge } from "../../nlu/judge";
import { JUDGE_PROMPT_VERSION } from "../../nlu/prompts/judge-v1";
import { CliError, type CliDeps } from "../deps";
import { connectJudgeLlm } from "../llm";
import { asCliError, pct, readText, toJson } from "./evals-shared";

const fixed = (v: number | null): string => (v === null ? "—" : v.toFixed(2));

async function runCalibration(deps: CliDeps): Promise<void> {
  const path = CALIBRATION_DATASET;
  const text = await readText(deps, path);
  let cases;
  try {
    cases = parseJsonl(text, path, CalibrationCaseSchema);
  } catch (error: unknown) {
    throw asCliError(error);
  }
  const { config, provider } = connectJudgeLlm(deps);
  const model = config.models.judge;
  const judge = createLlmJudge({
    provider,
    model,
    timeoutMs: config.timeoutMs,
    timing: REAL_TIMING,
  });

  const report = await calibrate(cases, judge);
  // E8: the outcome is kept, pass or fail: `evals translation` reads it before trusting the judge.
  const record: CalibrationRecord = {
    version: 1,
    model,
    promptVersion: JUDGE_PROMPT_VERSION,
    createdAt: deps.now(),
    datasetHash: datasetHash(text),
    cases: report.cases,
    judged: report.judged,
    withinOne: report.withinOne,
    answeredBy: [...report.answeredBy],
    answeredModel: report.answeredBy.length === 1 ? (report.answeredBy[0] ?? null) : null,
    ok: report.ok,
  };
  await deps.writeFile(calibrationPath(model), toJson(record));

  const answered = report.answeredBy.length === 0 ? "none" : report.answeredBy.join(", ");
  deps.out(
    `judge ${model} (${JUDGE_PROMPT_VERSION}, answered by ${answered}): ${report.judged}/${report.cases} cases graded`,
  );
  deps.out(
    `within ±1: fidelity ${pct(report.withinOne.fidelity)} · naturalness ${pct(report.withinOne.naturalness)} (min ${pct(MIN_AGREEMENT)})`,
  );
  deps.out(
    `mean error: fidelity ${fixed(report.meanAbsError.fidelity)} · naturalness ${fixed(report.meanAbsError.naturalness)}`,
  );
  deps.out(
    `bias (+ = too generous): fidelity ${fixed(report.bias.fidelity)} · naturalness ${fixed(report.bias.naturalness)}`,
  );
  for (const d of report.disagreements) {
    deps.out(`  ✗ ${d.id} ${d.dimension}: person ${d.human}, judge ${d.judge ?? "none"}`);
  }
  deps.out(`calibration saved: ${calibrationPath(model)}`);
  if (!report.ok) throw new CliError("The judge is not calibrated: do not trust its grades");
}

export function registerCalibrateCommand(evals: Command, deps: CliDeps): void {
  evals
    .command("calibrate")
    .description("Check the translation judge against the grades given by a person")
    .action(() => runCalibration(deps));
}
