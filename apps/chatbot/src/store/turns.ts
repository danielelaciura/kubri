import type { Tx } from "./db";

export type TurnOutcomeName = "replied" | "ignored_media" | "no_campaign" | "failed";

export interface TurnInput {
  /** Chosen before the turn runs, so its traces can point at it (D110). */
  readonly id: string;
  /** null: the turn never got a session (no campaign for the message, media only). */
  readonly sessionId: string | null;
  /** Always set: a session-less turn still belongs to the contact (deleted with it). */
  readonly contactId: string;
  readonly inboundMessageIds: readonly string[];
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly outcome: TurnOutcomeName;
}

export async function insertTurn(tx: Tx, input: TurnInput): Promise<void> {
  await tx.turn.create({ data: { ...input, inboundMessageIds: [...input.inboundMessageIds] } });
}

export interface FlagInput {
  readonly sessionId: string;
  readonly turnId: string | null;
  readonly reason: string;
  readonly field: string | null;
  readonly needsAttention: boolean;
}

export async function insertFlag(tx: Tx, input: FlagInput): Promise<void> {
  await tx.sessionFlag.create({ data: input });
}
