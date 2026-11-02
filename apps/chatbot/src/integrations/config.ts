import { z } from "zod";

type Source = Readonly<Record<string, string | undefined>>;

/** Same convention as the other configurations: `KEY=` (or blanks) means unset. */
const present = (source: Source): Record<string, string> =>
  Object.fromEntries(
    Object.entries(source).flatMap(([key, value]) =>
      value === undefined || value.trim() === "" ? [] : [[key, value]],
    ),
  );

/** Paths are appended to it: no trailing slash. */
const baseUrl = z
  .url()
  .refine((value) => /^https?:$/.test(new URL(value).protocol), {
    error: "must be an http(s) URL",
  })
  .transform((value) => value.replace(/\/+$/, ""));

const KubriEnvSchema = z.object({
  KUBRI_BASE_URL: baseUrl,
  /** The dashboard trims its copy: so does the chatbot, or a stray newline would be a 401. */
  CHATBOT_WEBHOOK_SECRET: z.string().trim().min(1),
});

const KUBRI_VARIABLES = ["KUBRI_BASE_URL", "CHATBOT_WEBHOOK_SECRET"] as const;

export interface KubriConfig {
  /** The dashboard's origin, e.g. https://app.kubri.it. */
  readonly baseUrl: string;
  /** Sent as `Authorization: Bearer <secret>` (R6). Never logged, never in an error. */
  readonly secret: string;
}

/** Spec §12.1, R3. Errors name the variable and never echo a value. */
export function parseKubriConfig(source: Source): KubriConfig {
  const result = KubriEnvSchema.safeParse(present(source));
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid Kubri configuration: ${details}`);
  }
  return { baseUrl: result.data.KUBRI_BASE_URL, secret: result.data.CHATBOT_WEBHOOK_SECRET };
}

/**
 * R9: null when neither variable is set (a worker without the Kubri integration); a
 * half-filled configuration is a mistake and throws like parseKubriConfig.
 */
export function readKubriConfig(source: Source): KubriConfig | null {
  const set = present(source);
  if (KUBRI_VARIABLES.every((name) => set[name] === undefined)) return null;
  return parseKubriConfig(source);
}
