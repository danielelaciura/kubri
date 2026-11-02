import { createHash } from "node:crypto";
import { z } from "zod";
import type { Comparison } from "./compare";
import type { GateResult } from "./gates";
import { MIN_CASES_PER_LANGUAGE } from "./gates";
import { computeMetrics, type Metrics } from "./metrics";
import type { CaseResult } from "./score-case";

/**
 * The part of a report that comparison and gates read. A baseline is parsed with this schema,
 * so older reports with extra fields keep working (D97).
 */
const ReportViewSchema = z.object({
  version: z.literal(1),
  meta: z.object({
    suite: z.string(),
    createdAt: z.string(),
    promptVersion: z.string(),
    datasetHash: z.string(),
  }),
  metrics: z.object({
    passRate: z.number(),
    hallucination: z.object({ rate: z.number().nullable() }),
    intent: z.object({ accuracy: z.number().nullable() }),
    language: z.object({ accuracy: z.number().nullable() }),
    nlu: z.object({
      invalidOutputRate: z.number().nullable(),
      unavailableRate: z.number().nullable(),
    }),
    byLanguage: z.record(z.string(), z.object({ passRate: z.number(), cases: z.number() })),
  }),
  cases: z.array(z.object({ id: z.string(), pass: z.boolean() })),
});
export type ReportView = z.infer<typeof ReportViewSchema>;

export function parseReport(text: string): ReportView {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("the report is not valid JSON");
  }
  const parsed = ReportViewSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `not an eval report: ${issue?.path.map(String).join(".") ?? ""}: ${issue?.message ?? ""}`,
    );
  }
  return parsed.data;
}

export interface ReportMeta {
  readonly suite: string;
  readonly createdAt: string;
  readonly promptVersion: string;
  readonly models: { readonly interpret: string; readonly fallback: string };
  readonly provider: string;
  /** sha256 of the dataset file: a changed dataset makes comparisons partial (D97). */
  readonly datasetHash: string;
  readonly campaign: string;
  /** Runs per case (`--repeat`, E6). */
  readonly repeat: number;
  /** The production NLU deadline the latencies are measured against (E3). */
  readonly deadlineMs: number;
}

export interface EvalReport {
  readonly version: 1;
  readonly meta: ReportMeta;
  readonly metrics: Metrics;
  readonly cases: readonly CaseResult[];
}

export function datasetHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function buildReport(meta: ReportMeta, results: readonly CaseResult[]): EvalReport {
  return { version: 1, meta, metrics: computeMetrics(results), cases: results };
}

const pct = (value: number | null): string =>
  value === null ? "—" : `${(value * 100).toFixed(1)}%`;
const signed = (value: number | null): string =>
  value === null ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}`;
const share = (count: number, total: number): string =>
  `${count}/${total} (${pct(total === 0 ? null : count / total)})`;

interface AnyCheck {
  readonly expected: unknown;
  readonly actual: unknown;
  readonly ok: boolean;
}

/** Strings bare (intents, codes), anything else as JSON (edit targets, null). */
const shown = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value);

function failureReason(r: CaseResult): string {
  const parts: string[] = [];
  if (r.failure === "unavailable") parts.push("NLU unavailable");
  if (r.failure === "invalid_output") parts.push("invalid output after the repair");
  const mismatch = (name: string, check: AnyCheck | undefined): void => {
    if (check && !check.ok) {
      parts.push(`${name}: expected ${shown(check.expected)}, got ${shown(check.actual)}`);
    }
  };
  // An unusable answer has nothing to compare: the reason above says it all.
  if (r.failure === null) {
    mismatch("intent", r.checks.intent);
    mismatch("choice", r.checks.choice);
    mismatch("language", r.checks.language);
    mismatch("completeness", r.checks.completeness);
    mismatch("editTarget", r.checks.editTarget);
    for (const kind of ["wrong", "invented", "missing"] as const) {
      if (r.patch[kind].length > 0) parts.push(`${kind}: ${r.patch[kind].join(", ")}`);
    }
  }
  const reason = parts.join("; ");
  return r.nlu.runs > 1 ? `${reason} · passed ${r.nlu.passed}/${r.nlu.runs} runs` : reason;
}

function confusionTable(matrix: Metrics["confusion"]): string[] {
  const rows = Object.keys(matrix).sort();
  const columns = [...new Set(rows.flatMap((row) => Object.keys(matrix[row] ?? {})))].sort();
  if (rows.length === 0) return ["_Nessun intento atteso._"];
  return [
    `| atteso \\ ottenuto | ${columns.join(" | ")} |`,
    `|---|${columns.map(() => "---").join("|")}|`,
    ...rows.map(
      (row) => `| ${row} | ${columns.map((column) => matrix[row]?.[column] ?? 0).join(" | ")} |`,
    ),
  ];
}

function languageLines(comparison: Comparison): string[] {
  const entries = Object.entries(comparison.languageDeltas);
  if (entries.length === 0) return [];
  const parts = entries.map(([language, change]) => {
    const cases = comparison.languageCases[language] ?? 0;
    const note = cases < MIN_CASES_PER_LANGUAGE ? ", informativo" : "";
    return `${language} ${signed(change)} (${cases} casi${note})`;
  });
  return [`- Lingue: ${parts.join(" · ")}`];
}

export function comparisonMarkdown(comparison: Comparison): string[] {
  const ids = (list: readonly string[]): string =>
    list.length === 0 ? "nessuno" : list.map((id) => `\`${id}\``).join(", ");
  return [
    ...(comparison.sameDataset
      ? []
      : [
          "> Attenzione: dataset diverso dal riferimento, il confronto vale solo per i casi in comune.",
          "",
        ]),
    `- Casi superati: ${signed(comparison.passRateDelta)} punti`,
    `- Invenzioni: ${signed(comparison.hallucinationRateDelta)} punti · intento: ${signed(comparison.intentAccuracyDelta)} punti`,
    ...languageLines(comparison),
    `- Migliorati: ${ids(comparison.improved)}`,
    `- **Peggiorati:** ${ids(comparison.worsened)}`,
    `- Nuovi: ${ids(comparison.added)} · rimossi: ${ids(comparison.removed)} · invariati: ${comparison.unchanged}`,
  ];
}

