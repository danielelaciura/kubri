import type { MakeDataStoreRecord } from "./types";
import type {
  Candidate,
  InterviewStatus,
  Availability,
  Channel,
  WorkExperience,
  TranscriptEntry,
} from "@/types";

const VALID_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "in_progress",
  "abandoned",
  "incomplete",
]);

const VALID_AVAILABILITIES: ReadonlySet<string> = new Set([
  "immediate",
  "within_1_month",
  "other",
]);

const VALID_CHANNELS: ReadonlySet<string> = new Set(["telegram", "whatsapp"]);

function parseStringOrArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function parseFlowControl(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function deriveInterviewStatus(flowControl: unknown): InterviewStatus {
  const parsed = parseFlowControl(flowControl);
  if (!parsed) return "incomplete";
  const status = typeof parsed["status"] === "string" ? parsed["status"] : "";
  if (VALID_STATUSES.has(status)) return status as InterviewStatus;
  return "incomplete";
}

function parseWorkExperiences(value: unknown): WorkExperience[] {
  if (!value) return [];

  let data: unknown = value;
  if (typeof value === "string") {
    try {
      data = JSON.parse(value);
    } catch {
      return [];
    }
  }

  if (Array.isArray(data)) {
    return data.map((item) => {
      const obj = item as Record<string, unknown>;
      return {
        role: typeof obj["role"] === "string" ? obj["role"] : "",
        description: typeof obj["description"] === "string" ? obj["description"] : "",
        duration: typeof obj["duration"] === "string" ? obj["duration"] : undefined,
      };
    });
  }

  return [];
}

function parseTranscript(value: unknown): TranscriptEntry[] {
  if (!value) return [];

  let data: unknown = value;
  if (typeof value === "string") {
    try {
      data = JSON.parse(value);
    } catch {
      return [];
    }
  }

  if (Array.isArray(data)) {
    return data.map((item) => {
      const obj = item as Record<string, unknown>;
      return {
        question: typeof obj["question"] === "string" ? obj["question"] : "",
        answer: typeof obj["answer"] === "string" ? obj["answer"] : "",
      };
    });
  }

  return [];
}

function parseDate(value: unknown): Date {
  if (!value) return new Date();
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function parseAvailability(value: unknown): Availability {
  if (typeof value === "string" && VALID_AVAILABILITIES.has(value)) {
    return value as Availability;
  }
  return "other";
}

function parseChannel(value: unknown): Channel {
  if (typeof value === "string" && VALID_CHANNELS.has(value)) {
    return value as Channel;
  }
  return "telegram";
}

export function normalizeCandidate(raw: MakeDataStoreRecord): Candidate {
  return {
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name : "",
    nationality: typeof raw.nationality === "string" ? raw.nationality : "",
    languages: parseStringOrArray(raw.languages),
    skills: parseStringOrArray(raw.skills),
    workExperiences: parseWorkExperiences(raw.work_experiences),
    availability: parseAvailability(raw.availability),
    city: typeof raw.city === "string" ? raw.city : "",
    interviewStatus: deriveInterviewStatus(raw.flow_control),
    interviewTranscript: parseTranscript(raw.interview_transcript),
    channel: parseChannel(raw.channel),
    createdAt: parseDate(raw.created_at),
    updatedAt: parseDate(raw.updated_at),
  };
}

export function normalizeCandidates(records: MakeDataStoreRecord[]): Candidate[] {
  return records.map(normalizeCandidate);
}
