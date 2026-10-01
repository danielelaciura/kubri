# Candidate Status Tracking — Design

**Date:** 2026-09-28
**Status:** Approved (brainstorming)

## Goal

Let each client organization track where a candidate is in its hiring journey
(new → screening → contacted → interview → offer → hired, or rejected/withdrawn),
change it with a simple dropdown, and filter the candidate list by it.

## Key decision: status is per organization

A `Candidate` can be visible to several organizations at once (`OrganizationPool`,
`sharedWithGlobal`). Status therefore belongs to the `(candidate, organization)`
pair, exactly like `CandidateNote`. Org A moving a candidate to "Interview" does
not affect what Org B sees.

This also keeps the `Candidate` row untouched: the Make webhook remains the only
writer of `Candidate` (CLAUDE.md rule).

## Status values

| Enum | IT | EN | Meaning |
|------|----|----|---------|
| `NEW` | Nuovo | New | Arrived via webhook, not yet reviewed (initial state) |
| `CONTACTED` | Contattato | Contacted | First contact made |
| `SCREENING` | In valutazione | Screening | Candidate is being evaluated after contact |
| `INTERVIEW` | Colloquio | Interview | Interview scheduled or held |
| `OFFER` | Offerta | Offer | Job offer made |
| `HIRED` | Assunto | Hired | Positive exit |
| `NOT_SELECTED` | Non selezionato | Not selected | Negative exit (from any step) |

*Revised 2026-10-01: Contacted now precedes Screening; "Proposta" → "Offerta";
`REJECTED` and `WITHDRAWN` merged into a single `NOT_SELECTED`.*

Transitions are **not enforced**: any status can be set from any status (to fix
mistakes, reject straight from `NEW`, etc.). The order above is the display order
in the dropdown and in the filter.

## Data model

```prisma
enum CandidateStatusValue {
  NEW
  CONTACTED
  SCREENING
  INTERVIEW
  OFFER
  HIRED
  NOT_SELECTED
}

model CandidateStatus {
  candidateId     String               @db.Uuid
  organizationId  String               @db.Uuid
  status          CandidateStatusValue
  updatedByUserId String?              @db.Uuid
  updatedAt       DateTime             @updatedAt

  candidate    Candidate    @relation(fields: [candidateId], references: [id], onDelete: Cascade)
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  updatedBy    User?        @relation(fields: [updatedByUserId], references: [id], onDelete: SetNull)

  @@id([candidateId, organizationId])
  @@index([organizationId, status])
}
```

- **No row = `NEW`.** No backfill, no webhook change. A row is created the first
  time an operator changes the status.
- Migration is purely additive. Hand-author it (worktree has no DB) and make sure
  it does **not** contain the spurious `DROP INDEX` for the pgvector HNSW indexes.
- History is not stored in a dedicated table (YAGNI). Every change writes an
  `AuditLog` entry (`action: "candidate.status.change"`,
  `resourceType: "candidate"`, `resourceId: candidateId`,
  `metadata: { from, to }`), which is enough for GDPR audit and for a future
  funnel/time-in-stage report.

## Service layer — `src/lib/candidates/status.ts`

- `CANDIDATE_STATUSES` — ordered readonly array of the enum values (single source
  for dropdown/filter order and Zod enum).
- `DEFAULT_CANDIDATE_STATUS = "NEW"`.
- `getStatusByCandidateForOrg(organizationId): Promise<Record<string, CandidateStatusValue>>`
  — one query scoped by `organizationId`, mirrors `getListIdsByCandidateForOrg`.
- `getCandidateStatusForOrg(organizationId, candidateId): Promise<CandidateStatusValue>`
  — returns `NEW` when no row exists.
- `resolveStatus(map, candidateId)` — `map[candidateId] ?? "NEW"` (pure, tested).

## Write path — server action `setCandidateStatus`

Location: `src/app/(dashboard)/dashboard/candidates/[id]/actions.ts` (next to
`addNote`), reusing `requireCandidateAccess`.

1. `getCurrentUser()`; require `organizationId`.
2. Zod: `{ candidateId: uuid, status: z.enum(CANDIDATE_STATUSES) }`.
3. `requireCandidateAccess(organizationId, candidateId, role)` — an org cannot set
   status on a candidate it cannot see.
4. In a `prisma.$transaction`: read previous status (default `NEW`), `upsert` the
   `CandidateStatus` row, write the audit log entry. No-op (no write, no audit)
   if the status is unchanged.
5. `revalidatePath` for the candidate detail and the candidates list.

Permissions: `ORG_MEMBER`, `ORG_ADMIN`, and `ADMIN_KUBRI` can all change status;
each always acts on **its own** organization's status (ADMIN_KUBRI sets the Kubri
org's status, like its notes). Error messages go through the dictionary.

## UI

All strings in `src/lib/i18n/dictionaries/it.ts` and `en.ts` (new
`candidateStatus` group: label per value, "Status" column/filter label, "All
statuses", update error message).

- **`CandidateStatusSelect`** (`src/components/candidates/candidate-status-select.tsx`,
  client component): shadcn `DropdownMenu` whose trigger is a coloured `Badge`
  showing the current status; items listed in `CANDIDATE_STATUSES` order with the
  current one checked. Calls `setCandidateStatus` via `useTransition`, applies the
  new value optimistically; on failure reverts and shows a small inline error
  message under the badge (no toast library in the project — do not add one).
- **Candidate detail page:** the select sits next to the candidate's name.
- **Candidates table:** new "Status" column rendering the same select, so
  operators can triage without opening the profile. The page passes a
  `statusByCandidate` map, like `membershipByCandidate`. Clicking the select must
  not trigger row navigation.
- **Filters:** new "Status" select in `CandidateFilters`, URL param `?status=`.
  `candidateFiltersSchema` gets `status: z.enum(CANDIDATE_STATUSES).optional()`.
  Filtering happens in memory on the page (as for `listId`) using
  `resolveStatus`, so filtering by `NEW` includes candidates with no row.
- **CSV export:** add a localized "Status" column, resolved for the requesting
  user's organization; honour the `?status=` filter too.

Badge colours (Tailwind, subtle): neutral for `NEW`, blue-ish for the in-progress
steps (`CONTACTED`…`OFFER`), green for `HIRED`, red for `NOT_SELECTED`.

## Out of scope

- Enforced transitions / workflow rules.
- Dedicated status history table and funnel stats.
- Status in the PDF export and in the email digest.
- Bulk status change from the table.

## Testing (vitest)

- `resolveStatus` / filter: missing row resolves to `NEW`; `?status=NEW` includes
  row-less candidates; other statuses match exactly.
- `candidateFiltersSchema` accepts valid statuses, rejects unknown ones.
- `setCandidateStatus`: rejects invalid input, rejects inaccessible candidate,
  upserts + audits on change, no-op when unchanged (Prisma mocked, like existing
  action tests).
- Dictionary parity test (existing) covers the new keys.

## Deploy

Schema change → follow the standard flow: `migrate deploy` on prod **before**
merging the PR.
