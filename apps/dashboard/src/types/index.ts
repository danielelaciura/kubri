import type { CandidateStatusValue } from "@/lib/candidates/status";

export type Channel = "telegram" | "whatsapp";

export interface Languages {
  language: string;
  additionalLanguages: string[];
}

export interface JobPreferences {
  desiredJob: string;
  partTimePreference: boolean;
  preferredLocation: string;
  constraints: string;
  hasDesiredJobExperience: string;
}

export interface Candidate {
  /** Postgres primary key (UUID). Used as the candidate identifier across the app and in URLs. */
  id: string;
  /** External ID (Make.com record key). Kept for audit/debug; not used to fetch records. */
  externalId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  countryOfOrigin: string;
  address: string;
  phone: string;
  legalStatus: string;
  workingPermit: boolean;
  meanOfTransport: string;
  educationAndTraining: string[];
  workExperience: string[];
  skillsAndCompetences: string[];
  languages: Languages;
  drivingLicense: boolean;
  jobPreferences: JobPreferences;
  centroPerImpiego: string;
  interviewLanguage: string;
  sourceOrganization: string;
  channel: Channel;
  consent: boolean;
  cvPdfLink: string;
  cvDocLink: string;
  latitude: number | null;
  longitude: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CandidateFilters {
  search?: string;
  languages?: string[];
  countryOfOrigin?: string;
  city?: string;
  dateFrom?: Date;
  dateTo?: Date;
  nearPlace?: string;
  radiusKm?: number;
  listId?: string;
  status?: CandidateStatusValue;
}

export interface SortConfig {
  field: "firstName" | "lastName" | "createdAt";
  direction: "asc" | "desc";
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
