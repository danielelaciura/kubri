import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { LoadedCampaign } from "../campaigns/loaded-campaign";
import type { EngineEvent } from "../engine/events";
import type { Interpretation } from "../engine/interpretation";
import { initialSessionState, type SessionState } from "../engine/state";
import type { LanguageCode } from "../i18n/localized-text";
import type { TextResolver } from "../i18n/resolve";
import type { Interpreter } from "../nlu/interpreter";
import { redactContacts, redactWithEvidence } from "../nlu/minimize";
import type { NluTraceRecord, NluTraceSink } from "../nlu/trace";
import {
  findActiveCampaignByKeyword,
  findCampaignVersion,
  findDefaultCampaign,
} from "../store/campaigns";
import { findContactAddress } from "../store/contacts";
import type { Database, Tx } from "../store/db";
import { inTransaction, lockKey } from "../store/db";
import {
  markInboundProcessed,
  receivedBurst,
  recentRedactedHistory,
  type BurstMessage,
} from "../store/messages";
import { loadProfile } from "../store/profiles";
import type { JobQueue } from "../store/queue";
import {
  closeOpenKey,
  createSession,
  findOpenSession,
  saveSession,
  type SessionRecord,
  type SessionStatusName,
} from "../store/sessions";
import { insertTraces } from "../store/traces";
import { insertFlag, insertTurn, type TurnOutcomeName } from "../store/turns";
import { applyEffects, type EffectsOutcome, type InboundOfTurn } from "./apply-effects";
import type { RuntimeConfig } from "./config";
import { debounceWaitMs } from "./debounce";
import { toSnapshot } from "./profile-codec";
import { crashEffects, interpretSafely, stepSafely, type SafeStep } from "./safe";
import { decodeState, encodeState } from "./state-codec";
import { StoredDataError } from "./stored-data-error";
import { TurnTraces } from "./turn-traces";

export interface RuntimeDeps {
  readonly db: Database;
  readonly config: RuntimeConfig;
  readonly logger: Logger;
  readonly queue: JobQueue;
  readonly resolver: TextResolver;
  /** One interpreter per turn: its traces go to that turn's sink (D110). */
  readonly interpreterFor: (traces: NluTraceSink) => Interpreter;
  /** Earlier candidate messages sent to the NLU (NLU_HISTORY_MESSAGES). */
  readonly historyMessages: number;
  /** The HMAC key of Consent.contactHash (D111e), read once when the worker starts. */
  readonly consentHashSecret: string;
  readonly now: () => Date;
  /** Tests only: a fixed turn id. */
  readonly newId?: () => string;
}

export interface ContactJob {
  readonly contactId: string;
  readonly senderNumberId: string;
}

export type ProcessResult =
  "no_messages" | "rescheduled" | "ignored_media" | "no_campaign" | "replied" | "failed";

/**
 * Spec §11.2 as one transaction (D102): the contact's lock is held until the commit, so two
 * workers never run the same contact together, and a crash leaves the messages `received` for
 * the job's retry. Idempotent: a second run finds nothing to do.
 */
export function processContact(deps: RuntimeDeps, job: ContactJob): Promise<ProcessResult> {
  return inTransaction(deps.db, (tx) => runTurn(deps, tx, job), deps.config.turnTransactionMs);
}

interface Contact {
  readonly id: string;
  readonly channel: string;
  readonly externalId: string;
}

