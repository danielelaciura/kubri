import { z } from "zod";
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

/** Always open (D105): the candidate may still be talking. */
const OPEN_STATUSES: readonly SessionStatusName[] = ["active", "needs_attention"];
/** Never open. `completed` is either: open in post-completion, closed after it. */
const CLOSED_STATUSES: readonly SessionStatusName[] = ["stopped", "abandoned"];

/**
 * Keeps `openKey` consistent with the status, as the Session CHECK constraint requires
 * (migration runtime_integrity): a closed status drops the key, and closing the key of a
 * session that stays active or needs attention is a bug, refused before the database does.
 */
function dropsOpenKey(changes: SessionChanges): boolean {
  if (changes.closeOpen && OPEN_STATUSES.includes(changes.status)) {
    throw new Error(`cannot close the open key of a session with an open status`);
  }
  return changes.closeOpen || CLOSED_STATUSES.includes(changes.status);
}

export async function saveSession(tx: Tx, id: string, changes: SessionChanges): Promise<void> {
  const dropKey = dropsOpenKey(changes);
  await tx.session.update({
    where: { id },
    data: {
      ...(changes.state ? { engineState: asJson(changes.state) } : {}),
      language: changes.language,
      status: changes.status,
      lastActivityAt: changes.at,
      ...(changes.completedAt ? { completedAt: changes.completedAt } : {}),
      ...(changes.stoppedAt ? { stoppedAt: changes.stoppedAt } : {}),
      ...(dropKey ? { openKey: null } : {}),
    },
  });
}

/**
 * A new campaign replaces the open session (D105). An interview still running is abandoned
 * (an active session without a key is not allowed); a completed one stays completed.
 */
export async function closeOpenKey(tx: Tx, id: string): Promise<void> {
  await tx.session.updateMany({
    where: { id, status: { in: [...OPEN_STATUSES] } },
    data: { openKey: null, status: "abandoned" },
  });
  await tx.session.updateMany({
    where: { id, status: { notIn: [...OPEN_STATUSES] } },
    data: { openKey: null },
  });
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

/** What a consent's text looked like when it was sent (D111d): the Consent row copies it. */
export interface ConsentShown {
  readonly textVersion: string;
  readonly text: string;
  readonly language: string;
  readonly isCurated: boolean;
  readonly linkShown: string | null;
}

const ConsentShownSchema = z.object({
  textVersion: z.string(),
  text: z.string(),
  language: z.string(),
  isCurated: z.boolean(),
  linkShown: z.string().nullable(),
});

async function consentsShownOf(tx: Tx, sessionId: string): Promise<Record<string, unknown>> {
  const row = await tx.session.findUniqueOrThrow({
    where: { id: sessionId },
    select: { consentsShown: true },
  });
  const value = row.consentsShown;
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

/** The latest sending of a consent replaces the one before (a re-asked consent). */
export async function recordConsentShown(
  tx: Tx,
  sessionId: string,
  consentKey: string,
  shown: ConsentShown,
): Promise<void> {
  const all = await consentsShownOf(tx, sessionId);
  await tx.session.update({
    where: { id: sessionId },
    data: { consentsShown: asJson({ ...all, [consentKey]: shown }) },
  });
}

/** Undefined when the consent was never sent in this session, or its record is unreadable. */
export async function findConsentShown(
  tx: Tx,
  sessionId: string,
  consentKey: string,
): Promise<ConsentShown | undefined> {
  const parsed = ConsentShownSchema.safeParse((await consentsShownOf(tx, sessionId))[consentKey]);
  return parsed.success ? parsed.data : undefined;
}
