import * as v1 from "./interpret-v1";
import * as v2 from "./interpret-v2";

export interface InterpretPrompt {
  readonly version: string;
  readonly system: string;
}

const INTERPRET_V1: InterpretPrompt = {
  version: v1.INTERPRET_PROMPT_VERSION,
  system: v1.INTERPRET_SYSTEM_PROMPT,
};

const INTERPRET_V2: InterpretPrompt = {
  version: v2.INTERPRET_PROMPT_VERSION,
  system: v2.INTERPRET_SYSTEM_PROMPT,
};

/** Released versions: a new prompt file adds one line here, evals pick it with --prompt. */
export const INTERPRET_PROMPTS: Readonly<Record<string, InterpretPrompt>> = {
  [INTERPRET_V1.version]: INTERPRET_V1,
  [INTERPRET_V2.version]: INTERPRET_V2,
};

/** D144: v2 makes the language of offTopicReply and missing explicit. */
export const DEFAULT_INTERPRET_PROMPT: InterpretPrompt = INTERPRET_V2;

export function interpretPromptFor(version: string): InterpretPrompt {
  const prompt = Object.hasOwn(INTERPRET_PROMPTS, version) ? INTERPRET_PROMPTS[version] : undefined;
  if (!prompt) {
    const known = Object.keys(INTERPRET_PROMPTS).join(", ");
    throw new Error(`unknown prompt "${version}" (known: ${known})`);
  }
  return prompt;
}
