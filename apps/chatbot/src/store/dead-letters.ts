import type { Tx } from "./db";
import type { PayloadRaw } from "./messages";

export interface DeadLetterInput {
  readonly raw: PayloadRaw;
  readonly reason: string;
}

/** A payload that could not be processed (D117): kept, so the webhook can still answer 200. */
export async function insertDeadLetter(tx: Tx, input: DeadLetterInput): Promise<void> {
  await tx.inboundDeadLetter.create({ data: { raw: input.raw, reason: input.reason } });
}
