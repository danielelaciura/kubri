import type { Command } from "commander";
import { parseJsonl } from "../../evals/jsonl";
import { datasetHash } from "../../evals/report";
import {
  CALIBRATION_DATASET,
  calibrationPath,
  checkCalibration,
  JudgeDriftError,
  pinJudge,
} from "../../evals/translation/calibration-record";
import { TranslationCaseSchema } from "../../evals/translation/case";
import {
  runTranslationCases,
  summarizeTranslation,
  translationReportToMarkdown,
  type TranslationRunHeader,
} from "../../evals/translation/run";
import { REAL_TIMING } from "../../nlu/call-policy";
import { createLlmJudge } from "../../nlu/judge";
import { JUDGE_PROMPT_VERSION } from "../../nlu/prompts/judge-v1";
import { NOOP_TRACE_SINK } from "../../nlu/trace";
import { createLlmTranslator } from "../../nlu/translate";
import { CliError, type CliDeps } from "../deps";
import { connectJudgeLlm } from "../llm";
import { registerCalibrateCommand } from "./evals-calibrate";
import { asCliError, readText, stamp, toJson } from "./evals-shared";

async function readOptional(deps: CliDeps, path: string): Promise<string | null> {
  try {
    return await deps.readFile(path);
  } catch {
    return null;
  }
}

interface TranslationOptions {
  readonly out: string;
  readonly uncalibrated: boolean;
}

async function runTranslation(deps: CliDeps, options: TranslationOptions): Promise<void> {
  const path = "evals/datasets/translation.jsonl";
  const text = await readText(deps, path);
  let cases;
  try {
    cases = parseJsonl(text, path, TranslationCaseSchema);
  } catch (error: unknown) {
    throw asCliError(error);
  }
  const { config, provider } = connectJudgeLlm(deps);
  const judgeModel = config.models.judge;

  // E8: grades from a judge nobody checked are not a measurement, unless asked explicitly.
  const recordPath = calibrationPath(judgeModel);
  const calibrationLines = await readOptional(deps, CALIBRATION_DATASET);
  const calibration = checkCalibration(await readOptional(deps, recordPath), {
    model: judgeModel,
    promptVersion: JUDGE_PROMPT_VERSION,
    datasetHash: calibrationLines === null ? null : datasetHash(calibrationLines),
  });
  const problem = calibration.ok ? null : calibration.problem;
  if (problem !== null && !options.uncalibrated) {
    throw new CliError(
      `${problem} (${recordPath}): run \`evals calibrate\` first, or pass --uncalibrated to grade anyway`,
    );
  }
  if (problem !== null) deps.out(`warning: the judge is not calibrated (${problem})`);

  const translator = createLlmTranslator({
    provider,
    config,
    traces: NOOP_TRACE_SINK,
    timing: REAL_TIMING,
    now: deps.now,
  });
  const llmJudge = createLlmJudge({
    provider,
    model: judgeModel,
    timeoutMs: config.timeoutMs,
    timing: REAL_TIMING,
  });
  // E8: a calibrated judge must keep answering as the dated model that was calibrated.
  const judge = calibration.ok
    ? pinJudge(llmJudge, judgeModel, calibration.answeredModel)
    : llmJudge;

  let results;
  try {
    results = await runTranslationCases(cases, translator, judge);
  } catch (error: unknown) {
    if (error instanceof JudgeDriftError) throw new CliError(error.message);
    throw error;
  }
  const summary = summarizeTranslation(results);
  const header: TranslationRunHeader = {
    translateModel: config.models.translate,
    judgeModel,
    judgePromptVersion: JUDGE_PROMPT_VERSION,
    calibration: problem === null ? "calibrated" : "uncalibrated",
  };
  const base = `${options.out}/translation-${stamp(deps)}`;
  await deps.writeFile(
    `${base}.json`,
    toJson({ version: 1, createdAt: deps.now(), ...header, summary, cases: results }),
  );
  await deps.writeFile(`${base}.md`, translationReportToMarkdown(header, summary, results));
  deps.out(
    `${summary.passed}/${summary.cases} translations passed · placeholders lost: ${summary.placeholderFailures}`,
  );
  deps.out(`report: ${base}.md`);
  if (summary.placeholderFailures > 0) {
    throw new CliError("Gates failed: a translation lost its placeholders");
  }
}

export function registerTranslationEvalCommands(evals: Command, deps: CliDeps): void {
  evals
    .command("translation")
    .description("Translate the dataset with the LLM and grade it with the judge model")
    .option("--out <dir>", "where reports are written", "evals/reports")
    .option("--uncalibrated", "grade even if the judge's last calibration did not pass", false)
    .action((options: TranslationOptions) => runTranslation(deps, options));

  registerCalibrateCommand(evals, deps);
}
