export type InterviewStatus = "completed" | "in_progress" | "abandoned" | "incomplete";
export type Availability = "immediate" | "within_1_month" | "other";
export type Channel = "telegram" | "whatsapp";

export interface WorkExperience {
  role: string;
  description: string;
  duration?: string;
}

export interface TranscriptEntry {
  question: string;
  answer: string;
}

export interface Candidate {
  id: string;
  name: string;
  nationality: string;
  languages: string[];
  skills: string[];
  workExperiences: WorkExperience[];
  availability: Availability;
  city: string;
  interviewStatus: InterviewStatus;
  interviewTranscript: TranscriptEntry[];
  channel: Channel;
  createdAt: Date;
  updatedAt: Date;
}

export interface CandidateFilters {
  search?: string;
  status?: InterviewStatus[];
  languages?: string[];
  nationality?: string;
  city?: string;
  availability?: Availability;
  dateFrom?: Date;
  dateTo?: Date;
}

export interface SortConfig {
  field: "name" | "createdAt" | "interviewStatus";
  direction: "asc" | "desc";
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