async function runTurn(deps: RuntimeDeps, tx: Tx, job: ContactJob): Promise<ProcessResult> {
  await lockKey(tx, `contact:${job.contactId}`);
  const burst = await receivedBurst(tx, job.contactId, job.senderNumberId);
  if (burst.length === 0) return "no_messages";
  const startedAt = deps.now();

  const wait = debounceWaitMs(deps.config, burst, startedAt);
  if (wait > 0) {
    await deps.queue.enqueue(
      "process-contact",
      job,
      { startAfterSeconds: Math.ceil(wait / 1000) },
      tx,
    );
    return "rescheduled";
  }

  const contact: Contact = await findContactAddress(tx, job.contactId);
  const turnId = (deps.newId ?? randomUUID)();
  const open = await findOpenSession(tx, contact.id, job.senderNumberId);
  const texts = burst.flatMap((m) => (m.type === "text" && m.body !== null ? [m.body] : []));
  const quiet = { turnId, contactId: contact.id, burst, startedAt };

  if (texts.length === 0) {
    return finishQuietly(deps, tx, {
      ...quiet,
      sessionId: open?.id ?? null,
      outcome: "ignored_media",
    });
  }
  const text = texts.join("\n");
  const route = await chooseCampaign(deps, job.senderNumberId, texts, open);
  if (route.kind === "none") {
    return finishQuietly(deps, tx, { ...quiet, sessionId: null, outcome: "no_campaign" });
  }

  const prepared =
    route.kind === "stay"
      ? await continueSession(deps, tx, { open: route.session, text, turnId, startedAt })
      : await startSession(deps, tx, {
          contact,
          job,
          previous: open,
          campaign: route.campaign,
          startedAt,
        });

  const { session, campaign, state, event, interpretation } = prepared;
  const result: SafeStep = state
    ? stepSafely(state, event, campaign.definition, deps.logger)
    : { state: prepared.fallbackState, effects: crashEffects(), crashed: true };
  const outcome: TurnOutcomeName = result.crashed ? "failed" : "replied";

  // The turn row comes first: messages, changes, flags and traces point at it.
  await insertTurn(tx, {
    id: turnId,
    sessionId: session.id,
    contactId: contact.id,
    inboundMessageIds: burst.map((m) => m.id),
    startedAt,
    completedAt: deps.now(),
    outcome,
  });
  await insertTraces(tx, prepared.traces);
  await flagDropped(deps, tx, { sessionId: session.id, turnId }, prepared.dropped);
  const inbound: InboundOfTurn[] = burst.map((m) => ({
    id: m.id,
    bodyRedacted: redactedCopy(m, interpretation, campaign),
  }));
  // applyEffects marks the inbound messages processed, before a purge can reach them.
  const effects = await applyEffects(
    {
      tx,
      queue: deps.queue,
      // One translation budget for the whole turn, as long as the NLU's: with it, the turn
      // stays within turnTransactionMs (2 × deadline + 30 s) even if every translation hangs.
      // Real time, not deps.now: it bounds real waiting.
      resolver: deps.resolver.withDeadline(Date.now() + deps.config.nluDeadlineMs),
      logger: deps.logger,
      consentHashSecret: deps.consentHashSecret,
      turnId,
      at: startedAt,
      contact,
      session,
      campaign: campaign.definition,
      finalState: result.state,
      answeringMessageId: burst.at(-1)?.id ?? null,
      inbound,
    },
    result.effects,
  );
  // An unreadable state is never overwritten (D104): nothing of the turn's state is saved.
  const saved = state ? savedState(result.state, effects) : null;
  const status = nextStatus(session.status, effects, saved?.phase === "closed");
  if (saved?.phase === "closed" && status !== "stopped" && status !== "completed") {
    deps.logger.warn({ turnId, sessionId: session.id, status }, "closed phase with an open status");
  }
  await saveSession(tx, session.id, {
    ...(saved ? { state: encodeState(saved) } : {}),
    language: result.state.language ?? session.language,
    status,
    at: deps.now(),
    closeOpen: effects.stopped || saved?.phase === "closed",
    ...(effects.completed ? { completedAt: startedAt } : {}),
    ...(effects.stopped ? { stoppedAt: startedAt } : {}),
  });
  if (effects.outbound > 0) {
    await deps.queue.enqueue("send-messages", job, {}, tx);
  }
  deps.logger.info(
    { turnId, sessionId: session.id, contactId: contact.id, outcome, replies: effects.outbound },
    "turn done",
  );
  return outcome;
}

type Route =
  | { readonly kind: "stay"; readonly session: SessionRecord }
  | { readonly kind: "new"; readonly campaign: LoadedCampaign }
  | { readonly kind: "none" };

