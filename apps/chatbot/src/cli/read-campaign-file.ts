import { CliError, type CliDeps } from "./deps";

export async function readCampaignFile(deps: CliDeps, path: string): Promise<unknown> {
  let text: string;
  try {
    text = await deps.readFile(path);
  } catch {
    throw new CliError(`Cannot read ${path}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliError(`${path} is not valid JSON: ${detail}`);
  }
}
