# Candidate creation (manual form + CV import) — Design

**Date:** 2026-10-23
**Status:** Approved in brainstorming, pending spec review
**Scope:** `apps/dashboard`, `packages/contracts`

## Goal

Let operators create candidates directly from the dashboard in two modes:

1. **Manual** — fill in a form.
2. **CV import** — upload a CV (PDF, DOCX, JPG, PNG); an LLM converts it into a
   pre-filled form the operator reviews and confirms.

The document → structured data pipeline must be reusable by two planned
follow-up features, which this design prepares for but does not build:

- **Public upload link** — a private, time-limited web page where a candidate
  uploads their own CV and reviews the imported data.
- **Bulk import** — many CVs uploaded at once inside the platform, processed
  in the background.

All three entry points target the same entity (`Candidate`); they differ in
who uploads, how they authenticate, and who reviews the extracted data.

| Entry point | Uploader | Auth | Review |
|---|---|---|---|
| Dashboard (this spec) | operator | session | operator, pre-filled form |
| Public link (later) | candidate | link token | candidate, own data |
| Bulk import (later) | operator | session | async, optional review queue |

Out of scope (YAGNI): editing existing candidates, multiple documents per
candidate, a list of pending imports, the public link, bulk import, an
"origin" filter on the candidates list.

## Background / constraints

- `Candidate` is already written by two paths: the Make webhook
  (`api/webhooks/make/candidate`) and the assessment webhook
  (`api/webhooks/assessment`). Each inlines the same sequence
  (Zod → pool resolution → upsert → embedding). This feature adds a third
  path, so the sequence is extracted into one shared service.
