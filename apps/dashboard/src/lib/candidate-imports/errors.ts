import { DocumentError } from "@/lib/documents/errors";
import { LLMError, LLMTimeoutError } from "@/lib/llm/errors";
import { StorageError } from "@/lib/storage/errors";

export const IMPORT_ERROR_CODES = [
  "FILE_TOO_LARGE",
  "UNSUPPORTED_TYPE",
  "STORAGE_ERROR",
  "FILE_UNREADABLE",
  "NO_TEXT",
  "NOT_A_CV",
  "LLM_TIMEOUT",
  "LLM_ERROR",
  "INTERNAL_ERROR",
] as const;
export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

/** Codes for which "Riprova" makes sense. */
export const RETRYABLE_IMPORT_ERRORS: readonly ImportErrorCode[] = [
  "STORAGE_ERROR",
  "LLM_TIMEOUT",
  "LLM_ERROR",
  "INTERNAL_ERROR",
];

export function isImportErrorCode(v: unknown): v is ImportErrorCode {
  return typeof v === "string" && (IMPORT_ERROR_CODES as readonly string[]).includes(v);
}

export class ImportError extends Error {
  constructor(public readonly code: ImportErrorCode, public readonly cause?: unknown) {
    super(`import error: ${code}`);
    this.name = "ImportError";
  }
}

export class ImportNotFoundError extends Error {}

export class ImportStateError extends Error {
  constructor(public readonly status: string) {
    super(`import is in status ${status}`);
  }
}

export function toImportErrorCode(e: unknown): ImportErrorCode {
  if (e instanceof ImportError) return e.code;
  if (e instanceof DocumentError) return e.code;
  if (e instanceof StorageError) return "STORAGE_ERROR";
  if (e instanceof LLMTimeoutError) return "LLM_TIMEOUT";
  if (e instanceof LLMError) return "LLM_ERROR";
  return "INTERNAL_ERROR";
}
