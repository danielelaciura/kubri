import { z } from "zod";

const Ms = z.coerce.number().int().min(0);

const RuntimeEnvSchema = z.object({
  /** Quiet time before a burst of messages becomes one turn (spec §11.2, D106). */
  DEBOUNCE_MS: Ms.default(3000),
  /** A burst is never held longer than this. */
  DEBOUNCE_MAX_WAIT_MS: Ms.default(10_000),
  /** Past this the NLU counts as unavailable for the turn (D107). */
  TURN_NLU_DEADLINE_MS: z.coerce.number().int().positive().default(20_000),
  SEND_LEASE_MS: z.coerce.number().int().positive().default(60_000),
  SEND_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  WORKER_BATCH_SIZE: z.coerce.number().int().positive().max(20).default(4),
  /** Becomes part of SQL identifiers: letters, digits and underscores only. */
  QUEUE_SCHEMA: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/, "lowercase letters, digits and underscores")
    .default("bot_queue"),
});

export interface RuntimeConfig {
  readonly debounceMs: number;
  readonly debounceMaxWaitMs: number;
  readonly nluDeadlineMs: number;
  /** Timeout of the turn transaction (D102): the NLU and the translations both wait inside it. */
  readonly turnTransactionMs: number;
  readonly sendLeaseMs: number;
  readonly sendMaxAttempts: number;
  readonly workerBatchSize: number;
  readonly queueSchema: string;
}

/** Same convention as the NLU configuration: `KEY=` means unset; no values in the messages. */
export function parseRuntimeConfig(
  source: Readonly<Record<string, string | undefined>>,
): RuntimeConfig {
  const present = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ""),
  );
  const result = RuntimeEnvSchema.safeParse(present);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid runtime configuration: ${details}`);
  }
  const env = result.data;
  return {
    debounceMs: env.DEBOUNCE_MS,
    debounceMaxWaitMs: env.DEBOUNCE_MAX_WAIT_MS,
    nluDeadlineMs: env.TURN_NLU_DEADLINE_MS,
    turnTransactionMs: 2 * env.TURN_NLU_DEADLINE_MS + 30_000,
    sendLeaseMs: env.SEND_LEASE_MS,
    sendMaxAttempts: env.SEND_MAX_ATTEMPTS,
    workerBatchSize: env.WORKER_BATCH_SIZE,
    queueSchema: env.QUEUE_SCHEMA,
  };
}
