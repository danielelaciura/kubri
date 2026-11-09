import { pino, type DestinationStream, type Logger } from "pino";
import type { Env } from "../config/env";

// Personal data and credentials must never reach the logs (CLAUDE.md, privacy rule 3).
// Log identifiers (sessionId, contactId, turnId) instead.
// Matched case-insensitively, at any depth, including inside arrays.
const SENSITIVE_KEYS = new Set(
  [
    "phone",
    "phoneE164",
    "phoneNumber",
    "firstName",
    "lastName",
    "name",
    "address",
    "birthday",
    "email",
    "from",
    "wa_id",
    "body",
    "text",
    "authorization",
    "x-hub-signature-256",
    "cookie",
    "accessToken",
    "appSecret",
    "token",
    "secret",
    "password",
    "DATABASE_URL",
    "databaseUrl",
  ].map((key) => key.toLowerCase()),
);

const CENSOR = "[REDACTED]";
const MAX_DEPTH = 20;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

// pino `redact` paths cannot express "any depth", so we walk the object ourselves.
// Only plain objects and arrays are traversed; Errors and other instances are left to pino.
export function redactDeep(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return CENSOR;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, depth + 1));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? CENSOR : redactDeep(child, depth + 1);
    }
    return out;
  }
  return value;
}

export interface LoggerOptions {
  level: Env["LOG_LEVEL"];
  destination?: DestinationStream;
}

export function createLogger({ level, destination }: LoggerOptions): Logger {
  const options = {
    level,
    base: undefined,
    formatters: {
      log: (object: Record<string, unknown>) => redactDeep(object) as Record<string, unknown>,
    },
  };
  return destination ? pino(options, destination) : pino(options);
}
