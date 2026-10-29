import type { Logger } from "pino";
import { KUBRI_GLOBAL_CONSENT } from "../campaigns/checks/consents";
import type { CampaignDefinition } from "../campaigns/schema/campaign";
import { describeEffect } from "../engine/describe";
import type { Effect, Job } from "../engine/effects";
import type { SessionState } from "../engine/state";
import { describeTextRef } from "../engine/text-ref";
import { consentStepOf } from "../i18n/critical";
import { outputLanguage, type TextResolver } from "../i18n/resolve";
import { insertConsent } from "../store/consents";
import { recordOptOut, setPreferredLanguage } from "../store/contacts";
import type { Tx } from "../store/db";
import { markInboundProcessed, queueOutbound, type OutboundMessageInput } from "../store/messages";
import {
  applyProfileFields,
  markFieldUnresolved,
  markProfileCompleted,
  purgeSessionData,
  setSharedWithGlobal,
} from "../store/profiles";
import type { JobQueue } from "../store/queue";
import { findConsentShown, markNeedsAttention, recordConsentShown } from "../store/sessions";
import { insertFlag } from "../store/turns";

/** An inbound message answered by this turn, with the copy kept for the NLU history (D107). */
export interface InboundOfTurn {
  readonly id: string;
  /** Computed with redactWithEvidence by the caller: never the original text. */
  readonly bodyRedacted: string | null;
}

export interface ApplyContext {
  readonly tx: Tx;
  readonly queue: JobQueue;
  readonly resolver: TextResolver;
  readonly logger: Logger;
  /** The HMAC key of Consent.contactHash (D111e), read once when the worker starts. */
  readonly consentHashSecret: string;
  readonly turnId: string;
  readonly at: Date;
  readonly contact: { readonly id: string; readonly channel: string; readonly externalId: string };
  readonly session: { readonly id: string; readonly senderNumberId: string };
  readonly campaign: CampaignDefinition;
  /** The state after step(): texts are resolved in its language (D77). */
  readonly finalState: SessionState;
  /** The inbound message that answered a consent, if any. */
  readonly answeringMessageId: string | null;
  /** The turn's inbound messages: marked processed here, before a purge can reach them. */
  readonly inbound: readonly InboundOfTurn[];
}

/**
 * What the caller still has to write on the Session row with saveSession (status, language,
 * openKey): those depend on the final state too, so they are written once, by the turn.
 */
export interface EffectsOutcome {
  readonly completed: boolean;
  readonly stopped: boolean;
  /**
   * The session's data was purged (StopSession with the delete policy): the state the caller
   * saves afterwards must not bring a pending confirmation back (D109).
   */
  readonly purged: boolean;
  readonly needsAttention: boolean;
  /** Set by SetLanguage. */
  readonly language: string | null;
  /** SendText effects queued. */
  readonly outbound: number;
}

type FlagEffect = Extract<Effect, { type: "FlagSession" }>;

export interface FlagContext {
  readonly sessionId: string;
  readonly turnId: string | null;
  readonly logger: Logger;
}

/**
 * FlagSession: the row, `needs_attention` when asked (spec §13), and a warning with ids only.
 * The alert itself is plan 11's.
 */
export async function recordFlag(tx: Tx, ctx: FlagContext, effect: FlagEffect): Promise<void> {
  await insertFlag(tx, {
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    reason: effect.reason,
    field: effect.field ?? null,
    needsAttention: effect.needsAttention,
  });
  if (effect.needsAttention) await markNeedsAttention(tx, ctx.sessionId);
  ctx.logger.warn(
    {
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      reason: effect.reason,
      field: effect.field,
      needsAttention: effect.needsAttention,
    },
    "session flagged",
  );
}

async function enqueueJob(ctx: ApplyContext, job: Job): Promise<void> {
  const sessionId = ctx.session.id;
  switch (job.name) {
    case "kubri-webhook":
      return ctx.queue.enqueue("kubri-webhook", { sessionId, event: job.event }, {}, ctx.tx);
    case "cv":
      return ctx.queue.enqueue("cv", { sessionId }, {}, ctx.tx);
    case "geocoding":
      return ctx.queue.enqueue("geocoding", { sessionId }, {}, ctx.tx);
    case "delete-contact":
      return ctx.queue.enqueue("delete-contact", { contactId: ctx.contact.id }, {}, ctx.tx);
  }
}

type ConsentEffect = Extract<Effect, { type: "RecordConsent" }>;

/**
 * Spec §7.3, D73, D74, D111d: exactly what the candidate read, link included. The text is the
 * one kept when the consent was sent (recordConsentShown): resolving it again now could give
 * another language or curation (the translator was down then, or is now).
 */
