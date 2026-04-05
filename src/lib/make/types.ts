// Raw record structure from Make.com Data Store
// Field names must match Make.com exactly
// NOTE: Actual field names to be confirmed from real API response
export interface MakeDataStoreRecord {
  id: string;
  name?: string;
  nationality?: string;
  languages?: string | string[];
  skills?: string | string[];
  work_experiences?: string | Record<string, unknown>;
  availability?: string;
  city?: string;
  flow_control?: string | Record<string, unknown>;
  interview_transcript?: string | Record<string, unknown>[];
  channel?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown; // Allow extra fields we haven't mapped yet
}

export interface MakeListResponse {
  records: MakeDataStoreRecord[];
  // Make.com may have different pagination fields
  count?: number;
}

export interface MakeErrorResponse {
  message: string;
  code?: string;
  status?: number;
}
