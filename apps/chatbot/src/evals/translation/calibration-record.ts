import { z } from "zod";
import type { Judge } from "../../nlu/judge";

/**
 * The outcome of the last `evals calibrate` for one judge model (E8), committed in
 * `evals/calibration/<model>.json`. `evals translation` trusts a judge only when its record
 * passed with the current judge prompt, on the current calibration dataset, and the judge still
 * answers as the dated model that was calibrated (an alias like `-latest` can move).
 */
export const CalibrationRecordSchema = z.object({
  version: z.literal(1),
  /** The configured judge model (NLU_JUDGE_MODEL), possibly an alias. */
  model: z.string(),
  promptVersion: z.string(),
  createdAt: z.string(),
  /** sha256 of `evals/datasets/translation-calibration.jsonl` when it was calibrated. */
  datasetHash: z.string(),
  cases: z.number(),
  judged: z.number(),
  withinOne: z.object({ fidelity: z.number(), naturalness: z.number() }),
  answeredBy: z.array(z.string()).default([]),
  /** The dated model that graded, as the provider reported it; null = none or more than one. */
  answeredModel: z.string().nullable(),
  ok: z.boolean(),
});
export type CalibrationRecord = z.infer<typeof CalibrationRecordSchema>;

export const CALIBRATION_DIR = "evals/calibration";
export const CALIBRATION_DATASET = "evals/datasets/translation-calibration.jsonl";

/** One file per judge model; anything unsafe in a file name becomes `_`. */
export function calibrationPath(model: string): string {
  return `${CALIBRATION_DIR}/${model.replace(/[^A-Za-z0-9._-]/g, "_")}.json`;
}

/** The judge `evals translation` is about to use. */
export interface ExpectedJudge {
  readonly model: string;
  readonly promptVersion: string;
  /** Hash of the calibration dataset today; null = it cannot be read. */
  readonly datasetHash: string | null;
}

export type CalibrationCheck =
  | { readonly ok: true; readonly answeredModel: string }
  | { readonly ok: false; readonly problem: string };

const problem = (text: string): CalibrationCheck => ({ ok: false, problem: text });

/** Whether the record vouches for this judge, and the dated model it vouches for. */
export function checkCalibration(text: string | null, judge: ExpectedJudge): CalibrationCheck {
  const { model, promptVersion } = judge;
  if (text === null) return problem(`no calibration for ${model}`);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return problem(`the calibration of ${model} is not valid JSON`);
  }
  const parsed = CalibrationRecordSchema.safeParse(json);
  if (!parsed.success) return problem(`the calibration of ${model} is not a calibration record`);
  const record = parsed.data;
  if (record.model !== model) return problem(`the calibration file belongs to ${record.model}`);
  if (record.promptVersion !== promptVersion) {
    return problem(
      `${model} was calibrated with ${record.promptVersion}, the judge now uses ${promptVersion}`,
    );
  }
  if (!record.ok)
    return problem(`the last calibration of ${model} (${record.createdAt}) did not pass`);
  if (judge.datasetHash === null) return problem(`cannot read ${CALIBRATION_DATASET}`);
  if (record.datasetHash !== judge.datasetHash) {
    return problem(`${model} was calibrated on another version of ${CALIBRATION_DATASET}`);
  }
  if (record.answeredModel === null) {
    return problem(`the calibration of ${model} does not name the model that graded`);
  }
  return { ok: true, answeredModel: record.answeredModel };
}

/** The judge answered as another model than the calibrated one: its grades are not trusted. */
export class JudgeDriftError extends Error {
  constructor(configured: string, answered: string, calibrated: string) {
    super(
      `the judge ${configured} answered as ${answered}, but was calibrated as ${calibrated}: run \`evals calibrate\` again`,
    );
    this.name = "JudgeDriftError";
  }
}

/**
 * E8: the model behind an alias is known only from its replies, so every grade is checked
 * against the calibrated one; the first that differs stops the run (JudgeDriftError).
 */
export function pinJudge(judge: Judge, configured: string, calibrated: string): Judge {
  return {
    score: async (input) => {
      const score = await judge.score(input);
      if (score !== null && score.model !== calibrated) {
        throw new JudgeDriftError(configured, score.model, calibrated);
      }
      return score;
    },
  };
}
