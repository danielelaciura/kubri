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
  id: string;
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
