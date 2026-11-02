import {
  CHATBOT_CHANNEL,
  CHATBOT_SOURCE,
  chatbotCandidateWebhookSchema,
  type ChatbotCandidateWebhook,
  type ChatbotInterviewStatus,
} from "@kubri/contracts";
import type { StoredProfile } from "../../runtime/profile-codec";
import type { SessionStatusName } from "../../store/sessions";

/** Everything the payload is built from, read from the database at send time (D125, R5). */
export interface KubriSnapshot {
  readonly contact: { readonly id: string; readonly phoneE164: string };
  readonly campaign: {
    readonly id: string;
    readonly externalKey: string;
    readonly version: number;
  };
  readonly session: {
    readonly status: SessionStatusName;
    readonly language: string | null;
    /** Moves with every turn that saves the session, status changes included. */
    readonly lastActivityAt: Date;
  };
  readonly profile: StoredProfile & {
    readonly sharedWithGlobal: boolean;
    readonly updatedAt: Date;
  };
}

/**
 * The payload would break the shared contract (D122, R4): a bug in the mapping or a stored
 * value the contract refuses. Sending it again would fail the same way (D126). Only the paths
 * of the problems are kept: the values are personal data.
 */
export class KubriContractError extends Error {
  constructor(readonly paths: readonly string[]) {
    super(`payload breaks the chatbot candidate contract at: ${paths.join(", ")}`);
    this.name = "KubriContractError";
  }
}

type Data = Record<string, unknown>;
type Mapping = readonly (readonly [string, string])[];

const STATUS: Readonly<Record<SessionStatusName, ChatbotInterviewStatus>> = {
  active: "in_progress",
  needs_attention: "in_progress",
  completed: "completed",
  stopped: "stopped",
  abandoned: "stopped",
};

/**
 * Profile field → key in `data` (spec §12.1, D123). Not `lat`/`lng` (the dashboard geocodes,
 * D124) nor `phone` (the contact's number is the one that counts).
 */
const DIRECT: Mapping = [
  ["firstName", "first_name"],
  ["lastName", "last_name"],
  ["country", "country"],
  ["address", "address"],
  ["location", "location"],
  ["email", "email"],
  ["workingPermit", "working_permit"],
  ["transport", "transport"],
  ["drivingLicense", "driving_license"],
  ["drivingLicenseTypes", "driving_license_types"],
  ["educationAndTraining", "education_and_training"],
  ["workExperience", "work_experience"],
  ["skillsAndCompetences", "skills_and_competences"],
  ["language", "language"],
  ["additionalLanguages", "additional_languages"],
  ["italianLevel", "italian_level"],
];

const JOB_PREFERENCES: Mapping = [
  ["jobPreferences.preferredJob", "preferred_job"],
  ["jobPreferences.partTime", "part_time_preference"],
  ["jobPreferences.preferredLocation", "preferred_location"],
  ["jobPreferences.constraints", "constraints"],
  ["jobPreferences.hasDesiredJobExperience", "has_desired_job_experience"],
];

const LEARNING_PREFERENCES: Mapping = [
  ["learningPreferences.isInterested", "is_interested"],
  ["learningPreferences.preference", "learning_preference"],
];

/** A missing value: absent, null or blank. The receiver reads an omitted key as "empty". */
const isAbsent = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === "string" && value.trim() === "");

function pick(source: Readonly<Record<string, unknown>>, mapping: Mapping): Data {
  const out: Data = {};
  for (const [from, to] of mapping) {
    const value = Object.hasOwn(source, from) ? source[from] : undefined;
    if (!isAbsent(value)) out[to] = value;
  }
  return out;
}

/** "1990-05-12" → "12/05/1990" (spec §6). Anything else passes through for the contract to refuse. */
function toItalianDate(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3] ?? ""}/${match[2] ?? ""}/${match[1] ?? ""}` : value;
}

/**
 * The dashboard keeps the newest send by `last_updated` (D125): it must move when the profile
 * changes and when only the session does (a stop, a completion), or such a send looks stale.
 */
const lastUpdated = (snapshot: KubriSnapshot): Date =>
  snapshot.session.lastActivityAt > snapshot.profile.updatedAt
    ? snapshot.session.lastActivityAt
    : snapshot.profile.updatedAt;

const nonEmpty = (value: Data): Data | undefined =>
  Object.keys(value).length > 0 ? value : undefined;

/**
 * Spec §12.1: the current profile in the keys the dashboard reads. The result goes through the
 * shared contract before it leaves (D122): a mapping that drifts fails here, as a
 * KubriContractError, not in the dashboard.
 */
export function buildKubriPayload(snapshot: KubriSnapshot): ChatbotCandidateWebhook {
  const { profile, contact, campaign, session } = snapshot;
  const standard = profile.standard;
  const birthday = Object.hasOwn(standard, "birthday") ? standard["birthday"] : undefined;
  const data: Data = {
    source_organization: CHATBOT_SOURCE,
    channel: CHATBOT_CHANNEL,
    interview_status: STATUS[session.status],
    campaign_version: campaign.version,
    last_updated: lastUpdated(snapshot).toISOString(),
    is_kubri_privacy_accepted: profile.sharedWithGlobal,
    phone: contact.phoneE164,
    ...(session.language ? { interview_language: session.language } : {}),
    ...pick(standard, DIRECT),
    ...(isAbsent(birthday) ? {} : { birthday: toItalianDate(birthday) }),
  };
  const jobPreferences = nonEmpty(pick(standard, JOB_PREFERENCES));
  if (jobPreferences) data["job_preferences"] = jobPreferences;
  const learningPreferences = nonEmpty(pick(standard, LEARNING_PREFERENCES));
  if (learningPreferences) data["learning_preferences"] = learningPreferences;
  const custom = nonEmpty({ ...profile.custom });
  if (custom) data["custom"] = custom;

  const result = chatbotCandidateWebhookSchema.safeParse({
    key: `${contact.id}:${campaign.id}`,
    externalKey: campaign.externalKey,
    data,
  });
  if (!result.success) {
    throw new KubriContractError(result.error.issues.map((issue) => issue.path.join(".")));
  }
  return result.data;
}
