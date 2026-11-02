import { Option, type Command } from "commander";
import type { CampaignDefinition } from "../../campaigns/schema/campaign";
import { parseDataset, type EvalCase } from "../../evals/case";
import { compareReports } from "../../evals/compare";
import { evaluateGates, type GateResult } from "../../evals/gates";
import {
  buildReport,
  comparisonMarkdown,
  datasetHash,
  gateLine,
  parseReport,
  reportToMarkdown,
  type EvalReport,
  type ReportView,
} from "../../evals/report";
import { runCases } from "../../evals/runner";
import { REAL_TIMING } from "../../nlu/call-policy";
import { interpretContext } from "../../nlu/interpret";
import {
  DEFAULT_INTERPRET_PROMPT,
  interpretPromptFor,
  type InterpretPrompt,
} from "../../nlu/prompts";
import { NOOP_TRACE_SINK } from "../../nlu/trace";
import { parseRuntimeConfig } from "../../runtime/config";
import { CliError, type CliDeps } from "../deps";
import { connectLlm } from "../llm";
import {
  asCliError,
  DEFAULT_EVAL_CAMPAIGN,
  loadEvalCampaign,
  parsePositiveInt,
  pct,
  readText,
  stamp,
  toJson,
} from "./evals-shared";
import { registerTranslationEvalCommands } from "./evals-translation";

export const SUITES = ["extraction", "intent", "choice", "language"] as const;
type Suite = (typeof SUITES)[number];

interface RunOptions {
  readonly suite: Suite;
  readonly campaign: string;
  readonly prompt?: string;
  readonly model?: string;
  readonly baseline?: string;
  readonly out: string;
  readonly repeat: number;
  readonly saveBaseline: boolean;
  readonly forceBaseline: boolean;
}

const baselinePath = (suite: string): string => `evals/baselines/${suite}.json`;

async function readBaseline(deps: CliDeps, options: RunOptions): Promise<ReportView | null> {
  const explicit = options.baseline !== undefined;
  const path = options.baseline ?? baselinePath(options.suite);
  let text: string;
  try {
    text = await deps.readFile(path);
  } catch {
    if (explicit) throw new CliError(`Cannot read ${path}`);
    return null;
  }
  try {
    const view = parseReport(text);
    deps.out(`baseline: ${path}`);
    return view;
  } catch (error: unknown) {
    throw asCliError(error, `${path}: `);
  }
}

function summary(report: EvalReport, gates: readonly GateResult[]): string[] {
  const { metrics: m } = report;
  return [
    `${report.meta.suite}: ${m.passed}/${m.cases} cases passed (${pct(m.passRate)})`,
    `intent ${pct(m.intent.accuracy)} · hallucination ${pct(m.hallucination.rate)} · ${Math.round(m.avgLatencyMs)} ms/case`,
    `calls: ${m.nlu.runs} · invalid output ${pct(m.nlu.invalidOutputRate)} · repaired ${pct(m.nlu.repairRate)} · over the ${report.meta.deadlineMs} ms deadline ${m.nlu.overDeadline} · unstable cases ${m.nlu.unstable}`,
    ...gates.map(gateLine),
  ];
}

function selectPrompt(version: string | undefined): InterpretPrompt {
  if (version === undefined) return DEFAULT_INTERPRET_PROMPT;
  try {
    return interpretPromptFor(version);
  } catch (error: unknown) {
    throw asCliError(error);
  }
}

/** E3: the deadline production applies to the NLU (TURN_NLU_DEADLINE_MS). */
function productionDeadlineMs(): number {
  try {
    return parseRuntimeConfig(process.env).nluDeadlineMs;
  } catch (error: unknown) {
    throw asCliError(error);
  }
}

async function loadCases(
  deps: CliDeps,
  suite: Suite,
  campaign: CampaignDefinition,
): Promise<{ readonly cases: EvalCase[]; readonly hash: string }> {
  const path = `evals/datasets/${suite}.jsonl`;
  const text = await readText(deps, path);
  try {
    return { cases: parseDataset(text, campaign, path), hash: datasetHash(text) };
  } catch (error: unknown) {
    throw asCliError(error);
  }
}

