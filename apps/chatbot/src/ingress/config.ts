import { z } from "zod";

// Meta versions its Graph API ("v23.0"). Check the current one in the app's dashboard when
// setting up: Meta retires old versions after about two years.
const GraphVersion = z
  .string()
  .regex(/^v\d+\.\d+$/, 'like "v23.0"')
  .default("v23.0");

const WebEnvSchema = z.object({
  META_APP_SECRET: z.string().min(1),
  META_VERIFY_TOKEN: z.string().min(1),
  META_GRAPH_VERSION: GraphVersion,
});

export interface WebConfig {
  readonly appSecret: string;
  readonly verifyToken: string;
  readonly graphVersion: string;
}

function messages(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
}

const present = (source: Readonly<Record<string, string | undefined>>) =>
  Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ""));

/** The web process needs the secrets that authenticate Meta's calls (no values in the errors). */
export function parseWebConfig(source: Readonly<Record<string, string | undefined>>): WebConfig {
  const result = WebEnvSchema.safeParse(present(source));
  if (!result.success) throw new Error(`Invalid web configuration: ${messages(result.error)}`);
  const env = result.data;
  return {
    appSecret: env.META_APP_SECRET,
    verifyToken: env.META_VERIFY_TOKEN,
    graphVersion: env.META_GRAPH_VERSION,
  };
}

/** The worker only sends: it needs the version, and the tokens it reads by the numbers' secret names. */
export function parseGraphVersion(source: Readonly<Record<string, string | undefined>>): string {
  const result = z.object({ META_GRAPH_VERSION: GraphVersion }).safeParse(present(source));
  if (!result.success) throw new Error(`Invalid configuration: ${messages(result.error)}`);
  return result.data.META_GRAPH_VERSION;
}
