import type { PersistedState } from "../runtime/state-codec";
import type { Tx } from "./db";
import { asJson } from "./json";

export type SessionStatusName =
  "active" | "completed" | "stopped" | "abandoned" | "needs_attention";

export interface SessionRecord {
  readonly id: string;
  readonly contactId: string;
  readonly senderNumberId: string;
  readonly campaignVersionId: string;
  readonly status: SessionStatusName;
  readonly engineState: unknown;
  readonly language: string | null;
}

const SELECT = {
  id: true,
  contactId: true,
  senderNumberId: true,
  campaignVersionId: true,
  status: true,
  engineState: true,
  language: true,
} as const;

/** D105: the session whose `openKey` is "<contactId>:<senderNumberId>". */
export const openKeyOf = (contactId: string, senderNumberId: string): string =>
  `${contactId}:${senderNumberId}`;

export function findOpenSession(
  tx: Tx,
  contactId: string,
  senderNumberId: string,
): Promise<SessionRecord | null> {
  return tx.session.findUnique({
    where: { openKey: openKeyOf(contactId, senderNumberId) },
    select: SELECT,
  });
}

export interface CreateSessionInput {
  readonly contactId: string;
  readonly senderNumberId: string;
  readonly campaignVersionId: string;
  readonly state: PersistedState;
  readonly at: Date;
}

/** The session and its empty profile, together. */
export function createSession(tx: Tx, input: CreateSessionInput): Promise<SessionRecord> {
  return tx.session.create({
    data: {
      contactId: input.contactId,
      senderNumberId: input.senderNumberId,
      campaignVersionId: input.campaignVersionId,
      engineState: asJson(input.state),
      openKey: openKeyOf(input.contactId, input.senderNumberId),
      startedAt: input.at,
      lastActivityAt: input.at,
      profile: { create: {} },
    },
    select: SELECT,
  });
}

export interface SessionChanges {
  /** Left out when the stored state could not be read: it is never overwritten blindly. */
  readonly state?: PersistedState;
  readonly language: string | null;
  readonly status: SessionStatusName;
  readonly at: Date;
  readonly completedAt?: Date;
  readonly stoppedAt?: Date;
  /** Frees the contact for a new session (D105). */
  readonly closeOpen: boolean;
}

export async function saveSession(tx: Tx, id: string, changes: SessionChanges): Promise<void> {
  await tx.session.update({
    where: { id },
    data: {
      ...(changes.state ? { engineState: asJson(changes.state) } : {}),
      language: changes.language,
      status: changes.status,
      lastActivityAt: changes.at,
      ...(changes.completedAt ? { completedAt: changes.completedAt } : {}),
      ...(changes.stoppedAt ? { stoppedAt: changes.stoppedAt } : {}),
      ...(changes.closeOpen ? { openKey: null } : {}),
    },
  });
}

export async function closeOpenKey(tx: Tx, id: string): Promise<void> {
  await tx.session.update({ where: { id }, data: { openKey: null } });
}

export function findSessionById(tx: Tx, id: string): Promise<SessionRecord | null> {
  return tx.session.findUnique({ where: { id }, select: SELECT });
}

/** Only an active session moves: a completed one keeps its status, the flag row says why. */
export async function markNeedsAttention(tx: Tx, id: string): Promise<void> {
  await tx.session.updateMany({
    where: { id, status: "active" },
    data: { status: "needs_attention" },
  });
}
