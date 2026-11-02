import type { CampaignDefinition } from "../../campaigns/schema/campaign";
import { validateCampaign } from "../../campaigns/validate";
import { CliError, type CliDeps } from "../deps";
import { formatIssues } from "../format-issues";
import { readCampaignFile } from "../read-campaign-file";

export const DEFAULT_EVAL_CAMPAIGN = "campaigns/kubri-standard.json";

export async function loadEvalCampaign(deps: CliDeps, path: string): Promise<CampaignDefinition> {
  const result = validateCampaign(await readCampaignFile(deps, path));
  if (!result.ok) {
    formatIssues(result.issues).forEach(deps.err);
    throw new CliError(`Invalid campaign: ${path}`);
  }
  return result.campaign;
}

export async function readText(deps: CliDeps, path: string): Promise<string> {
  try {
    return await deps.readFile(path);
  } catch {
    throw new CliError(`Cannot read ${path}`);
  }
}

/** "2026-10-24T10:00:00.000Z" → "2026-10-24T10-00-00-000Z", safe in a file name. */
export function stamp(deps: CliDeps): string {
  return deps.now().replace(/[:.]/g, "-");
}

/** Any error as a one-line CliError (a CliError passes through). */
export function asCliError(error: unknown, prefix = ""): CliError {
  if (error instanceof CliError) return error;
  return new CliError(`${prefix}${error instanceof Error ? error.message : String(error)}`);
}

/** `--repeat 3`: a whole number of at least 1. */
export function parsePositiveInt(name: string): (value: string) => number {
  return (value) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new CliError(`${name} must be a whole number of at least 1`);
    }
    return parsed;
  };
}

export const pct = (value: number | null): string =>
  value === null ? "—" : `${(value * 100).toFixed(1)}%`;

/** Pretty JSON for a report or a baseline file. */
export const toJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
