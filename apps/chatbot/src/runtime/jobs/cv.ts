import type { Logger } from "pino";
import type { ChannelAdapter, OutboundSender, UploadOutcome } from "../../channels/channel";
import { outputLanguage, type ResolvedText, type TextResolver } from "../../i18n/resolve";
import { buildCvLayout } from "../../integrations/cv/layout";
import { renderCv } from "../../integrations/cv/render";
import { findCampaignVersion } from "../../store/campaigns";
import { inTransaction, lockKey, type Database, type Tx } from "../../store/db";
import { hasCvMessageForTurn, queueOutbound, type OutboundDocument } from "../../store/messages";
import { failureOutput, type JobAttempt, type JobPayloads, type JobQueue } from "../../store/queue";
import { findOutboundSender } from "../../store/senders";
import { loadSnapshot, type Snapshot } from "../../store/snapshot";
import { hasFlagForTurn, insertFlag } from "../../store/turns";
import { reportFailureTransactionMs, type RuntimeConfig } from "../config";
import { withDeadline } from "../deadline";
import { StoredDataError } from "../stored-data-error";
import { TransientJobError } from "./errors";

export interface CvJobDeps {
  readonly db: Database;
  readonly config: RuntimeConfig;
  readonly logger: Logger;
  readonly queue: JobQueue;
  readonly resolver: TextResolver;
  readonly channelFor: (provider: OutboundSender["provider"]) => ChannelAdapter;
  readonly now: () => Date;
}

export type CvJobResult = "sent" | "skipped" | "failed";

/** The name the candidate sees in WhatsApp (R8). */
export const CV_FILENAME = "CV.pdf";
/** The flag of a CV that could not be made (D131): no needs_attention. */
export const CV_FAILED = "cv_failed";

type Job = JobPayloads["cv"];

/** Why the job stops before doing anything; null = go on. Read again under the lock. */
async function skipReason(tx: Tx, job: Job, snapshot: Snapshot | null): Promise<string | null> {
  if (!snapshot) return "session gone";
  // An opt-out or a deletion stops the session: no more messages, the CV included (R8).
  if (snapshot.session.status === "stopped") return "session stopped";
  if (await hasCvMessageForTurn(tx, job.sessionId, job.turnId)) return "already sent";
  if (await hasFlagForTurn(tx, job.sessionId, job.turnId, CV_FAILED)) return "already failed";
  return null;
}

/** A catalog text in the session's language, within the NLU deadline (D72: else Italian). */
async function catalogText(
  deps: CvJobDeps,
  snapshot: Snapshot,
  key: "cv.ready" | "cv.failed",
): Promise<ResolvedText> {
  const campaign = await findCampaignVersion(deps.db, snapshot.campaign.versionId);
  if (!campaign) throw new StoredDataError("the session's campaign version is gone");
  return deps.resolver.withDeadline(Date.now() + deps.config.nluDeadlineMs).resolveKey(key, {
    campaign: campaign.definition,
    language: outputLanguage(snapshot.session.language, campaign.definition),
  });
}

/** A message for the candidate: its text and, for the CV itself, the uploaded document. */
interface CandidateMessage {
  readonly text: ResolvedText;
  readonly document: OutboundDocument | null;
}

/**
 * One message for the candidate (or none), with its send, under the contact's lock (the lock a
 * turn holds): the checks of skipReason are repeated there, so a turn that stopped the session
 * or a concurrent run of this job wins.
 */
async function queueForCandidate(
  deps: CvJobDeps,
  job: Job,
  contactId: string,
  message: CandidateMessage | null,
  extra: (tx: Tx) => Promise<void>,
): Promise<boolean> {
  return inTransaction(
    deps.db,
    async (tx) => {
      await lockKey(tx, `contact:${contactId}`);
      const current = await loadSnapshot(tx, job.sessionId);
      const skip = await skipReason(tx, job, current);
      if (skip !== null || !current) {
        deps.logger.info({ ...job, reason: skip }, "cv skipped under the lock");
        return false;
      }
      if (message) {
        const key = {
          contactId: current.contact.id,
          senderNumberId: current.session.senderNumberId,
        };
        await queueOutbound(tx, [
          {
            ...key,
            sessionId: job.sessionId,
            turnId: job.turnId,
            body: message.text.text,
            language: message.text.language,
            stepId: null,
            questionId: null,
            document: message.document,
          },
        ]);
        await deps.queue.enqueue("send-messages", key, {}, tx);
      }
      await extra(tx);
      return true;
    },
    // It may wait for a whole turn to release the contact's lock.
    reportFailureTransactionMs(deps.config),
  );
}

/** The error's name or code, for a log line: never its message (it can carry values). */
function errorCode(error: unknown): string {
  const output = failureOutput(error);
  return output.code ?? output.name;
}

const cvFailedFlag = (job: Job) => ({
  sessionId: job.sessionId,
  turnId: job.turnId,
  reason: CV_FAILED,
  field: null,
  needsAttention: false,
});

/**
 * D131: the candidate hears it once, the session gets the flag; nothing is retried. When the
 * `cv.failed` text cannot be resolved, the flag goes on alone: the operator still sees it.
 */
