import type { CampaignDefinition } from "../campaigns/schema/campaign";
import type { Intent, Interpretation } from "../engine/interpretation";
import { resolveField } from "../profile/field-ref";
import type { EvalCase } from "./case";
import { valuesMatch } from "./values";

/** D93 / D52: for these intents the engine saves nothing from the patch. */
export const ENGINE_IGNORES_PATCH: ReadonlySet<Intent> = new Set([
  "opt_out",
  "delete_data",
  "edit_request",
  "help",
  "off_topic",
]);

export interface Check<T> {
  readonly expected: T;
  /** null = the NLU said nothing about it (or was unavailable). */
  readonly actual: T | null;
  readonly ok: boolean;
}

export type EditTargetValue = NonNullable<Interpretation["editTarget"]>;

export interface Checks {
  intent?: Check<string>;
  choice?: Check<string>;
  language?: Check<string>;
  completeness?: Check<string>;
  editTarget?: Check<EditTargetValue>;
}

export interface PatchScore {
  correct: string[];
  wrong: string[];
  invented: string[];
  missing: string[];
  /** Fields the engine would save. */
  extracted: number;
}

export interface ActualSummary {
  readonly intent: string;
  readonly choice: string | null;
  readonly language: string;
  readonly completeness: string;
  /** Everything the NLU returned, even what the engine would ignore. */
  readonly patch: Readonly<Record<string, unknown>>;
}

/**
 * Why the NLU gave no usable answer (E2): `unavailable` = no reply at all (D82),
 * `invalid_output` = the reply stayed invalid after the repair (D83). Either fails the case.
 */
export type NluFailure = "invalid_output" | "unavailable";

/**
 * How the calls of a case went, as counts over its runs (`evals run --repeat`, E6). With one
 * run every count is 0 or 1.
 */
export interface NluCounts {
  readonly runs: number;
  /** Runs that passed: the case passes only when this equals `runs`. */
  readonly passed: number;
  /** Runs that needed a repair call (D83), whether it worked or not. */
  readonly repaired: number;
  readonly invalidOutput: number;
  readonly unavailable: number;
  /** Runs slower than the production deadline (E3): latency, not understanding. */
  readonly overDeadline: number;
}

export interface CaseResult {
  readonly id: string;
  readonly tags: readonly string[];
  readonly language: string;
  readonly checks: Checks;
  readonly patch: PatchScore;
  readonly pass: boolean;
  /** Set when the NLU gave no usable answer (E2). */
  readonly failure: NluFailure | null;
  readonly nlu: NluCounts;
  readonly latencyMs: number;
  readonly costEstimate: number | null;
  readonly actual: ActualSummary | null;
}

/** What the runner measured around one call. */
export interface RunStats {
  readonly latencyMs: number;
  readonly costEstimate: number | null;
  /** The reply passed every check (false also when there was no reply). */
  readonly valid: boolean;
  readonly repaired: boolean;
  readonly overDeadline: boolean;
}

function check<T>(expected: T, actual: T | undefined): Check<T> {
  return { expected, actual: actual ?? null, ok: expected === actual };
}

/** The last entry for a field wins, like when the engine applies a patch in order. */
function lastWins(patch: Interpretation["patch"]): Map<string, unknown> {
  return new Map(patch.map((entry) => [entry.field, entry.value]));
}

function scoreChecks(c: EvalCase, campaign: CampaignDefinition, actual: Interpretation | null) {
  const { expected } = c;
  const checks: Checks = {};
  if (expected.intent !== undefined) checks.intent = check(expected.intent, actual?.intent);
  if (expected.choice !== undefined) checks.choice = check(expected.choice, actual?.choice);
  if (expected.language !== undefined) {
    checks.language = check(expected.language, actual?.language.code);
  }
  if (expected.completeness !== undefined) {
    checks.completeness = check(expected.completeness, actual?.currentQuestion.completeness);
  }
  if (expected.editTarget !== undefined) {
    const want = expected.editTarget;
    const got = actual?.editTarget;
    const def = resolveField(want.field, campaign.customFields);
    checks.editTarget = {
      expected: want,
      actual: got ?? null,
      ok:
        got !== undefined &&
        got.field === want.field &&
        valuesMatch(def, want.newValue, got.newValue),
    };
  }
  return checks;
}

function scorePatch(c: EvalCase, campaign: CampaignDefinition, actual: Interpretation | null) {
  const saved =
    actual && !ENGINE_IGNORES_PATCH.has(actual.intent)
      ? lastWins(actual.patch)
      : new Map<string, unknown>();
  const expected = new Map(Object.entries(c.expected.patch));
  const score: PatchScore = {
    correct: [],
    wrong: [],
    invented: [],
    missing: [],
    extracted: saved.size,
  };
  for (const [field, value] of saved) {
    if (!expected.has(field)) {
      score.invented.push(field);
    } else if (
      valuesMatch(resolveField(field, campaign.customFields), expected.get(field), value)
    ) {
      score.correct.push(field);
    } else {
      score.wrong.push(field);
    }
  }
  for (const field of expected.keys()) {
    if (!saved.has(field)) score.missing.push(field);
  }
  return score;
}

/** Every check present passed (an absent check is not asked by the case). */
function checksPass(checks: Checks): boolean {
  const { intent, choice, language, completeness, editTarget } = checks;
  return [intent?.ok, choice?.ok, language?.ok, completeness?.ok, editTarget?.ok].every(
    (ok) => ok !== false,
  );
}

/**
 * D93: judges one answer of the NLU (null = unavailable) against the case. An answer that was
 * not valid is the `unclear` fallback, not the model's reading: it always fails (E2).
 */
export function scoreCase(
  c: EvalCase,
  campaign: CampaignDefinition,
  actual: Interpretation | null,
  run: RunStats,
): CaseResult {
  const checks = scoreChecks(c, campaign, actual);
  const patch = scorePatch(c, campaign, actual);
  const failure: NluFailure | null =
    actual === null ? "unavailable" : run.valid ? null : "invalid_output";
  const pass =
    failure === null &&
    checksPass(checks) &&
    patch.wrong.length === 0 &&
    patch.invented.length === 0 &&
    patch.missing.length === 0;
  return {
    id: c.id,
    tags: c.tags,
    language: c.language,
    checks,
    patch,
    pass,
    failure,
    nlu: {
      runs: 1,
      passed: pass ? 1 : 0,
      repaired: run.repaired ? 1 : 0,
      invalidOutput: failure === "invalid_output" ? 1 : 0,
      unavailable: failure === "unavailable" ? 1 : 0,
      overDeadline: run.overDeadline ? 1 : 0,
    },
    latencyMs: run.latencyMs,
    costEstimate: run.costEstimate,
    actual: actual && {
      intent: actual.intent,
      choice: actual.choice ?? null,
      language: actual.language.code,
      completeness: actual.currentQuestion.completeness,
      patch: Object.fromEntries(lastWins(actual.patch)),
    },
  };
}
