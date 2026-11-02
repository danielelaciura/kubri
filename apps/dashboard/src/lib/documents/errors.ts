export type DocumentErrorCode = "FILE_UNREADABLE" | "NO_TEXT";

export class DocumentError extends Error {
  constructor(public readonly code: DocumentErrorCode, public readonly cause?: unknown) {
    super(`document error: ${code}`);
    this.name = "DocumentError";
  }
}
