import type { Interpretation } from "../engine/interpretation";
import type { LanguageCode } from "../i18n/localized-text";
import { callWithPolicy, type CallResult } from "./call-policy";
import { buildInterpretContext, type InterpretContext } from "./context";
import { interpretMessages, repairMessages } from "./interpret-messages";
import { parseInterpretationOutput, type OutputCheck } from "./interpretation-output";
import type { InterpretRequest, Interpreter } from "./interpreter";
import type { LlmMessage } from "./llm-provider";
import type { LlmTaskOptions } from "./llm-task";
import { INTERPRET_PROMPT_VERSION } from "./prompts/interpret-v1";
import { attemptTraces, traceInput, writeTracesSafely, type NluTraceRecord } from "./trace";

const INTERPRET_TEMPERATURE = 0;
const INTERPRET_MAX_TOKENS = 1000;

/** D83: the output stayed invalid after the repair. */
export function unclearInterpretation(language: LanguageCode): Interpretation {
  return {
    language: { code: language, confidence: 0 },
    intent: "unclear",
    patch: [],
    currentQuestion: { completeness: "absent" },
  };
}

/** One turn to interpret, from a prepared context: what evals feed (plan 07). */
export interface ContextInterpretRequest {
  readonly context: InterpretContext;
  readonly message: string;
  readonly turnId: string | null;
  /** For `unclear` when the session has no language yet: the campaign's default. */
  readonly defaultLanguage: LanguageCode;
}

export interface ContextInterpretResult {
  /** null = the LLM is unavailable (D82). */
  readonly interpretation: Interpretation | null;
  /** The last reply received, as written; null when none came. */
  readonly raw: string | null;
  /** The last reply passed every check. */
  readonly valid: boolean;
  /** A repair call was made (D83). */
  readonly repaired: boolean;
  /** Every call made, also written to the sink. */
  readonly traces: readonly NluTraceRecord[];
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

interface CallOutcome {
  readonly reply: { readonly content: string; readonly check: OutputCheck } | null;
  readonly traces: readonly NluTraceRecord[];
}

/** One call (with its retries and fallback), checked against the turn's context and traced. */
async function call(
  request: ContextInterpretRequest,
  options: LlmTaskOptions,
  messages: readonly LlmMessage[],
  repair: boolean,
): Promise<CallOutcome> {
  const result = await complete(messages, options);
  const check = result.response
    ? parseInterpretationOutput(result.response.content, request.context)
    : undefined;
  const traces = attemptTraces(
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
  );
  await writeTracesSafely(options.traces, traces);
  return {
    reply: result.response && check ? { content: result.response.content, check } : null,
    traces,
  };
}

/**
 * Spec §8.1 point 1 on a prepared context. No redaction here: the context is minimized by
 * construction (D85) and the current message goes whole. Keeping a redacted copy of the
 * message for later history (`redactWithEvidence`) is the caller's job: the simulator does it,
 * runtime will (plan 08).
 */
export async function interpretContext(
  request: ContextInterpretRequest,
  options: LlmTaskOptions,
): Promise<ContextInterpretResult> {
  const messages = interpretMessages(request.context, request.message);
  const first = await call(request, options, messages, false);
  // D82: unavailable → null, the engine still applies the deterministic keywords.
  if (!first.reply) {
    return { interpretation: null, raw: null, valid: false, repaired: false, traces: first.traces };
  }
  if (first.reply.check.ok) {
    return {
      interpretation: first.reply.check.interpretation,
      raw: first.reply.content,
      valid: true,
      repaired: false,
      traces: first.traces,
    };
  }
  const retry = repairMessages(messages, first.reply.content, first.reply.check.problems);
  const second = await call(request, options, retry, true);
  const traces = [...first.traces, ...second.traces];
  const raw = second.reply?.content ?? first.reply.content;
  if (second.reply?.check.ok) {
    return {
      interpretation: second.reply.check.interpretation,
      raw,
      valid: true,
      repaired: true,
      traces,
    };
  }
  const language = request.context.sessionLanguage ?? request.defaultLanguage;
  return {
    interpretation: unclearInterpretation(language),
    raw,
    valid: false,
    repaired: true,
    traces,
  };
}

/** The Interpreter contract of plan 05: builds the context (§8.2), then interprets it. */
export function createLlmInterpreter(options: LlmTaskOptions): Interpreter {
  return {
    interpret: async (request: InterpretRequest) =>
      (
        await interpretContext(
          {
            context: buildInterpretContext(request, options.config.historyMessages),
            message: request.text,
            turnId: request.turnId,
            defaultLanguage: request.campaign.defaultLanguage,
          },
          options,
        )
      ).interpretation,
  };
}