async function runSuite(deps: CliDeps, options: RunOptions): Promise<void> {
  const campaign = await loadEvalCampaign(deps, options.campaign);
  const { cases, hash } = await loadCases(deps, options.suite, campaign);
  const prompt = selectPrompt(options.prompt);
  const deadlineMs = productionDeadlineMs();
  const services = connectLlm(deps);
  // D99: the candidate is a prompt and a model; the fallback model stays the configured one.
  const config = options.model
    ? { ...services.config, models: { ...services.config.models, interpret: options.model } }
    : services.config;
  // The traces come back with each result (cost); nothing is stored.
  const task = {
    provider: services.provider,
    config,
    traces: NOOP_TRACE_SINK,
    timing: REAL_TIMING,
    now: deps.now,
  };

  const results = await runCases({
    cases,
    campaign,
    interpret: (request) => interpretContext(request, task, prompt),
    historyMessages: config.historyMessages,
    clock: () => performance.now(),
    deadlineMs,
    repeat: options.repeat,
  });
  const report = buildReport(
    {
      suite: options.suite,
      createdAt: deps.now(),
      promptVersion: prompt.version,
      models: { interpret: config.models.interpret, fallback: config.models.fallback },
      provider: services.provider.name,
      datasetHash: hash,
      campaign: options.campaign,
      repeat: options.repeat,
      deadlineMs,
    },
    results,
  );

  const baseline = await readBaseline(deps, options);
  const view = parseReport(JSON.stringify(report));
  const comparison = baseline ? compareReports(baseline, view) : null;
  const gates = evaluateGates(view, comparison);
  const failed = gates.some((g) => !g.ok);

  const base = `${options.out}/${options.suite}-${stamp(deps)}`;
  await deps.writeFile(`${base}.json`, toJson(report));
  await deps.writeFile(`${base}.md`, reportToMarkdown(report, comparison ?? undefined, gates));
  summary(report, gates).forEach(deps.out);
  deps.out(`report: ${base}.md`);
  // E5: a baseline is a run that passed the gates, unless a worse one is accepted on purpose.
  if (options.forceBaseline || (options.saveBaseline && !failed)) {
    await deps.writeFile(baselinePath(options.suite), toJson(report));
    deps.out(`baseline saved: ${baselinePath(options.suite)}`);
  } else if (options.saveBaseline) {
    deps.out("baseline not saved: the gates failed (use --force-baseline to accept this run)");
  }
  if (failed) throw new CliError("Gates failed: do not merge this change");
}

async function readReport(deps: CliDeps, path: string): Promise<ReportView> {
  const text = await readText(deps, path);
  try {
    return parseReport(text);
  } catch (error: unknown) {
    throw asCliError(error, `${path}: `);
  }
}

export function registerEvalsCommands(program: Command, deps: CliDeps): void {
  const evals = program.command("evals").description("Measure the quality of the NLU (spec §15)");

  evals
    .command("run")
    .description("Run a suite on the real LLM and compare it with the saved baseline")
    .addOption(
      new Option("--suite <name>", "dataset in evals/datasets")
        .choices(SUITES)
        .makeOptionMandatory(),
    )
    .option("--campaign <file>", "campaign the cases run on", DEFAULT_EVAL_CAMPAIGN)
    .option(
      "--prompt <version>",
      `interpret prompt version (default ${DEFAULT_INTERPRET_PROMPT.version})`,
    )
    .option("--model <name>", "interpret model (default NLU_INTERPRET_MODEL)")
    .option("--baseline <file>", "report to compare with (default evals/baselines/<suite>.json)")
    .option("--out <dir>", "where reports are written", "evals/reports")
    .option(
      "--repeat <n>",
      "runs per case: a case passes only if every run passes",
      parsePositiveInt("--repeat"),
      1,
    )
    .option("--save-baseline", "save this run as the baseline if the gates pass", false)
    .option("--force-baseline", "save this run as the baseline even if the gates fail", false)
    .action((options: RunOptions) => runSuite(deps, options));

  evals
    .command("compare")
    .description("Compare two saved reports case by case")
    .argument("<baseline>", "report JSON")
    .argument("<candidate>", "report JSON")
    .action(async (baselineFile: string, candidateFile: string) => {
      const base = await readReport(deps, baselineFile);
      const candidate = await readReport(deps, candidateFile);
      comparisonMarkdown(compareReports(base, candidate)).forEach(deps.out);
    });

  registerTranslationEvalCommands(evals, deps);
}
