import { parseNluConfig, requireMistralKey, type NluConfig } from "./config";
import type { LlmProvider } from "./llm-provider";
import { createMistralProvider } from "./mistral";

export interface NluServices {
  readonly provider: LlmProvider;
  readonly config: NluConfig;
}

/** The real provider, from the environment. Throws when MISTRAL_API_KEY is missing (D81). */
export function createNluServices(env: Readonly<Record<string, string | undefined>>): NluServices {
  const config = parseNluConfig(env);
  return { config, provider: createMistralProvider({ apiKey: requireMistralKey(config) }) };
}
