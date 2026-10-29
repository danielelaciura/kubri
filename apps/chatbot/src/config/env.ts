import { z } from "zod";
import { targetsBotSchema } from "./database-url";

export const NodeEnvSchema = z.enum(["development", "test", "production"]).default("development");
export type NodeEnv = z.infer<typeof NodeEnvSchema>;

const EnvSchema = z.object({
  NODE_ENV: NodeEnvSchema,
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DATABASE_URL: z.string({ error: "DATABASE_URL is required" }).refine(targetsBotSchema, {
    // The database is shared with the Kubri dashboard: never default to its schema.
    error: "DATABASE_URL must be a postgres URL ending with ?schema=bot",
  }),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(source: Readonly<Record<string, string | undefined>>): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    // Messages only (no input values), so secrets inside URLs never reach logs.
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${details}`);
  }
  return result.data;
}

/**
 * NODE_ENV alone, for commands that run without a database (e.g. `campaigns validate`).
 * Unset stays `undefined` (no silent default): the placeholder-consent guard treats it
 * as production.
 */
export function parseNodeEnv(value: string | undefined): NodeEnv | undefined {
  if (value === undefined || value === "") return undefined;
  const result = NodeEnvSchema.safeParse(value);
  if (!result.success) {
    throw new Error("Invalid environment: NODE_ENV must be development, test or production");
  }
  return result.data;
}
