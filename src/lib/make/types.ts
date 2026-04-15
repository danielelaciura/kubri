// Raw record structure from Make.com Data Store
// Field names must match Make.com exactly

export interface MakeLanguages {
  language?: string;
  additional_languages?: string;
}

export interface MakeJobPreferences {
  desired_job?: string;
  part_time_preference?: boolean;
  preferred_location?: string;
  constraints?: string;
  has_desired_job_experience?: string;
}

export interface MakeFlowControl {
  is_privacy_text_sent?: boolean;
  is_cvGeneration_asked?: string;
  row_number?: string;
}

export interface MakeRecordData {
  key: string;
  threadId?: string;
  tgThreadId?: string;
  source_organization?: string;
  language?: string;
  consent?: boolean;
  first_name?: string;
  last_name?: string;
  date_of_birth?: string;
  country_of_origin?: string;
  address?: string;
  phone?: string;
  legal_status?: string;
  working_permit?: string;
  transport?: string;
  education_and_training?: string[];
  work_experience?: string[];
  skills_and_competences?: string[];
  languages?: MakeLanguages;
  driving_license?: string;
  job_preferences?: MakeJobPreferences;
  centro_per_impiego?: string;
  create_cv?: boolean;
  interview_complete?: boolean;
  cvPdfLink?: string;
  cvDocLink?: string;
  last_updated?: string;
  flow_control?: MakeFlowControl;
  other_info?: string;
  [key: string]: unknown; // Allow extra fields we haven't mapped yet
}

export interface MakeDataStoreRecord {
  key: string;
  data: MakeRecordData;
}

export interface MakePagination {
  limit: number;
  offset: number;
  sortBy?: string;
  sortDir?: string;
}

export interface MakeListResponse {
  records: MakeDataStoreRecord[];
  count?: number;
  pg?: MakePagination;
}

export interface MakeErrorResponse {
  message: string;
  code?: string;
  status?: number;
}