- **This changes a rule in CLAUDE.md** ("the webhook is the only sanctioned
  write path; the UI is read-only on candidate fields"). The new rule: every
  write to `Candidate` goes through `ingestCandidate`; the sanctioned callers
  are the Make webhook, the assessment webhook, dashboard candidate creation,
  and backfill scripts. CLAUDE.md is updated in the UI PR.
- Mistral (EU-hosted, JSON mode) is already used in `src/lib/llm/` for rerank
  and the assessment report. Sending CV text to it is consistent with current
  practice. The "no external provider" rule applies to **embeddings** only,
  which keep using the Supabase Edge Function.
- `src/lib/llm/` has two overlapping Mistral wrappers (`client.ts`
  `chatCompletion` and `mistral.ts` `callMistralJson`). The new
  structured-extraction helper builds on `chatCompletion`; `callMistralJson`
  callers are migrated onto it and the file removed.
- The target population often has **photographed or scanned CVs**; text-layer
  extraction alone returns empty text for these, so OCR is required.

## Architecture

### Approach

A persisted `CandidateImport` entity with an explicit state machine, executed
**synchronously** in the request for now. The public link and bulk import
reuse the same entity with a different `origin`; bulk import later runs
extraction in the background (`after()` or the existing cron) without
changing the model.

Rejected: a stateless extract-then-save endpoint (follow-up features would
have to reinvent state, resumability and error tracking; a closed tab loses
the paid extraction), and a real queue (Inngest / Supabase Queues — premature;
can be layered on later).

### Modules (generic at the bottom, specific at the top)

```
src/lib/documents/extract-text.ts
    extractText({ bytes, mimeType, fileName })
      → { text, method: "pdf" | "docx" | "ocr", pageCount }
    Strategies: unpdf (digital PDF), mammoth (DOCX), Mistral OCR (images,
    or PDFs whose text layer is empty/near-empty). Knows nothing about
    candidates.

src/lib/llm/structured.ts
    extractStructured<T>({ schema: ZodType<T>, instructions, text, ... })
      → T
    Mistral JSON mode → Zod validation → on failure, one retry with the
    validation error fed back → LLMError. Generic; reusable for e.g. JD import.

src/lib/candidates/cv-extraction.ts
    extractCandidateDraft(text) → CandidateDraftResult
    Prompt + schema + normalization (enums, booleans, empty arrays) +
    per-field soft validation.

src/lib/candidates/ingest.ts
    ingestCandidate({ poolId, externalId, fields, rawPayload, channel, ... })
      → { candidateId }
    Upsert + embedding (embedding failure logged, left null for the nightly
    cron). Used by BOTH existing webhooks after refactor and by this feature.
    Accepts an optional Prisma transaction client.

src/lib/candidate-imports/service.ts
    createImport, runExtraction, confirmImport, discardImport,
    getImportForOrg. Orchestration + state transitions. No auth/UI logic —
    callers (server actions now, public-link route later) do auth.

src/lib/storage/candidate-documents.ts
    upload, createSignedUrl (60 s), remove — on the private bucket
    `candidate-documents`, server-side with the service role only.
```

`candidateDraftSchema` (the field set + types the LLM must return and the
form edits) lives in `@kubri/contracts`, so a public page in another app can
share it.

### LLM output shape

```ts
{
  isCv: boolean,
  fields: {
    firstName: { value: string | null, uncertain: boolean },
    ...one entry per Candidate profile field...
  }
}
```

Fields covered: all `Candidate` profile fields that exist today
(`firstName`, `lastName`, `birthday`, `countryOfOrigin`, `address`,
`location`, `phone`, `email`, `workingPermit`, `meanOfTransport`,
`drivingLicense`, `educationAndTraining[]`, `workExperience[]`,
`skillsAndCompetences[]`, `language`, `additionalLanguages[]`,
`italianLevel`, `desiredJob`, `partTimePreference`, `preferredLocation`,
`jobConstraints`). Closed-set fields default to `null` ("not stated") —
the prompt forbids guessing. `latitude`/`longitude` are derived by the
existing geo helpers from `location`, not by the LLM.

### Data model

New enums: `CandidateImportOrigin` (`OPERATOR`, `PUBLIC_LINK`, `BULK`),
`CandidateImportStatus` (`UPLOADED`, `EXTRACTING`, `READY`, `COMPLETED`,
`FAILED`, `DISCARDED`), `CandidateDocumentKind` (`CV`).

**`CandidateImport`** — a process record, prunable.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `organizationId` | uuid FK | scoping |
| `poolId` | uuid FK | target pool |
| `origin` | `CandidateImportOrigin` | |
| `status` | `CandidateImportStatus` | |
| `createdById` | uuid FK? | null for public link |
| `storagePath` | string | `{poolId}/{importId}/{sanitizedFileName}` |
| `fileName`, `mimeType`, `fileSize` | | |
| `extractedText` | text? | |
| `extractionMethod` | string? | `pdf` / `docx` / `ocr` |
| `draft` | Json? | LLM output after normalization |
| `errorCode` | string? | see Error handling |
| `candidateId` | uuid FK? | set on `COMPLETED` |
| `createdAt`, `updatedAt` | | |

Indexes: `[organizationId, createdAt]`, `[status, updatedAt]` (cleanup cron).

**`CandidateDocument`** — the candidate's permanent attachment.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `candidateId` | uuid FK | `onDelete: Cascade` |
| `kind` | `CandidateDocumentKind` | |
| `storagePath`, `fileName`, `mimeType`, `size` | | same object as the import's file |
| `uploadedById` | uuid FK? | |
| `createdAt` | | |

**`Candidate`** — no new columns. Dashboard-created rows use:

- `externalId = "dashboard:<uuid>"` (satisfies `@@unique([poolId, externalId])`)
- `channel = "dashboard_form" | "dashboard_cv"`
- `rawPayload = { mode, draft?, submitted }` — the original LLM draft (if
  any) plus the confirmed fields, so operator edits are traceable
- `sharedWithGlobal = false`, forced (no candidate consent); not in the form

There is no candidate delete path in the app today. `CandidateDocument`
cascades on candidate delete at the DB level; whoever later adds candidate
deletion (e.g. a GDPR erasure flow) must also `remove` the storage objects.

### Data flow (operator, CV mode)

1. Server action `createCandidateImport(formData)`: auth + role + pool check;
   validate size (≤ 10 MB) and type by magic bytes (not extension).
2. Upload to Storage; create `CandidateImport` (`UPLOADED`).
3. `runExtraction(importId)`: `EXTRACTING` → `extractText` → truncate to
   ~20,000 chars → `extractCandidateDraft` → `READY` with `draft`, or
   `FAILED` with `errorCode`. Runs inline (`maxDuration = 60`).
4. Redirect to the review page; operator edits the pre-filled form.
5. Server action `confirmCandidateImport(importId, fields)`: in one
   transaction — conditional update `READY → COMPLETED` (guards double
   submit), `ingestCandidate`, create `CandidateDocument`, set
   `candidateId`; then audit log. Embedding runs after the transaction
   commits (as today, failure tolerated).
6. Redirect to `/dashboard/candidates/[id]`.

**Manual mode:** server action `createCandidateManually(fields)` →
`ingestCandidate` directly (no import record) → audit log → redirect.

**Fallback from a failed import:** "Compila manualmente" opens the empty form
on the review page; confirming goes through `confirmCandidateImport`, which
accepts `FAILED` as well as `READY` for this case, so the CV is still attached.

### Rules

- **Pool:** only non-global pools linked to the user's organization; if
  exactly one, it is pre-selected and the selector is hidden.
- **Duplicates:** non-blocking warning on the review/manual form when a
  candidate with the same normalized phone (or email) already exists in the
  pool.
- **Roles:** `ORG_ADMIN`, `ORG_MEMBER`, `ADMIN_KUBRI` may create candidates.
  Enforced server-side in every action.
- **Cleanup:** the existing cron marks imports left in `READY`/`FAILED`
  for 7 days as `DISCARDED` and removes their storage object (unless a
  `CandidateDocument` references it).

## UI

### Entry point

A **"Nuovo candidato"** button in the candidates list header, with a menu:
*Carica CV* / *Compila manualmente*. Shown only to permitted roles. Not a
dialog: the side-by-side review needs space and a URL to return to.

### Routes

- **`/dashboard/candidates/new`** — mode choice.
  - *Carica CV*: drag-and-drop zone (PDF, DOCX, JPG, PNG, max 10 MB) +
    pool selector (only if > 1 pool).
  - *Compila manualmente*: empty `CandidateForm` on the same page.
- **`/dashboard/candidates/imports/[importId]`** — review page, by status:
  - `EXTRACTING`: form skeleton, "Sto leggendo il CV…" with steps
    (reading → extracting data).
  - `READY`: CV preview left (iframe on signed URL for PDF, `<img>` for
    images, extracted text for DOCX), pre-filled form right, header actions
    *Scarta* / *Crea candidato*.
  - `FAILED`: clear message + *Riprova* (retryable codes only) and
    *Compila manualmente*.
  - `COMPLETED`: redirect to the candidate.
  - `DISCARDED` or another org's import: 404.
- On save → `/dashboard/candidates/[id]` with a success toast.

### `CandidateForm` (shared Client Component)

- Props: `initialValues`, `fieldHints?` (uncertain fields), `poolOptions`,
  `onSubmit`. Reused later by the public page (field subset, candidate-facing
  copy) and by a future edit mode.
- Sections mirror the candidate profile: Anagrafica, Lavoro desiderato,
  Esperienze e formazione, Lingue, Requisiti.
- Array fields (experience, skills, education, additional languages) are
  editable row lists with add/remove.
- Closed-set fields (`italianLevel`, booleans) are selects with
  "Non indicato" as default — never an invented value.
- Uncertain fields: amber border + "da verificare" label. No confidence
  percentages.
- Same Zod schema client and server; messages via the i18n dictionary.

### Candidate detail additions

- **"Documenti" card**: the CV with date, uploader, download link (signed
  URL, 60 s; each download audit-logged).
- **Origin badge** ("Inserito manualmente" / "Da CV") derived from `channel`.

### i18n

Every new string (buttons, labels, statuses, error messages, toasts) goes in
both `it.ts` and `en.ts`. Server actions return error codes; components map
them to dictionary strings.

## Error handling

`errorCode` is persisted on the import and mapped to dictionary messages.

| Code | When | Retryable | UI |
|---|---|---|---|
| `FILE_TOO_LARGE` / `UNSUPPORTED_TYPE` | pre-upload validation | — | inline in dropzone; no import created |
| `STORAGE_ERROR` | Supabase upload failed | yes | toast; no import created |
| `FILE_UNREADABLE` | encrypted / corrupt file | no | *Compila manualmente* |
| `NO_TEXT` | OCR also returns empty text | no | *Compila manualmente* |
| `NOT_A_CV` | LLM returns `isCv: false` | — | warning with *Continua comunque* / *Scarta* (draft still shown) |
| `LLM_TIMEOUT` / `LLM_ERROR` | timeout, HTTP error, or invalid JSON twice | yes | *Riprova* / *Compila manualmente* |

- **Soft validation:** a single field failing Zod (e.g. an out-of-enum
  `italianLevel`) is cleared and marked `uncertain`; it does not fail the
  import.
- **Limits:** text sent to the LLM truncated to ~20,000 chars; Mistral
  timeout 30 s; extraction action `maxDuration = 60`.
- **Idempotency:** `confirmCandidateImport` transitions with a conditional
  update; a second submit finds no `READY` row and redirects to the
  existing candidate.
- **Prompt injection:** CV text is untrusted. It is delimited in the prompt,
  the model has no tools, and output only reaches the DB through the Zod
  schema and operator review. Worst case: wrong field values.

## Security, permissions, GDPR

- Every import/document read filters by `organizationId`; cross-org access
  returns 404.
- Bucket `candidate-documents` is private, accessed only server-side with the
  service role; downloads via 60 s signed URLs.
- Audit log actions: `CANDIDATE_CREATED` (metadata: `mode`),
  `CANDIDATE_IMPORT_CREATED`, `CANDIDATE_DOCUMENT_DOWNLOADED`.
- The organization is the controller of CVs it uploads; `sharedWithGlobal`
  is forced to `false`.
- Mistral is EU-hosted and already a processor. **To verify before shipping:**
  that the existing DPA / retention terms cover the OCR endpoint, and which
  file types the OCR endpoint accepts (if legacy `.doc` is unsupported, it is
  rejected with `UNSUPPORTED_TYPE` — the accepted list stays PDF, DOCX, JPG,
  PNG).

## Testing (vitest)

- `extract-text`: fixtures for digital PDF, scanned PDF (falls back to OCR,
  mocked), DOCX, image, encrypted PDF.
- `llm/structured`: valid response; invalid → retry succeeds; invalid twice →
  `LLMError`; timeout.
- `cv-extraction`: normalization (enums, booleans, empty arrays), per-field
  soft validation, `isCv: false`.
- `ingestCandidate`: existing Make and assessment webhook tests stay green
  after the refactor (primary safety net); new tests for the dashboard
  channel.
- `candidate-imports/service`: state transitions, idempotent confirm,
  `FAILED` → manual confirm, cross-org isolation.
- Server actions: role checks, other-org pool rejected, global pool rejected.
- i18n: existing parity test covers new keys.
- Prompt quality (not in CI): `scripts/eval-cv-extraction.ts` runs the
  pipeline on ~10 anonymized CVs against expected values; run manually when
  the prompt changes.

## Rollout (3 PRs)

1. **`refactor: ingestCandidate`** — extract the shared service; both
   webhooks use it. No behavior change, no schema change.
2. **`feat: candidate import pipeline`** — migration (2 tables + 3 enums),
   storage helper, `lib/documents`, `lib/llm/structured` (+ migrate
   `callMistralJson` callers), `cv-extraction`, import service, cleanup in
   cron, tests. No UI. PR checklist: create bucket `candidate-documents`
   (private) in dev and prod Supabase; apply migration to prod before merge.
   New dependencies: `unpdf`, `mammoth`.
3. **`feat: create candidate UI`** — routes, `CandidateForm`, Documenti card,
   origin badge, dictionaries, CLAUDE.md update.

No new environment variables (`MISTRAL_API_KEY` already exists).

## Refinements made during implementation planning

These supersede the corresponding statements above (see the three plans in
`docs/superpowers/plans/2026-10-23-candidate-creation-*.md`):

- **Upload path:** Vercel caps function request bodies at 4.5 MB, below the
  10 MB limit. The browser uploads straight to Supabase Storage with a signed
  upload URL. The server then downloads the object and verifies its real size
  and magic bytes before creating the `UPLOADED` import
  (`createUploadTicket` → `uploadToSignedUrl` → `registerUpload`).
- **Extraction trigger:** extraction runs in its own server action, triggered
  by the review page, so upload and extraction each get their own time budget.
  An import stuck in `EXTRACTING` for more than 2 minutes can be re-claimed.
- **`italianLevel`** stays free text (as stored today); only the three booleans
  are closed-set.
- **`sharedWithGlobal`** follows the pool's `globalSharing` mode with consent
  = `false` (`WEBHOOK` → `false`, `ALWAYS` → `true`), consistent with webhook
  candidates.
- **Audit action names** use the codebase's dotted style:
  `candidate.create`, `candidate_import.create`, `candidate_document.download`.
- **Entry point:** a single "Nuovo candidato" button. The `/new` page
  offers both modes, so a menu is unnecessary. **No toast** (no toast library
  in the project); the redirect to the new candidate is the confirmation.
- **Duplicate warning** only on the CV review page (not on the manual form).
- **Document access** goes through API routes that check access, audit-log
  and 307-redirect to a 60 s signed URL, instead of embedding signed URLs in pages.
- **Cleanup** runs inside the existing nightly `regenerate-embeddings` cron.

## Known limitations (accepted for V1)

- **Storage orphans.** These cases can leave objects in the bucket with no matching row:
  - an upload ticket is issued but never registered;
  - a register fails after the upload;
  - a file removal fails on discard;
  - a re-upload is made through a still-valid signed token.

  A later sweep can list bucket prefixes older than ~24 h that have no `CandidateImport` / `CandidateDocument` row.
- **Stuck `EXTRACTING`.** If the DB write that ends an extraction itself fails, the import stays `EXTRACTING`. It can be re-claimed after 2 minutes; the review page offers a retry. Otherwise the 7-day cleanup removes it.
- **Pool deletion blocked by import rows.** `CandidateImport.pool` uses `onDelete: Restrict`. A pool that has (discarded) import rows can't be deleted until those rows are removed.

## Follow-ups this design enables

- **Public upload link:** add `CandidateImportLink` (token hash, `poolId`,
  `organizationId`, `expiresAt`, `maxUses`); a public route creates imports
  with `origin = PUBLIC_LINK` and renders `CandidateForm` with a field subset.
  Must be added to `PUBLIC_PREFIXES` in `middleware.ts`. Needs explicit
  candidate consent capture (which may set `sharedWithGlobal`).
- **Bulk import:** create N imports with `origin = BULK`, run
  `runExtraction` in the background, add a review-queue page listing
  `READY` imports.