export function gateLine(g: GateResult): string {
  return `${g.skipped ? "◌" : g.ok ? "✓" : "✗"} ${g.name}: ${g.detail}`;
}

export function reportToMarkdown(
  report: EvalReport,
  comparison?: Comparison,
  gates: readonly GateResult[] = [],
): string {
  const { meta, metrics: m } = report;
  const lines: string[] = [
    `# Evals · ${meta.suite}`,
    "",
    `- Data: ${meta.createdAt}`,
    `- Prompt: ${meta.promptVersion} · modello: ${meta.models.interpret} (riserva: ${meta.models.fallback}) · provider: ${meta.provider}`,
    `- Dataset: ${meta.datasetHash.slice(0, 12)} · campagna: ${meta.campaign}`,
    `- Ripetizioni per caso: ${meta.repeat} · scadenza NLU: ${meta.deadlineMs} ms`,
    "",
    "## Esito",
    "",
    "| Casi superati | Intento | Scelta | Lingua | Completezza | Invenzioni | Latenza media | Costo |",
    "|---|---|---|---|---|---|---|---|",
    `| ${share(m.passed, m.cases)} | ${pct(m.intent.accuracy)} | ${pct(m.choice.accuracy)} | ${pct(m.language.accuracy)} | ${pct(m.completeness.accuracy)} | ${pct(m.hallucination.rate)} (${m.hallucination.invented}/${m.hallucination.extracted}) | ${Math.round(m.avgLatencyMs)} ms | ${m.totalCost === null ? "—" : m.totalCost.toFixed(4)} |`,
    "",
    "## Chiamate",
    "",
    "| Output non validi | Riparazioni | Non disponibile | Oltre la scadenza | Casi instabili |",
    "|---|---|---|---|---|",
    `| ${share(m.nlu.invalidOutput, m.nlu.runs)} | ${share(m.nlu.repaired, m.nlu.runs)} | ${m.nlu.unavailable} | ${m.nlu.overDeadline} | ${m.nlu.unstable} |`,
    "",
  ];
  if (gates.length > 0) {
    lines.push("## Soglie", "", ...gates.map((g) => `- ${gateLine(g)}`), "");
  }
  lines.push("## Matrice di confusione degli intenti", "", ...confusionTable(m.confusion), "");
  lines.push(
    "## Campi",
    "",
    "| Campo | Attesi | Estratti | Precisione | Richiamo | Inventati |",
    "|---|---|---|---|---|---|",
  );
  for (const [field, f] of Object.entries(m.fields)) {
    lines.push(
      `| ${field} | ${f.expected} | ${f.extracted} | ${pct(f.precision)} | ${pct(f.recall)} | ${f.invented} |`,
    );
  }
  lines.push("", "## Per lingua", "", "| Lingua | Casi | Superati |", "|---|---|---|");
  for (const [language, g] of Object.entries(m.byLanguage)) {
    lines.push(`| ${language} | ${g.cases} | ${pct(g.passRate)} |`);
  }
  lines.push("", "## Per etichetta", "", "| Etichetta | Casi | Superati |", "|---|---|---|");
  for (const [tag, g] of Object.entries(m.byTag)) {
    lines.push(`| ${tag} | ${g.cases} | ${pct(g.passRate)} |`);
  }
  const failed = report.cases.filter((r) => !r.pass);
  lines.push("", `## Casi falliti (${failed.length})`, "");
  if (failed.length === 0) lines.push("Nessuno.");
  for (const r of failed) lines.push(`- \`${r.id}\` (${r.language}) — ${failureReason(r)}`);
  if (comparison) {
    lines.push("", "## Confronto con il riferimento", "", ...comparisonMarkdown(comparison));
  }
  return `${lines.join("\n")}\n`;
}
