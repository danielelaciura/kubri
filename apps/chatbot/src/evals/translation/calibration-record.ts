import { z } from "zod";

/**
 * The outcome of the last `evals calibrate` for one judge model (E8), committed in
 * `evals/calibration/<model>.json`. `evals translation` trusts a judge only when its record
 * passed with the current judge prompt.
 */
export const CalibrationRecordSchema = z.object({
  version: z.literal(1),
  model: z.string(),
  promptVersion: z.string(),
  createdAt: z.string(),
  datasetHash: z.string(),
  cases: z.number(),
  judged: z.number(),
  withinOne: z.object({ fidelity: z.number(), naturalness: z.number() }),
  answeredBy: z.array(z.string()).default([]),
  ok: z.boolean(),
});
export type CalibrationRecord = z.infer<typeof CalibrationRecordSchema>;

export const CALIBRATION_DIR = "evals/calibration";

/** One file per judge model; anything unsafe in a file name becomes `_`. */
export function calibrationPath(model: string): string {
  return `${CALIBRATION_DIR}/${model.replace(/[^A-Za-z0-9._-]/g, "_")}.json`;
}

/** Why the record does not vouch for this judge, or null when it does. */
export function calibrationProblem(
  text: string | null,
  model: string,
  promptVersion: string,
): string | null {
  if (text === null) return `no calibration for ${model}`;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return `the calibration of ${model} is not valid JSON`;
  }
  const parsed = CalibrationRecordSchema.safeParse(json);
  if (!parsed.success) return `the calibration of ${model} is not a calibration record`;
  const record = parsed.data;
  if (record.model !== model) return `the calibration file belongs to ${record.model}`;
  if (record.promptVersion !== promptVersion) {
    return `${model} was calibrated with ${record.promptVersion}, the judge now uses ${promptVersion}`;
  }
  if (!record.ok) return `the last calibration of ${model} (${record.createdAt}) did not pass`;
  return null;
}
