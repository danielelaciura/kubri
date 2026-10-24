import type { Interpretation } from "../engine/interpretation";
import { callWithPolicy, type CallResult } from "./call-policy";
import { buildInterpretContext, type InterpretContext } from "./context";
import { interpretMessages, repairMessages } from "./interpret-messages";
import { parseInterpretationOutput, type OutputCheck } from "./interpretation-output";
import type { InterpretRequest, Interpreter } from "./interpreter";
import type { LlmMessage } from "./llm-provider";
import type { LlmTaskOptions } from "./llm-task";
import { INTERPRET_PROMPT_VERSION } from "./prompts/interpret-v1";
import { attemptTraces, traceInput, writeTracesSafely } from "./trace";

const INTERPRET_TEMPERATURE = 0;
const INTERPRET_MAX_TOKENS = 1000;

/** D83: the output stayed invalid after the repair. */
export function unclearInterpretation(request: InterpretRequest): Interpretation {
  return {
    language: { code: request.state.language ?? request.campaign.defaultLanguage, confidence: 0 },
    intent: "unclear",
    patch: [],
    currentQuestion: { completeness: "absent" },
  };
}

function complete(messages: readonly LlmMessage[], options: LlmTaskOptions): Promise<CallResult> {
  const { config } = options;
  return callWithPolicy(
    options.provider,
    {
      messages,
      model: config.models.interpret,
      temperature: INTERPRET_TEMPERATURE,
      responseFormat: "json",
      maxTokens: INTERPRET_MAX_TOKENS,
      timeoutMs: config.timeoutMs,
    },
    config.models.fallback,
    options.timing,
  );
}

/** One call (with its retries and fallback), checked against the turn's context and traced. */
async function call(
  request: InterpretRequest,
  options: LlmTaskOptions,
  context: InterpretContext,
  messages: readonly LlmMessage[],
  repair: boolean,
): Promise<{ readonly content: string; readonly check: OutputCheck } | null> {
  const result = await complete(messages, options);
  const check = result.response
    ? parseInterpretationOutput(result.response.content, context)
    : undefined;
  await writeTracesSafely(
    options.traces,
    attemptTraces(
      {
        turnId: request.turnId,
        task: "interpret",
        promptVersion: INTERPRET_PROMPT_VERSION,
        provider: options.provider.name,
        repair,
        input: traceInput(messages),
        at: options.now(),
      },
      result.attempts,
      check?.ok ?? false,
      options.config.prices,
    ),
  );
  return result.response && check ? { content: result.response.content, check } : null;
}

/**
 * No redaction here: the context is minimized by construction (D85) and the current message
 * goes whole. Keeping a redacted copy of the message for later history (`redactWithEvidence`)
 * is the caller's job: the simulator does it, runtime will (plan 08).
 */
async function interpretWithLlm(
  request: InterpretRequest,
  options: LlmTaskOptions,
): Promise<Interpretation | null> {
  const context = buildInterpretContext(request, options.config.historyMessages);
  const messages = interpretMessages(context, request.text);
  const first = await call(request, options, context, messages, false);
  // D82: unavailable → null, the engine still applies the deterministic keywords.
  if (!first) return null;
  if (first.check.ok) return first.check.interpretation;
  const retry = repairMessages(messages, first.content, first.check.problems);
  const second = await call(request, options, context, retry, true);
  if (second?.check.ok) return second.check.interpretation;
  return unclearInterpretation(request);
}

/** Spec §8.1 point 1, behind the Interpreter contract of plan 05. */
export function createLlmInterpreter(options: LlmTaskOptions): Interpreter {
  return { interpret: (request) => interpretWithLlm(request, options) };
}
