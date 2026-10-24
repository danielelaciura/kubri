import { z } from "zod";
import { targetsBotSchema } from "./database-url";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
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
