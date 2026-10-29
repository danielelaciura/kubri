import { z } from "zod";

const ModelSchema = z.string().trim().min(1);

const ModelPriceSchema = z.strictObject({
  inputPerMTok: z.number().nonnegative(),
  outputPerMTok: z.number().nonnegative(),
});
export type ModelPrice = z.infer<typeof ModelPriceSchema>;

const PricesSchema = z
  .string()
  .transform((text, ctx) => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "must be a JSON object" });
      return z.NEVER;
    }
  })
  .pipe(z.record(z.string(), ModelPriceSchema));

/** D81: earlier messages given to the LLM, at most (env and `simulate --history`). */
export const MAX_HISTORY_MESSAGES = 10;

// D81. Separate from parseEnv: `campaigns simulate` must work without DATABASE_URL.
const NluEnvSchema = z.object({
  MISTRAL_API_KEY: z.string().trim().min(1).optional(),
  NLU_INTERPRET_MODEL: ModelSchema.default("mistral-small-latest"),
  NLU_TRANSLATE_MODEL: ModelSchema.default("mistral-small-latest"),
  NLU_FALLBACK_MODEL: ModelSchema.default("mistral-medium-latest"),
  NLU_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  NLU_HISTORY_MESSAGES: z.coerce.number().int().min(0).max(MAX_HISTORY_MESSAGES).default(3),
  /** JSON: { "<model>": { "inputPerMTok": 0.1, "outputPerMTok": 0.3 } }, for NluTrace costs. */
  NLU_PRICES: PricesSchema.optional(),
});

export type LlmTask = "interpret" | "translate";

export interface NluConfig {
  readonly mistralApiKey: string | undefined;
  /** Per task (spec §8.5), plus the fallback model. */
  readonly models: Readonly<Record<LlmTask | "fallback", string>>;
  readonly timeoutMs: number;
  /** Earlier user messages sent with each turn (spec §8.2). */
  readonly historyMessages: number;
  readonly prices: Readonly<Record<string, ModelPrice>>;
}

export function parseNluConfig(source: Readonly<Record<string, string | undefined>>): NluConfig {
  // `KEY=` in .env means "not set".
  const present = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ""),
  );
  const result = NluEnvSchema.safeParse(present);
  if (!result.success) {
    // Messages only (no input values), as in parseEnv: the key must never reach a log.
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid NLU configuration: ${details}`);
  }
  const env = result.data;
  return {
    mistralApiKey: env.MISTRAL_API_KEY,
    models: {
      interpret: env.NLU_INTERPRET_MODEL,
      translate: env.NLU_TRANSLATE_MODEL,
      fallback: env.NLU_FALLBACK_MODEL,
    },
    timeoutMs: env.NLU_TIMEOUT_MS,
    historyMessages: env.NLU_HISTORY_MESSAGES,
    prices: env.NLU_PRICES ?? {},
  };
}

/** Asked only when the real provider is built (D81). */
export function requireMistralKey(config: NluConfig): string {
  if (config.mistralApiKey === undefined) {
    throw new Error(
      "MISTRAL_API_KEY is not set: only the real LLM needs it (simulate works without it with --nlu naive --translator fake)",
    );
  }
  return config.mistralApiKey;
}
