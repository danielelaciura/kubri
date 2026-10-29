import type { InterpretContext } from "./context";
import type { LlmMessage } from "./llm-provider";
import { INTERPRET_SYSTEM_PROMPT } from "./prompts/interpret-v1";

/** The `interpret` call: the rules, then the context and the message as one JSON object. */
export function interpretMessages(context: InterpretContext, message: string): LlmMessage[] {
  return [
    { role: "system", content: INTERPRET_SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify({ context, message }) },
  ];
}

/** D83: one repair attempt, with the problems Zod found (paths and messages, no values). */
export function repairMessages(
  original: readonly LlmMessage[],
  invalidReply: string,
  problems: readonly string[],
): LlmMessage[] {
  return [
    ...original,
    { role: "assistant", content: invalidReply },
    {
      role: "user",
      content: `Your reply is not valid: ${problems.join("; ")}. Reply again with one corrected JSON object only, following the OUTPUT format.`,
    },
  ];
}
