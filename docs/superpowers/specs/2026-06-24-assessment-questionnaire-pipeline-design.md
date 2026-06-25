# Assessment Questionnaire → Candidate Pipeline — Design

**Date:** 2026-06-24
**Status:** Approved (design). Implementation plan to follow.
**Scope:** The structured questionnaire in the public Assessment app, its validation, and the
path that turns a completed assessment into a `Candidate` row when the user joins the community.
**Out of scope (next round):** the results/report screen — dimension scoring, job matching, the
LLM concept-map PDF, and the "Approfondisci con Claude" CTA.

## Context

The public Assessment app (`apps/assessment`, separate domain) currently has only a placeholder
landing page and a `/api/community` forwarder built during the foundation phase. We now have the
real questionnaire: a 5-section JSON (cognitive style, a repeatable work-experience block, work
style, relational style, interests/motivators) plus an HTML file used purely as a **UI/component
style reference**.

The goal of this design: a **single hard-coded "question registry"** as the source of truth, in
which every question declares (a) its **UI component type** and (b) its **mapping to a DB field**.
That one registry drives rendering, validation, and the answer→`Candidate` mapping — no
duplication, and adding/changing a question is a one-place edit.

## Decisions (locked during brainstorming)

- **Two natures of question:**
  - **Profile-data** questions map to **existing `Candidate` columns** (so an assessment-sourced
    candidate looks and searches like any other candidate). E.g. the repeatable *Esperienze*
    block → `workExperience[]`; `skills_universali` + `skills_specifiche` → `skillsAndCompetences[]`;
    `titolo_studio` + `corsi` → `educationAndTraining[]`; q16 constraints → `jobConstraints` /
    `preferredLocation` / `partTimePreference`.
  - **Psychometric** questions (cognitive style, relational style, motivators, …) map to a **new
    `assessmentProfile Json?` column** — first-class and structured, for the future LLM report,
    displayable and filterable. They have no existing column.
  - The **full raw submission** is also stored in `rawPayload` (traceability, as the Make webhook
    already does).
- **Component types** (from the JSON, **no `rank`**): `single_choice`, `multi_choice`, `scale`,
  `text`, `textarea`, `select`, `repeatable_group`.
- **`Candidate` is written only on "join community."** The questionnaire holds no contact fields;
  name/surname/phone come from the join CTA. Submission shape stays `{ contact, assessment }`
  (the existing `assessmentSubmissionSchema`). No join → nothing persisted (answers live only in
  browser state).
- **Identity:** `externalId` = normalized phone; pool resolved via a configured key
  (`ASSESSMENT_POOL_KEY`, default `"global"`); `channel = "assessment"`,
  `sourceOrganization = "kubri-assessment"`. Re-taking with the same phone upserts the same row.

## Architecture

Four units, each with one clear responsibility.

### 1. Question registry — `packages/contracts/src/assessment/` (source of truth)

Lives in the package both apps already share.

- `types.ts` — `ComponentType` (the 7 types); `QuestionDef` (`id`, `sectionId`, `order`,
  `component`, `text`, `label`, `hint?`, plus render config `options?` / `scale?` / `fields?`);
  `FieldTarget` = `{ kind: "column"; field: CandidateColumn; strategy: "set" | "append" }`
  **or** `{ kind: "profile"; path: string }`. `CandidateColumn` is a string-literal union of the
  writable target columns.
- `registry.ts` — the typed sections/questions transcribed from the JSON; each question carries
  its `component` and `target`. The repeatable experience block is one `repeatable_group` whose
  sub-fields each have their own target.
- `schema.ts` — `assessmentAnswersSchema` **derived from the registry** (per-question answer
  shape). `assessmentSubmissionSchema` in `index.ts` is tightened to use it instead of the
  current open `z.record(...)`.
- `mapping.ts` — `mapAssessmentToCandidate(answers)` → `{ columns, assessmentProfile }`, walking
  the registry `target`s. Modeled directly on `normalizeForUpsert`
  (`apps/dashboard/src/lib/make/normalize.ts`), reusing its coercion style (`safeStringArray`,
  `nullableString`).

### 2. Schema change — `Candidate.assessmentProfile`

Add `assessmentProfile Json?` to `model Candidate` (`apps/dashboard/prisma/schema.prisma`) and a
Prisma migration generated **from `apps/dashboard`**. Additive and nullable. Strip any spurious
HNSW `DROP INDEX` the generator injects; never `migrate reset`.

### 3. Questionnaire rendering — `apps/assessment`

One component per `ComponentType` under `src/components/questionnaire/`, plus a `QuestionRenderer`
that switches on `question.component`, styled per the HTML reference. A client `AssessmentFlow`
drives section navigation, a progress bar, and in-memory answers. The final **"Unisciti alla
community"** step collects `firstName`/`lastName`/`phone` **+ a required GDPR consent checkbox**
(consent → `Candidate.sharedWithGlobal = true`, mirroring the Make webhook's
`is_kubri_privacy_accepted` mapping), then POSTs `{ contact, assessment }` to the existing
`/api/community` route.

### 4. Webhook receiver — `apps/dashboard/src/app/api/webhooks/assessment/route.ts`

A near-clone of the Make webhook (`api/webhooks/make/candidate/route.ts`): Bearer-secret auth →
validate with `assessmentSubmissionSchema` → resolve pool (`resolvePoolByExternalKey`) → build
upsert input via `mapAssessmentToCandidate` (+ contact, identity fields, `rawPayload`) → upsert on
`@@unique([poolId, externalId])` → regenerate embedding with `buildCandidateEmbeddingText` +
`generateEmbedding` (reuse the existing block).

## Data flow (two hops, by design)

```
Browser (assessment.kubri.it)
  └─ fills questionnaire [in-memory only] → join step (contact + consent)
     └─ POST /api/community            [assessment app: validate + add Bearer secret]   no DB
        └─ POST /api/webhooks/assessment  [dashboard: re-validate, map, UPSERT, embed]  ← DB write
```

Two endpoints because the two apps have different trust levels: `/api/community` is the public
**proxy** (no DB credentials, can only forward); `/api/webhooks/assessment` is the privileged
**writer** (holds DB access, the only place a `Candidate` is written — same rule as the Make
webhook). The shared secret never reaches the browser.

## Error handling

- Proxy (`/api/community`): 400 on invalid submission (fast user feedback), 500 on missing config,
  502 on upstream failure. Already implemented.
- Receiver: 401 (bad/missing secret), 400 (schema), 422 (unknown pool), 500 (upsert). Embedding
  failure is logged and leaves `embedding = null` for the nightly cron — never blocks the upsert.

## Testing

- `packages/contracts` (root vitest): registry integrity (every question has a valid `target`),
  schema accepts a full valid submission and rejects malformed, `mapAssessmentToCandidate`
  produces expected columns + profile for a representative submission.
- Dashboard receiver: mirror `__tests__/app/api/webhooks/make/candidate.test.ts` (mock
  prisma/pool/embeddings) — 401/400/422 paths and a successful upsert asserting mapped columns +
  `assessmentProfile`.
- End-to-end: run the assessment app, complete the flow, join → confirm a `Candidate` appears in
  the configured pool with mapped columns + populated `assessmentProfile` + an embedding.

## Env / config
- Dashboard: existing `ASSESSMENT_WEBHOOK_SECRET`; new `ASSESSMENT_POOL_KEY` (default `"global"`).
  The target pool must already exist (admin UI / seed). Document in `.env.example`.