async function giveUp(
  deps: CvJobDeps,
  job: Job,
  snapshot: Snapshot,
  code: string,
): Promise<CvJobResult> {
  deps.logger.warn({ ...job, code }, "cv failed for good");
  let text: ResolvedText | null = null;
  try {
    text = await catalogText(deps, snapshot, "cv.failed");
  } catch (error: unknown) {
    deps.logger.error({ ...job, code: errorCode(error) }, "cv.failed text unavailable: flag only");
  }
  const queued = await queueForCandidate(
    deps,
    job,
    snapshot.contact.id,
    text ? { text, document: null } : null,
    (tx) => insertFlag(tx, cvFailedFlag(job)),
  );
  return queued ? "failed" : "skipped";
}

/**
 * The last attempt failed in an unexpected way (catalog, stored data, lock timeout, …): give up
 * as far as possible, best effort. Without a readable snapshot (or if the locked give-up fails
 * too) only the flag is written, once, without the lock: flags never conflict with a turn. If
 * even that fails, the original error goes on to pg-boss (dead letter). Ids and codes only.
 */
async function giveUpAfterError(deps: CvJobDeps, job: Job, error: unknown): Promise<CvJobResult> {
  const code = errorCode(error);
  try {
    const snapshot = await loadSnapshot(deps.db, job.sessionId);
    if (!snapshot) return "skipped";
    return await giveUp(deps, job, snapshot, code);
  } catch (giveUpError: unknown) {
    deps.logger.error(
      { ...job, code, giveUpCode: errorCode(giveUpError) },
      "cv give-up failed: flag only",
    );
  }
  try {
    if (await hasFlagForTurn(deps.db, job.sessionId, job.turnId, CV_FAILED)) return "skipped";
    await insertFlag(deps.db, cvFailedFlag(job));
    return "failed";
  } catch (flagError: unknown) {
    deps.logger.error({ ...job, code, flagCode: errorCode(flagError) }, "cv_failed flag not saved");
    throw error;
  }
}

async function upload(
  deps: CvJobDeps,
  channel: ChannelAdapter,
  sender: OutboundSender,
  bytes: Uint8Array,
): Promise<UploadOutcome> {
  if (!channel.uploadDocument) return { ok: false, kind: "permanent", code: "upload_unsupported" };
  const uploadDocument = channel.uploadDocument.bind(channel);
  try {
    const call = Promise.resolve().then(() =>
      uploadDocument({ bytes, filename: CV_FILENAME, mimeType: "application/pdf" }, sender),
    );
    const result = await withDeadline(call, deps.config.sendCallTimeoutMs);
    return result.timedOut
      ? { ok: false, kind: "transient", code: "upload_timeout" }
      : result.value;
  } catch {
    // An adapter that throws is a broken connection, not a verdict on the file.
    return { ok: false, kind: "transient", code: "channel_exception" };
  }
}

/**
 * R8: the CV the candidate asked for in `turnId`, made in memory and sent as a WhatsApp
 * document. Nothing is stored but the message (mediaRef = the provider's id). The upload runs
 * outside any transaction; the message and its send are queued together under the contact's
 * lock. A transient failure throws for pg-boss to retry; a definitive one, or any failure on
 * the last attempt, ends with `cv.failed` and the `cv_failed` flag (D131). Ids and codes only
 * in the logs: never the CV.
 */
export async function handleCv(
  deps: CvJobDeps,
  job: Job,
  attempt: JobAttempt,
): Promise<CvJobResult> {
  try {
    return await makeAndQueue(deps, job, attempt);
  } catch (error: unknown) {
    if (!attempt.lastAttempt) throw error;
    return giveUpAfterError(deps, job, error);
  }
}

async function makeAndQueue(deps: CvJobDeps, job: Job, attempt: JobAttempt): Promise<CvJobResult> {
  const snapshot = await loadSnapshot(deps.db, job.sessionId);
  const skip = await skipReason(deps.db, job, snapshot);
  if (skip !== null || !snapshot) {
    deps.logger.info({ ...job, reason: skip }, "cv skipped");
    return "skipped";
  }
  let bytes: Uint8Array;
  try {
    bytes = await renderCv(buildCvLayout(snapshot.profile.standard, snapshot.contact.phoneE164));
  } catch {
    // Rendering is deterministic: the same profile would fail again.
    return giveUp(deps, job, snapshot, "render_failed");
  }
  const sender = await findOutboundSender(deps.db, snapshot.session.senderNumberId);
  const outcome = await upload(deps, deps.channelFor(sender.provider), sender, bytes);
  if (!outcome.ok) {
    if (outcome.kind === "permanent" || attempt.lastAttempt) {
      return giveUp(deps, job, snapshot, outcome.code);
    }
    deps.logger.warn(
      { ...job, code: outcome.code, retryCount: attempt.retryCount },
      "cv upload failed: retrying",
    );
    throw new TransientJobError(outcome.code);
  }
  const caption = await catalogText(deps, snapshot, "cv.ready");
  const queued = await queueForCandidate(
    deps,
    job,
    snapshot.contact.id,
    { text: caption, document: { mediaRef: outcome.mediaId, filename: CV_FILENAME } },
    () => Promise.resolve(),
  );
  if (!queued) return "skipped";
  deps.logger.info(job, "cv queued");
  return "sent";
}
