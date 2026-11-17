import { CHATBOT_CHANNEL, CHATBOT_SOURCE, type ChatbotCandidateWebhook } from "@kubri/contracts";
import type { Prisma } from "@/generated/prisma/client";
import type { PoolModel as Pool } from "@/generated/prisma/models/Pool";
import { resolveSharedWithGlobal } from "@/lib/pools/global-sharing";

/** Where the dashboard placed the candidate (geocoding or stored coordinates). */
export interface ChatbotCandidateGeo {
  latitude: number;
  longitude: number;
  /** "Comune (PROV)" of the result; null keeps the location the candidate declared. */
  location: string | null;
}

/**
 * The chatbot's validated payload → the input of `ingestCandidate`. The payload is the full,
 * current profile: a field the chatbot did not send is written as null (or an empty list).
 * Channel and source are fixed server side, never read from the payload.
 */
export function normalizeChatbotCandidate(
  payload: ChatbotCandidateWebhook,
  pool: Pick<Pool, "id" | "isGlobal" | "globalSharing">,
  geo: ChatbotCandidateGeo | null,
): Prisma.CandidateUncheckedCreateInput {
  const d = payload.data;
  const jp = d.job_preferences;
  const lp = d.learning_preferences;

  return {
    externalId: payload.key,
    poolId: pool.id,

    firstName: d.first_name ?? null,
    lastName: d.last_name ?? null,
    birthday: d.birthday ?? null,
    countryOfOrigin: d.country ?? null,
    address: d.address ?? null,
    location: geo?.location ?? d.location ?? null,
    latitude: geo?.latitude ?? null,
    longitude: geo?.longitude ?? null,
    phone: d.phone,
    email: d.email?.toLowerCase() ?? null,

    workingPermit: d.working_permit ?? null,
    meanOfTransport: d.transport ?? null,
    drivingLicense: d.driving_license ?? null,

    educationAndTraining: d.education_and_training ?? [],
    workExperience: d.work_experience ?? [],
    skillsAndCompetences: d.skills_and_competences ?? [],

    language: d.language ?? null,
    additionalLanguages: d.additional_languages ?? [],
    italianLevel: d.italian_level ?? null,

    desiredJob: jp?.preferred_job ?? null,
    partTimePreference: jp?.part_time_preference ?? null,
    preferredLocation: jp?.preferred_location ?? null,
    jobConstraints: jp?.constraints ?? null,
    hasDesiredJobExperience: jp?.has_desired_job_experience ?? null,

    learningPreference: lp?.learning_preference ?? null,

    interviewLanguage: d.interview_language ?? null,
    sourceOrganization: CHATBOT_SOURCE,
    channel: CHATBOT_CHANNEL,

    // Same rule as the Make webhook: the pool's mode may override the consent.
    sharedWithGlobal: resolveSharedWithGlobal(pool, d.is_kubri_privacy_accepted),

    // Parsed from JSON by the route, so it is JSON; `custom` is typed as unknown values.
    rawPayload: payload as unknown as Prisma.InputJsonValue,

    sourceUpdatedAt: new Date(d.last_updated),
  };
}