/** D105: who answers this message — the open session, a new session, or nobody. */
async function chooseCampaign(
  deps: RuntimeDeps,
  senderNumberId: string,
  texts: readonly string[],
  open: SessionRecord | null,
): Promise<Route> {
  if (open && open.status !== "completed") return { kind: "stay", session: open };
  // Each message on its own: "ciao" then "ACME" is a keyword, "ciao\nACME" never would be.
  for (const text of texts) {
    const byKeyword = await findActiveCampaignByKeyword(deps.db, senderNumberId, text);
    if (byKeyword) return { kind: "new", campaign: byKeyword };
  }
  // A completed session keeps the conversation unless a keyword opens another campaign.
  if (open) return { kind: "stay", session: open };
  const fallback = await findDefaultCampaign(deps.db, senderNumberId);
  return fallback ? { kind: "new", campaign: fallback } : { kind: "none" };
}

interface Prepared {
  readonly session: SessionRecord;
  readonly campaign: LoadedCampaign;
  /** null: the stored state could not be read (D104). */
  readonly state: SessionState | null;
  readonly fallbackState: SessionState;
  readonly event: EngineEvent;
  readonly interpretation: Interpretation | null;
  /** Collected before the NLU deadline, written in the turn's transaction (D110). */
  readonly traces: readonly NluTraceRecord[];
  /** Paths of the stored state and profile that could not be read (D111b). */
  readonly dropped: readonly string[];
}

async function mustFindVersion(deps: RuntimeDeps, versionId: string): Promise<LoadedCampaign> {
  const campaign = await findCampaignVersion(deps.db, versionId);
  if (!campaign) throw new Error(`campaign version ${versionId} is missing`);
  return campaign;
}

async function continueSession(
  deps: RuntimeDeps,
  tx: Tx,
  a: { open: SessionRecord; text: string; turnId: string; startedAt: Date },
): Promise<Prepared> {
  const campaign = await mustFindVersion(deps, a.open.campaignVersionId);
  const dropped: string[] = [];
  const onDropped = (path: string) => {
    dropped.push(path);
  };
  const at = a.startedAt.toISOString();
  const fallbackState: SessionState = {
    ...initialSessionState(),
    language: parseLanguage(a.open.language),
  };
  let state: SessionState;
  try {
    const profile = await loadProfile(tx, a.open.id, { onDropped });
    state = decodeState(a.open.engineState, toSnapshot(profile), { onDropped });
  } catch (error: unknown) {
    // Only a decoding failure: a database error goes up, the turn rolls back and is retried.
    if (!(error instanceof StoredDataError)) throw error;
    deps.logger.error(
      { sessionId: a.open.id, turnId: a.turnId, errorName: error.name },
      "stored session cannot be read",
    );
    return {
      session: a.open,
      campaign,
      state: null,
      fallbackState,
      event: { type: "user_turn", at, text: a.text, interpretation: null },
      interpretation: null,
      traces: [],
      dropped,
    };
  }
  const history = await recentRedactedHistory(tx, a.open.id, deps.historyMessages);
  const traces = new TurnTraces();
  const { interpretation } = await interpretSafely(
    deps.interpreterFor(traces),
    { text: a.text, state, campaign: campaign.definition, history, turnId: a.turnId },
    deps.config.nluDeadlineMs,
    deps.logger,
  );
  return {
    session: a.open,
    campaign,
    state,
    fallbackState,
    event: { type: "user_turn", at, text: a.text, interpretation },
    interpretation,
    // A late interpreter's traces are dropped from here on: they would land outside the turn.
    traces: traces.freeze(),
    dropped,
  };
}

/**
 * A new session: the engine starts it with the welcome; the first message is not interpreted.
 * The one session_started of the session is emitted here, in the transaction that creates it
 * (D104).
 */
