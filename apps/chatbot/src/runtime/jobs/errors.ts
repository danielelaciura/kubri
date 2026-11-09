/**
 * Thrown by a job handler to make pg-boss try again with its backoff (D126). The code is a
 * machine code (`http_503`, `timeout`): pg-boss stores the error's name and code, never more.
 */
export class TransientJobError extends Error {
  constructor(readonly code: string) {
    super(`transient failure: ${code}`);
    this.name = "TransientJobError";
  }
}