async function recordConsent(ctx: ApplyContext, effect: ConsentEffect): Promise<void> {
  const kept = await findConsentShown(ctx.tx, ctx.session.id, effect.consentKey);
  const shown =
    kept && kept.textVersion === effect.textVersion ? kept : await resolveConsentAgain(ctx, effect);
  await insertConsent(
    ctx.tx,
    {
      contactId: ctx.contact.id,
      channel: ctx.contact.channel,
      externalId: ctx.contact.externalId,
      sessionId: ctx.session.id,
      consentKey: effect.consentKey,
      textVersion: effect.textVersion,
      // The language the candidate actually read: Italian after a translation fallback.
      language: shown.language,
      textShown: shown.text,
      textShownIsCurated: shown.isCurated,
      linkShown: shown.linkShown,
      dataController: {
        name: effect.dataController.name,
        privacyUrl: effect.dataController.privacyUrl,
      },
      outcome: effect.outcome,
      messageId: ctx.answeringMessageId,
      decidedAt: new Date(effect.at),
    },
    ctx.consentHashSecret,
  );
  if (effect.consentKey === KUBRI_GLOBAL_CONSENT) {
    // Becomes is_kubri_privacy_accepted in the Kubri payload (plan 10).
    await setSharedWithGlobal(ctx.tx, ctx.session.id, effect.outcome === "accepted");
  }
}

/** A consent answered with no record of its sending (sessions from before D111f). */
async function resolveConsentAgain(
  ctx: ApplyContext,
  effect: ConsentEffect,
): Promise<{ text: string; language: string; isCurated: boolean; linkShown: string | null }> {
  ctx.logger.warn(
    { turnId: ctx.turnId, sessionId: ctx.session.id, consentKey: effect.consentKey },
    "consent answered without a record of its text: resolved again",
  );
  const resolved = await ctx.resolver.resolve(effect.text, {
    campaign: ctx.campaign,
    language: effect.language,
  });
  return { ...resolved, linkShown: resolved.linkShown ?? null };
}

/**
 * The roadmap's table of runtime duties, as code: one case per effect, in the engine's order,
 * in the turn's transaction. Replies are queued in one go at the end, in order; then the
 * turn's inbound messages get their session; the purge of a StopSession with the delete
 * policy comes last, so it reaches those messages too and the goodbye survives it (D109).
 */
export async function applyEffects(
  ctx: ApplyContext,
  effects: readonly Effect[],
): Promise<EffectsOutcome> {
  const { tx } = ctx;
  const target = {
    campaign: ctx.campaign,
    language: outputLanguage(ctx.finalState.language, ctx.campaign),
  };
  const replies: OutboundMessageInput[] = [];
  let completed = false;
  let stopped = false;
  let needsAttention = false;
  let purge = false;
  let language: string | null = null;

  for (const effect of effects) {
    switch (effect.type) {
      case "SendText": {
        const resolved = await ctx.resolver.resolveSend(effect, target);
        if (resolved.missingParams.length > 0) {
          ctx.logger.warn(
            {
              turnId: ctx.turnId,
              text: describeTextRef(effect.text),
              missing: resolved.missingParams,
            },
            "text with missing parameters",
          );
        }
        const consent = consentStepOf(effect.text, ctx.campaign);
        if (consent) {
          await recordConsentShown(tx, ctx.session.id, consent.consentKey, {
            textVersion: consent.textVersion,
            text: resolved.text,
            language: resolved.language,
            isCurated: resolved.isCurated,
            linkShown: resolved.linkShown ?? null,
          });
        }
        replies.push({
          contactId: ctx.contact.id,
          senderNumberId: ctx.session.senderNumberId,
          sessionId: ctx.session.id,
          turnId: ctx.turnId,
          body: resolved.text,
          language: resolved.language,
          stepId: ctx.finalState.stepId,
          questionId: ctx.finalState.questionId,
        });
        break;
      }
      case "ApplyPatch":
        await applyProfileFields(tx, ctx.session.id, effect.source, ctx.turnId, effect.fields);
        break;
      case "RecordPatchRejections":
        // Log only: field and reason, never a value (spec §8.4).
        ctx.logger.info({ turnId: ctx.turnId, effect: describeEffect(effect) }, "patch rejected");
        break;
      case "MarkFieldUnresolved":
        await markFieldUnresolved(tx, ctx.session.id, effect.field, ctx.turnId);
        break;
      case "RecordConsent":
        await recordConsent(ctx, effect);
        break;
      case "SetLanguage":
        language = effect.language;
        await setPreferredLanguage(tx, ctx.contact.id, effect.language);
        break;
      case "CompleteSession":
        completed = true;
        await markProfileCompleted(tx, ctx.session.id, new Date(effect.at));
        break;
      case "StopSession":
        stopped = true;
        purge = effect.dataPolicy === "delete";
        break;
      case "OptOut":
        await recordOptOut(tx, ctx.contact.id, ctx.session.senderNumberId, new Date(effect.at));
        break;
      case "EnqueueJob":
        await enqueueJob(ctx, effect.job);
        break;
      case "FlagSession":
        await recordFlag(
          tx,
          { sessionId: ctx.session.id, turnId: ctx.turnId, logger: ctx.logger },
          effect,
        );
        if (effect.needsAttention) needsAttention = true;
        break;
    }
  }

  await queueOutbound(tx, replies);
  await markInboundProcessed(
    tx,
    ctx.inbound.map((m) => ({
      id: m.id,
      sessionId: ctx.session.id,
      turnId: ctx.turnId,
      bodyRedacted: m.bodyRedacted,
    })),
  );
  if (purge) await purgeSessionData(tx, ctx.session.id);
  return { completed, stopped, purged: purge, needsAttention, language, outbound: replies.length };
}
