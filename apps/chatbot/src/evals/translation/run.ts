import { samePlaceholders } from "../../i18n/template";
import type { Translator } from "../../i18n/translator";
import type { Judge } from "../../nlu/judge";
import type { TranslationCase } from "./case";

/** D100: a critical text must be perfectly faithful, the others good enough. */
const MIN_NATURALNESS = 4;
const MIN_FIDELITY = 4;
const MIN_CRITICAL_FIDELITY = 5;

export interface TranslationResult {
  readonly id: string;
  readonly tags: readonly string[];
  readonly language: string;
  readonly kind: TranslationCase["kind"];
  readonly status: "ok" | "translator_failed" | "judge_failed";
  readonly translation: string | null;
  /** The model that translated (the fallback model, if the primary failed). */
  readonly translatedBy: string | null;
  /** Deterministic, checked before and apart from the judge. */
  readonly placeholdersOk: boolean;
  readonly fidelity: number | null;
  readonly naturalness: number | null;
  readonly issues: readonly string[];
  /** The model that graded, as the provider reported it (E8). */
  readonly judgedBy: string | null;
  readonly pass: boolean;
}

const UNGRADED = { fidelity: null, naturalness: null, issues: [], judgedBy: null } as const;

/** One case at a time, like the interpret suites (D96). */
export async function runTranslationCases(
  cases: readonly TranslationCase[],
  translator: Translator,
  judge: Judge,
): Promise<TranslationResult[]> {
  const results: TranslationResult[] = [];
  for (const c of cases) {
    const base = { id: c.id, tags: c.tags, language: c.language, kind: c.kind };
    let translation: string;
    let translatedBy: string;
    try {
      ({ text: translation, model: translatedBy } = await translator.translate({
        text: c.text,
        sourceLanguage: "it",
        targetLanguage: c.language,
        kind: c.kind,
      }));
    } catch {
      results.push({
        ...base,
        ...UNGRADED,
        status: "translator_failed",
        translation: null,
        translatedBy: null,
        placeholdersOk: false,
        pass: false,
      });
      continue;
    }
    const placeholdersOk = samePlaceholders(c.text, translation);
    const score = await judge.score({
      source: c.text,
      translation,
      language: c.language,
      kind: c.kind,
    });
    if (!score) {
      results.push({
        ...base,
        ...UNGRADED,
        status: "judge_failed",
        translation,
        translatedBy,
        placeholdersOk,
        pass: false,
      });
      continue;
    }
    const minFidelity = c.kind === "critical" ? MIN_CRITICAL_FIDELITY : MIN_FIDELITY;
    results.push({
      ...base,
      status: "ok",
      translation,
      translatedBy,
      placeholdersOk,
      fidelity: score.fidelity,
      naturalness: score.naturalness,
      issues: score.issues,
      judgedBy: score.model,
      pass: placeholdersOk && score.fidelity >= minFidelity && score.naturalness >= MIN_NATURALNESS,
    });
  }
  return results;
}

export interface TranslationGroup {
  readonly cases: number;
  readonly passed: number;
  readonly passRate: number;
  readonly meanFidelity: number | null;
  readonly meanNaturalness: number | null;
}

export interface TranslationSummary {
  readonly cases: number;
  readonly passed: number;
  readonly passRate: number;
  readonly placeholderFailures: number;
  /** Cases with no translation at all (`translator_failed`): `evals translation` exits 1. */
  readonly translatorFailures: number;
  /** The models that actually answered, sorted (E8). */
  readonly answeredBy: { readonly translate: readonly string[]; readonly judge: readonly string[] };
  readonly byLanguage: Readonly<Record<string, TranslationGroup>>;
  readonly byKind: Readonly<Record<string, TranslationGroup>>;
}

const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;

