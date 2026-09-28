// Client-safe (no imports): used by server code and client components alike.

/** Journey order: used for the dropdown, the filter and validation. */
export const CANDIDATE_STATUSES = [
  "NEW",
  "SCREENING",
  "CONTACTED",
  "INTERVIEW",
  "OFFER",
  "HIRED",
  "REJECTED",
  "WITHDRAWN",
] as const;

export type CandidateStatusValue = (typeof CANDIDATE_STATUSES)[number];

/** An org that never touched a candidate sees it as NEW (no row stored). */
export const DEFAULT_CANDIDATE_STATUS: CandidateStatusValue = "NEW";

export type StatusByCandidate = Partial<Record<string, CandidateStatusValue>>;

export function isCandidateStatus(value: unknown): value is CandidateStatusValue {
  return (
    typeof value === "string" &&
    (CANDIDATE_STATUSES as readonly string[]).includes(value)
  );
}

export function resolveStatus(
  statusByCandidate: StatusByCandidate,
  candidateId: string,
): CandidateStatusValue {
  return statusByCandidate[candidateId] ?? DEFAULT_CANDIDATE_STATUS;
}

export function filterByStatus<T extends { id: string }>(
  candidates: T[],
  statusByCandidate: StatusByCandidate,
  status: CandidateStatusValue | undefined,
): T[] {
  if (!status) return candidates;
  return candidates.filter(
    (c) => resolveStatus(statusByCandidate, c.id) === status,
  );
}
