import { assertIndependentJudge } from "../nlu/judge";
import type { NluServices } from "../nlu/services";
import { CliError, type CliDeps } from "./deps";

/** The LLM and its configuration; a missing MISTRAL_API_KEY becomes a one-line CliError. */
export function connectLlm(deps: CliDeps): NluServices {
  try {
    return deps.nlu();
  } catch (error: unknown) {
    throw new CliError(error instanceof Error ? error.message : String(error));
  }
}

/** The LLM for the evals judge, which must not be the translator (D100). */
export function connectJudgeLlm(deps: CliDeps): NluServices {
  const services = connectLlm(deps);
  try {
    assertIndependentJudge(services.config.models);
  } catch (error: unknown) {
    throw new CliError(error instanceof Error ? error.message : String(error));
  }
  return services;
}