function group(results: readonly TranslationResult[]): TranslationGroup {
  const passed = results.filter((r) => r.pass).length;
  return {
    cases: results.length,
    passed,
    passRate: results.length === 0 ? 0 : passed / results.length,
    meanFidelity: mean(results.flatMap((r) => (r.fidelity === null ? [] : [r.fidelity]))),
    meanNaturalness: mean(results.flatMap((r) => (r.naturalness === null ? [] : [r.naturalness]))),
  };
}

function split(
  results: readonly TranslationResult[],
  keyOf: (r: TranslationResult) => string,
): Record<string, TranslationGroup> {
  const keys = [...new Set(results.map(keyOf))].sort();
  return Object.fromEntries(
    keys.map((key) => [key, group(results.filter((r) => keyOf(r) === key))]),
  );
}

const distinct = (values: readonly (string | null)[]): string[] =>
  [...new Set(values.filter((v): v is string => v !== null))].sort();

export function summarizeTranslation(results: readonly TranslationResult[]): TranslationSummary {
  const all = group(results);
  return {
    cases: all.cases,
    passed: all.passed,
    passRate: all.passRate,
    placeholderFailures: results.filter(
      (r) => r.status !== "translator_failed" && !r.placeholdersOk,
    ).length,
    translatorFailures: results.filter((r) => r.status === "translator_failed").length,
    answeredBy: {
      translate: distinct(results.map((r) => r.translatedBy)),
      judge: distinct(results.map((r) => r.judgedBy)),
    },
    byLanguage: split(results, (r) => r.language),
    byKind: split(results, (r) => r.kind),
  };
}

/** What a translation report says about the run besides the results. */
export interface TranslationRunHeader {
  readonly translateModel: string;
  readonly judgeModel: string;
  readonly judgePromptVersion: string;
  /** E8: `uncalibrated` only with an explicit `--uncalibrated`. */
  readonly calibration: "calibrated" | "uncalibrated";
}

const fixed = (v: number | null): string => (v === null ? "—" : v.toFixed(2));
const models = (list: readonly string[]): string =>
  list.length === 0 ? "nessuno" : list.join(", ");

function failureLine(r: TranslationResult): string {
  const placeholders = r.placeholdersOk ? "" : "; segnaposto non conservati";
  const issues = r.issues.length > 0 ? `; ${r.issues.join("; ")}` : "";
  return `- \`${r.id}\` (${r.language}, ${r.kind}) — ${r.status}; fedeltà ${r.fidelity ?? "—"}, naturalezza ${r.naturalness ?? "—"}${placeholders}${issues}`;
}

export function translationReportToMarkdown(
  header: TranslationRunHeader,
  summary: TranslationSummary,
  results: readonly TranslationResult[],
): string {
  const table = (title: string, groups: TranslationSummary["byLanguage"]): string[] => [
    `## ${title}`,
    "",
    "| | Casi | Superati | Fedeltà | Naturalezza |",
    "|---|---|---|---|---|",
    ...Object.entries(groups).map(
      ([key, g]) =>
        `| ${key} | ${g.cases} | ${g.passed} | ${fixed(g.meanFidelity)} | ${fixed(g.meanNaturalness)} |`,
    ),
    "",
  ];
  const failed = results.filter((r) => !r.pass);
  return `${[
    "# Evals · translation",
    "",
    ...(header.calibration === "uncalibrated"
      ? ["> **Giudice NON TARATO** (`--uncalibrated`): i voti non sono affidabili.", ""]
      : []),
    `- Traduttore: ${header.translateModel} (risposte da ${models(summary.answeredBy.translate)}) · giudice: ${header.judgeModel} (${header.judgePromptVersion}, risposte da ${models(summary.answeredBy.judge)})`,
    `- Superati: ${summary.passed}/${summary.cases} · segnaposto persi: ${summary.placeholderFailures} · traduzioni non riuscite: ${summary.translatorFailures}`,
    "",
    ...table("Per lingua", summary.byLanguage),
    ...table("Per tipo", summary.byKind),
    `## Casi falliti (${failed.length})`,
    "",
    ...(failed.length === 0 ? ["Nessuno."] : failed.map(failureLine)),
  ].join("\n")}\n`;
}
