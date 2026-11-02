import { INTERPRET_PROMPT_VERSION, INTERPRET_SYSTEM_PROMPT } from "./interpret-v1";

export interface InterpretPrompt {
  readonly version: string;
  readonly system: string;
}

const INTERPRET_V1: InterpretPrompt = {
  version: INTERPRET_PROMPT_VERSION,
  system: INTERPRET_SYSTEM_PROMPT,
};

/** Released versions: a new prompt file adds one line here, evals pick it with --prompt. */
export const INTERPRET_PROMPTS: Readonly<Record<string, InterpretPrompt>> = {
  [INTERPRET_V1.version]: INTERPRET_V1,
};

export const DEFAULT_INTERPRET_PROMPT: InterpretPrompt = INTERPRET_V1;

export function interpretPromptFor(version: string): InterpretPrompt {
  const prompt = Object.hasOwn(INTERPRET_PROMPTS, version) ? INTERPRET_PROMPTS[version] : undefined;
  if (!prompt) {
    const known = Object.keys(INTERPRET_PROMPTS).join(", ");
    throw new Error(`unknown prompt "${version}" (known: ${known})`);
  }
  return prompt;
}
