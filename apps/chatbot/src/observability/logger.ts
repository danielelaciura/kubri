import { pino, type DestinationStream, type Logger } from "pino";

// Personal data and credentials must never reach the logs (CLAUDE.md, privacy rule 3).
// Log identifiers (sessionId, contactId, turnId) instead.
const SENSITIVE_KEYS = [
  "phone",
  "phoneE164",
  "firstName",
  "lastName",
  "address",
  "birthday",
  "email",
  "body",
  "text",
  "authorization",
  "accessToken",
  "appSecret",
  "token",
  "secret",
  "password",
] as const;

export const REDACT_PATHS: readonly string[] = SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`]);

export interface LoggerOptions {
  level: string;
  destination?: DestinationStream;
}

export function createLogger({ level, destination }: LoggerOptions): Logger {
  const options = {
    level,
    base: undefined,
    redact: { paths: [...REDACT_PATHS], censor: "[REDACTED]" },
  };
  return destination ? pino(options, destination) : pino(options);
}