async function startSession(
  deps: RuntimeDeps,
  tx: Tx,
  a: {
    contact: Contact;
    job: ContactJob;
    previous: SessionRecord | null;
    campaign: LoadedCampaign;
    startedAt: Date;
  },
): Promise<Prepared> {
  // A completed session stays completed; one still running is abandoned (D111c).
  if (a.previous) await closeOpenKey(tx, a.previous.id);
  const state = initialSessionState();
  const session = await createSession(tx, {
    contactId: a.contact.id,
    senderNumberId: a.job.senderNumberId,
    campaignVersionId: a.campaign.versionId,
    state: encodeState(state),
    at: a.startedAt,
  });
  return {
    session,
    campaign: a.campaign,
    state,
    fallbackState: state,
    event: { type: "session_started", at: a.startedAt.toISOString() },
    interpretation: null,
    traces: [],
    dropped: [],
  };
}

function parseLanguage(language: string | null): LanguageCode | null {
  return language !== null && /^[a-z]{2}$/.test(language) ? language : null;
}

/** D109: after a purge, a confirmation still pending (personal values) is not saved back. */
export function savedState(state: SessionState, effects: EffectsOutcome): SessionState {
  return effects.purged ? { ...state, pendingConfirmation: null } : state;
}

/**
 * The status saveSession writes. applyEffects has already moved an active session to
 * `needs_attention` for a flag (markNeedsAttention): the status read before the turn must not
 * undo it. A stop wins over everything, so a turn that flags and stops ends `stopped`; a
 * closed phase never keeps an open status (the openKey CHECK, D111c).
 */
export function nextStatus(
  current: SessionStatusName,
  effects: Pick<EffectsOutcome, "stopped" | "completed" | "needsAttention">,
  closed = false,
): SessionStatusName {
  if (effects.stopped) return "stopped";
  if (effects.completed) return "completed";
  const status = effects.needsAttention && current === "active" ? "needs_attention" : current;
  if (closed && (status === "active" || status === "needs_attention")) return "stopped";
  return status;
}

function redactedCopy(
  m: BurstMessage,
  interpretation: Interpretation | null,
  campaign: LoadedCampaign,
): string | null {
  if (m.body === null) return null;
  return redactWithEvidence(m.body, interpretation, campaign.definition.customFields);
}

/**
 * D111b: a part of the stored state or profile that had to be dropped. The conversation goes
 * on (the field is asked again), so the flag does not need attention; the log has ids only.
 */
async function flagDropped(
  deps: RuntimeDeps,
  tx: Tx,
  ids: { sessionId: string; turnId: string },
  paths: readonly string[],
): Promise<void> {
  for (const path of paths) {
    await insertFlag(tx, {
      sessionId: ids.sessionId,
      turnId: ids.turnId,
      reason: "state_part_dropped",
      field: path,
      needsAttention: false,
    });
    deps.logger.warn({ ...ids, path }, "stored session part dropped");
  }
}

async function finishQuietly(
  deps: RuntimeDeps,
  tx: Tx,
  a: {
    turnId: string;
    contactId: string;
    sessionId: string | null;
    burst: readonly BurstMessage[];
    startedAt: Date;
    outcome: "ignored_media" | "no_campaign";
  },
): Promise<ProcessResult> {
  await insertTurn(tx, {
    id: a.turnId,
    sessionId: a.sessionId,
    contactId: a.contactId,
    inboundMessageIds: a.burst.map((m) => m.id),
    startedAt: a.startedAt,
    completedAt: deps.now(),
    outcome: a.outcome,
  });
  // No applyEffects on this path: the messages are marked here.
  await markInboundProcessed(
    tx,
    a.burst.map((m) => ({
      id: m.id,
      sessionId: a.sessionId,
      turnId: a.turnId,
      bodyRedacted: m.body === null ? null : redactContacts(m.body),
    })),
  );
  // Never silent without a recorded reason (CLAUDE.md): the turn row and this line are it.
  deps.logger.info(
    { turnId: a.turnId, sessionId: a.sessionId, contactId: a.contactId, outcome: a.outcome },
    "turn without a reply",
  );
  return a.outcome;
}
