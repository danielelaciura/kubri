# Candidate landing page (WhatsApp or CV upload) — Design

**Date:** 2026-10-29
**Status:** Approved in brainstorming, pending spec review
**Scope:** `apps/dashboard`
**Depends on:** branch `feat/create-candidate-ui` (candidate creation + CV import
pipeline, spec `2026-10-23-candidate-creation-cv-import-design.md`). This work is
stacked on that branch and rebased onto `main` once it is merged.

## Goal

WhatsApp as the only entry point loses candidates: some are put off by starting
an interview on WhatsApp, others already have a CV and today email it to the
organization, bypassing Kubri entirely.

Give each client organization a **public page, no login**, that offers two paths:

1. **Interview on WhatsApp** — the existing `wa.me` link for the page's pool.
2. **Upload your CV** — the CV is parsed and the candidate is created directly in
   the page's pool, after the candidate confirms their contact details.

Out of scope (YAGNI): more than one landing per organization, more than one pool
per landing, languages beyond IT/EN, antivirus scanning, phone verification
(SMS/OTP), manual moderation queue, custom domain, cross-pool identity / merging.

## Decisions taken in brainstorming

| Topic | Decision |
|---|---|
| Candidate review after upload | **Minimal confirmation**: first name, last name, phone, email (pre-filled from the CV, editable) + privacy consent. Every other field comes from the CV as extracted. |
| Who manages the landing | **`ADMIN_KUBRI` only**, from `/admin`. The organization sees the landing's link and QR on its existing "QR code" page. |
| Phone already in the landing's pool | **Attach the CV** to the existing candidate as a `CandidateDocument`; the profile is not touched. The candidate sees the same thank-you screen either way (no disclosure of who is in the DB). |
| Phone present only in another pool (incl. global) | **New candidate** in the landing's pool. No lookup, copy or merge across pools (pools may belong to different GDPR controllers). |
| Which app hosts the page | **Dashboard app**, route `/candidati/[slug]`. |

## Reuse from `feat/create-candidate-ui`

| Piece | Reused as is | Change |
|---|---|---|
| `lib/documents/detect.ts` (`detectDocumentKind`, magic bytes) | ✅ | — |
| `lib/documents/extract-text.ts` (unpdf / mammoth / Mistral OCR fallback) | ✅ | public OCR page cap (see Security) |
| `lib/llm/structured.ts`, `lib/candidates/cv-extraction.ts` (`isCv`) | ✅ | — |
| `lib/candidate-imports/service.ts` `createUploadTicket` / `registerUpload` / `runExtraction` | ✅ | public size cap; public file checks in `registerUpload` |
| `CandidateImportOrigin.PUBLIC_LINK`, nullable `createdById` | ✅ | — |
| `confirmImport` | ⚠️ | generalized: `channel`, nullable `userId`, attach-to-existing mode |
| `lib/candidates/ingest.ts` (`ingestCandidate`) | ✅ | — |
| `lib/storage/candidate-documents.ts` (private bucket) | ✅ | — |
| `lib/whatsapp/build-link.ts` | ✅ | — |
| `discardStaleImports` (nightly cron) | ✅ | 24 h threshold for `PUBLIC_LINK` |

## Data model

New model:

```prisma
model CandidateLandingPage {
  id               String   @id @default(uuid()) @db.Uuid
  slug             String   @unique
  organizationId   String   @unique @db.Uuid
  poolId           String   @db.Uuid
  enabled          Boolean  @default(true)
  privacyPolicyUrl String
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  pool         Pool         @relation(fields: [poolId], references: [id], onDelete: Restrict)

  @@index([poolId])
}
```

- `organizationId @unique`: one landing per organization for now.
- `slug`: lowercase `[a-z0-9-]`, 3–60 chars, validated with Zod.
- Invariant: `poolId` is linked to `organizationId` via `OrganizationPool` and
  `pool.isGlobal = false`. Checked by the admin action on save **and** on every
  public request (the link can be removed later). A violated invariant or
  `enabled = false` → the page returns 404.

No changes to `Candidate`. Landing candidates use:

- `externalId = "landing:<uuid>"` (never collides with Make / assessment / dashboard ids)
- `channel = "landing_cv"`
- `rawPayload = { mode: "landing_cv", importId, landingPageId, draft, submitted, consent }`
- `sharedWithGlobal = resolveSharedWithGlobal(pool, consentToShare)`

