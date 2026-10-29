/**
 * A stored state or profile that cannot be decoded (D104, D111b). Only this means "unreadable":
 * a database error is something else, and must reach pg-boss so the job is retried.
 */
export class StoredDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoredDataError";
  }
}