No new column on `CandidateImport`: `origin = PUBLIC_LINK` plus the cookie binding
(below) is enough. `landingPageId` goes in `rawPayload` of the candidate; the
import's `organizationId` / `poolId` are taken from the landing.

## Admin side (`ADMIN_KUBRI`)

- On the organization page under `/admin/organizations/[id]`: a "Landing
  candidati" card to create / edit the landing — slug, pool (select limited to
  eligible pools: linked, non-global), `privacyPolicyUrl`, enabled toggle — plus
  the public link with copy and QR.
- Server actions, role-checked server-side; audit actions `landing_page.create`,
  `landing_page.update`.
- The organization's "QR code" page (`/dashboard/qr-codes`) shows the landing link
  and QR above the per-pool WhatsApp QRs, when a landing exists and is enabled.

## Public side: `/candidati/[slug]`

- `src/app/(public)/candidati/[slug]/page.tsx`, outside `DashboardShell`.
- `"/candidati"` added to `PUBLIC_PREFIXES` in `middleware.ts` (server actions POST
  to the same path, so the prefix covers them).

### Flow

1. **Landing.** Organization name, short copy, two CTAs: *Fai il colloquio su
   WhatsApp* (`buildWaLink` with the landing's pool) and *Carica il tuo CV*.
   If `KUBRI_WHATSAPP_NUMBER` / template are unset, the WhatsApp CTA is hidden.
2. **`requestUpload`** (server action): Turnstile check → rate limits → size
   check → `createUploadTicket`. Returns the signed upload token.
3. **Browser uploads** straight to Supabase Storage with the token.
4. **`registerPublicUpload`** (server action): `registerUpload` with
   `origin = PUBLIC_LINK`, `createdById = null`, org/pool from the landing, then
   the public file checks (Security, layer 2). Sets the binding cookie.
5. **`runPublicExtraction`** (server action, cookie-bound): quality gate → budget
   check → `runExtraction`. `isCv = false` is a hard rejection in public mode.
6. **Contact confirmation.** First name, last name, phone, email pre-filled from
   the draft, editable; required privacy consent checkbox; optional
   "share with other Kubri organizations" checkbox, shown only when the pool's
   `globalSharing` mode is `WEBHOOK` (consent-driven).
7. **`confirmPublicImport`** (server action, cookie-bound): validates the four
   fields (phone required), then `confirmImport` in public mode (below).
8. **Thank-you screen**, identical whether a candidate was created or a CV attached.

### Import ↔ browser binding

The candidate has no session. On `registerPublicUpload` the server sets an
`httpOnly`, `Secure`, `SameSite=Lax` cookie scoped to `/candidati`, valued
`<importId>.<HMAC-SHA256(importId + expiry, LANDING_COOKIE_SECRET)>`, valid
30 minutes. Every subsequent action reads the import id **only** from a valid
cookie, and additionally checks `origin = PUBLIC_LINK` and that the import's
`poolId` matches the landing. A guessed or foreign import id is never accepted.

### `confirmImport` generalization

```ts
interface ConfirmImportInput {
  importId: string;
  organizationId: string;
  userId: string | null;            // null for PUBLIC_LINK
  channel: "dashboard_cv" | "landing_cv";
  fields: CandidateFields;
  rawPayloadExtra?: Record<string, unknown>; // consent, landingPageId
  attachToExistingByPhone?: boolean; // public mode: true
}
```

In the same transaction, after claiming the import:

- If `attachToExistingByPhone` and a candidate exists **in the import's pool**
  whose phone, normalized to digits with the Italian prefix applied
  (`normalizePhone`: strip non-digits, drop leading `00`, prepend `39` to 10-digit
  numbers starting with `3`), equals the submitted normalized phone → create the
  `CandidateDocument` on that candidate, set `import.candidateId`, skip
  `ingestCandidate` and the embedding refresh. Audit `candidate_document.attach`.
- Otherwise → `ingestCandidate` as today with `channel`, then the document.

The match is **exact** on the normalized phone. The existing 8-digit suffix match
(`findPossibleDuplicates`) stays advisory-only and is not used here. The operator
flow passes `attachToExistingByPhone: false` and is unchanged.

## Security and abuse prevention

Principle: every layer is cheaper than the next; a request reaches the paid steps
(OCR, LLM) only after every free check has passed.

### Layer 1 — before upload (`requestUpload`)

- **Cloudflare Turnstile** (invisible, free). Token verified server-side against
  `siteverify` with `TURNSTILE_SECRET_KEY`; one token per upload.
- **Rate limits** on Upstash Redis (`@upstash/redis`, already a dependency),
  fixed-window counters via `INCR` + `EXPIRE`:

  | Key | Limit |
  |---|---|
  | per IP (hashed) | 3 / hour, 10 / day |
  | per landing | 100 / day |
  | global extractions | 300 / day (budget cap, checked in `runPublicExtraction`) |

- **Fail closed**: if Upstash is not configured or unreachable, public uploads are
  refused (the in-memory cache fallback does not limit anything on Vercel). The
  WhatsApp CTA keeps working.
- IP from `x-forwarded-for` (first hop, as set by Vercel); stored and keyed only as
  `SHA-256(ip + LANDING_IP_SALT)`.

### Layer 2 — the file (`registerPublicUpload`, before any paid call)

- Max **5 MB** for public uploads (operators keep 10 MB); the declared size is
  checked in `requestUpload`, the real object size in `registerUpload`.
- Type by magic bytes (`detectDocumentKind`): PDF, DOCX, JPEG, PNG.
- **PDF**: ≤ 5 pages; reject encrypted; reject if the raw bytes contain
  `/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`, `/RichMedia` or `/XFA`.
- **DOCX**: reject if the zip contains `vbaProject.bin`, `word/embeddings/` or
  `activeX`.
- **Images**: re-encoded to JPEG with `sharp` (strips EXIF incl. GPS, defeats
  polyglots); the re-encoded bytes replace the stored object.
- Any failure → the storage object is removed immediately, the import is marked
  `FAILED` with `errorCode = REJECTED_FILE`, the candidate sees a generic message.

These checks mainly protect the **operator** who later downloads the file; the
server never executes or renders the document, it only extracts text.

### Layer 3 — content quality

- **Free gate before the LLM**: extracted text ≥ 300 non-whitespace chars **and**
  at least one CV signal (phone pattern, email, a year `19xx`/`20xx`, or a keyword
  from a short IT/EN/FR/ES list such as esperienza, lavoro, formazione,
  competenze, experience, education, skills). Otherwise `NOT_A_CV`, no LLM call.
- **OCR** capped at **3 pages** for public imports (operators keep
  `MAX_OCR_PAGES = 10`); `extractDocumentText` takes the cap as a parameter.
- **LLM** `isCv = false` → hard rejection (`NOT_A_CV`), no "continue anyway".
- Prompt injection: unchanged from the CV import spec (delimited text, no tools,
  output through Zod). Worst case remains wrong field values in one candidate.

### Layer 4 — after confirmation

- Required consent; `rawPayload.consent = { privacyPolicyUrl, acceptedAt,
  shareWithGlobal, textVersion }`.
- Audit `candidate_import.public_confirm` with `ipHash`, never the raw IP.
- `discardStaleImports`: `PUBLIC_LINK` imports not `COMPLETED` after **24 h** are
  discarded and their file removed (no CVs kept for people who never consented).

### Cost estimate (to verify against the current Mistral price list)

~0.1–0.3 cents per digital PDF (`mistral-small-latest`, ≤ 20,000 chars), ~0.5–1
cent with OCR (≤ 3 pages). With the 300/day global cap the worst case is
~€3/day under attack.

## Internationalization

- The page renders outside `I18nProvider`: `getDictionary(locale)` where `locale`
  comes from a `?lang=` param, else `Accept-Language`, else `DEFAULT_LOCALE`
  (`it`). An IT/EN switch in the header sets `?lang=`.
- New keys under `landing.*` (public page) and `admin.landingPage.*` in both
  `it.ts` and `en.ts`. Server actions return error codes, the page maps them.
- Known limitation: the target population often speaks other languages; adding
  more locales (incl. RTL for Arabic) is a follow-up. WhatsApp remains the
  multilingual path.

## Privacy (GDPR)

- Controller: the landing's organization; Kubri is the processor. The page names
  the organization and links `privacyPolicyUrl` (required to enable a landing).
- **Input needed before launch:** the privacy notice to link — one URL per
  organization, or a single Kubri-hosted notice naming the organization.
- The optional sharing checkbox only appears when the pool's `globalSharing` is
  `WEBHOOK`; `ALWAYS` / `NEVER` follow `resolveSharedWithGlobal` as for webhook
  candidates.

## Error handling (candidate-facing)

| Code(s) | Message (IT, summarized) | Action |
|---|---|---|
| `CAPTCHA_FAILED`, `RATE_LIMITED`, `BUDGET_EXHAUSTED`, `UNAVAILABLE` | "Troppi tentativi, riprova più tardi" | WhatsApp CTA highlighted |
| `FILE_TOO_LARGE`, `UNSUPPORTED_TYPE`, `REJECTED_FILE` | "Possiamo leggere solo PDF, Word o foto fino a 5 MB" | upload again |
| `FILE_UNREADABLE`, `NO_TEXT`, `NOT_A_CV` | "Non riusciamo a leggere un CV in questo file" | upload again / WhatsApp |
| `LLM_TIMEOUT`, `LLM_ERROR`, `STORAGE_ERROR` | "Qualcosa è andato storto" | one retry / WhatsApp |
| `SESSION_EXPIRED` (cookie missing / invalid / expired) | "La sessione è scaduta" | start over |

Messages are deliberately generic: they never reveal which check fired.
WhatsApp is always offered as the fallback.

## Environment variables

| Variable | Purpose |
|---|---|
| `TURNSTILE_SITE_KEY` | public, passed to the page from the server |
| `TURNSTILE_SECRET_KEY` | server-side verification |
| `LANDING_COOKIE_SECRET` | HMAC for the import binding cookie |
| `LANDING_IP_SALT` | salt for IP hashes |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | already in use; **required** in prod for this feature |

All added to `.env.example`.

## Testing (vitest)

- Public file checks: PDF with `/JavaScript`, encrypted, > 5 pages; DOCX with
  macros / embeddings; image re-encoding strips EXIF; quality gate pass/fail.
- Rate limiter: per-IP, per-landing, global cap; fail closed when Redis is down.
- Cookie: valid signature, tampered, expired, import of another landing rejected.
- `confirmImport`: public attach-to-existing (exact normalized phone, same pool),
  new candidate, no cross-pool match, idempotent second confirm; existing operator
  tests stay green.
- `normalizePhone`: `+39`, `0039`, spaces/dashes, 10-digit mobile without prefix.
- Admin actions: global pool rejected, unlinked pool rejected, duplicate slug,
  non-`ADMIN_KUBRI` rejected.
- Public route: 404 when disabled, when the pool is unlinked, unknown slug;
  `/candidati` is in `PUBLIC_PREFIXES`.
- Stale cleanup: `PUBLIC_LINK` at 24 h, `OPERATOR` still at 7 days.
- i18n parity test covers the new keys.

## Rollout

1. **Base:** push `feat/create-candidate-ui` and open its PR; its checklist
   (prod migration, `candidate-documents` bucket in dev and prod) applies first.
2. **PR A — `feat: candidate landing backend`** (stacked on the base): migration
   `CandidateLandingPage`, `confirmImport` generalization, `normalizePhone`,
   public file checks, quality gate, rate limiter, Turnstile verify, cookie,
   24 h cleanup, tests. New dependency: `sharp`.
3. **PR B — `feat: candidate landing UI`:** public page, admin card, link/QR on
   the "QR code" page, dictionaries, `.env.example`, CLAUDE.md (new sanctioned
   write path `landing_cv`, `/candidati` public prefix).
4. **Prod checklist:** Turnstile keys and the two secrets on Vercel, Upstash
   configured in prod, migration applied before merge, privacy notice URL set on
   each landing before enabling it.

## Known limitations / follow-ups

- **Candidate identity across pools and channels.** A person can exist as several
  `Candidate` rows (other pools, global, or a later WhatsApp interview in the same
  pool, since Make uses its own `externalId`). An organization that also sees the
  global pool may see the same person twice. Solving this needs a person entity
  with many-to-many pool membership (or row linking) — its own project.
- More languages (incl. RTL) on the public page.
- Antivirus scanning of uploaded files (e.g. ClamAV) if operators' risk appetite
  requires it.
- Custom domain (e.g. `candidati.kubri.it`) pointing at `/candidati`.
- Multiple landings / pools per organization.
