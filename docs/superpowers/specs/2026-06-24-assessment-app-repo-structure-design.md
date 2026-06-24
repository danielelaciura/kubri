# Kubri Assessment App — Repo Structure & Architecture Design

**Date:** 2026-06-24
**Status:** Approved (structural design). Feature-level spec deferred (pending questionnaire content).
**Scope:** How to host a new public-facing assessment app, under a separate domain, in the
currently mono-app Kubri repo. This document covers the **repo/architecture decision only**.
The feature internals (questionnaire content, PDF layout, LLM prompt, lead data model) are a
separate spec to be written when the questionnaire is provided.

## Context

The new feature accompanies the WhatsApp chatbot. It is a **public, candidate-facing** app
(no login, mobile-first) reachable from a link in the WA chat, hosted on a **different domain**
from the current dashboard (`app.kubri.it`).

User journey:

1. The user completes a structured skills-assessment questionnaire.
2. On completion, two CTAs:
   - **"Download your skills report"** → generates a PDF with a concept map of the user's
     competences (LLM-assisted, almost certainly Claude Haiku — see `CLAUDE.md` "LLM-driven
     candidate narrative (Haiku)").
   - **"Join the Kubri community"** → collects name, surname, phone number. On submit, a single
     webhook call sends the contact info **together with the structured assessment answers**,
     and that payload populates (upserts) a `Candidate` record in Postgres.

If the user does not join the community, nothing is persisted — neither the contacts nor the
assessment answers. The structured assessment data is kept **only** when the user becomes a
candidate (i.e. leaves name + phone); at that point it rides into the `Candidate` record
alongside the contact info, in one webhook call. Anonymous/standalone assessment results are
never stored.

Starting point: the repo is a single Next.js app (`kubri-dashboard`, Next 16) deployed to
Vercel at `app.kubri.it`. `pnpm-workspace.yaml` exists but is used only for
`onlyBuiltDependencies` (Prisma) — it is **not** a real workspace monorepo yet. Everything
shares one Prisma client, one Postgres schema, one i18n system, one shadcn setup.

## Priorities that drove the decision

The two priorities that matter most (chosen by the product owner):

- **A — Security/runtime isolation:** the public app must NOT share runtime, env vars,
  middleware, or attack surface with the operator dashboard. The dashboard holds sensitive
  GDPR candidate data and operator auth.
- **C — Maximum reuse / minimal effort:** reuse as much as possible (Prisma, types, i18n,
  shadcn) and write as little new code/infra as possible.

A and C pull in opposite directions (isolation → split; reuse → unify). The only architecture
that satisfies both is a **workspace monorepo**: separately-deployed apps that share code via
internal packages.

## Options considered

| Option | A (isolation) | C (reuse) | Verdict |
|--------|---------------|-----------|---------|
| 1 — Full pnpm/Turborepo monorepo, 2 apps + shared packages | ✅ separate deploys | ✅ shared packages | Correct end state, but highest upfront restructuring cost |
| 2 — Single Next app, hostname-based routing | ❌ same runtime/env/surface | ✅✅ zero extraction | Rejected — violates A (#1 priority) |
| 3 — Two separate repos | ✅✅ | ❌ Prisma/types/i18n duplicated, manual sync | Rejected — violates C |

## Decision: incremental monorepo, public app talks to DB via API ("B-via-API")

Adopt the monorepo direction (Option 1) but reach it **incrementally**: do not move the
existing dashboard into `apps/` yet. The dashboard stays at the repo root; a second Next app
`apps/assessment` is added and deployed separately to its own domain. Shared code is kept to a
minimum (`packages/contracts`).

Within the incremental path, the public app **does not access the database directly**
("B-via-API"). It has no Prisma client and no DB credentials. When the user joins the community,
it POSTs the contact info + structured assessment answers to a **new authenticated webhook** on
the dashboard, which upserts a `Candidate` row. This new webhook is a **second canonical write
path for `Candidate`**, alongside the existing Make webhook (`/api/webhooks/make/candidate`) —
authenticated with a shared secret, and (per `CLAUDE.md`) responsible for generating the
candidate embedding too. This keeps candidate writes on a controlled webhook path, not arbitrary
UI/server actions, and keeps DB credentials out of the public surface (priority A).

The report PDF is generated from the **current session's answers** + LLM — it needs no DB
read — so the public app can do all heavy lifting (LLM + PDF) in its own backend with **zero**
DB access.

### Repo structure

```
kubri/
├── pnpm-workspace.yaml          # packages: ['apps/*', 'packages/*'] (+ root)
├── package.json                 # root: dashboard (kubri-dashboard), nearly untouched
├── prisma/                      # stays at root (owned by dashboard)
├── src/app/api/webhooks/assessment/  # NEW authenticated webhook: contacts + assessment
│                                     # → upsert Candidate + generate embedding
├── packages/
│   └── contracts/               # @kubri/contracts: Zod schema + types for the webhook payload
│                                # (contact info + structured assessment)
└── apps/
    └── assessment/              # @kubri/assessment: public Next app (separate domain)
        ├── env: LLM key ONLY — NO DB credentials
        └── src/app/
            ├── (questionnaire, mobile-first, no auth)
            └── api/
                ├── report/      # LLM → concept map → PDF (@react-pdf/renderer)
                └── community/   # on join: POST contacts + assessment to dashboard webhook
```

### Runtime boundaries

- **Two Vercel projects**: root → `app.kubri.it`; `apps/assessment` → new domain. Separate
  env, runtime, middleware (satisfies A).
- **Separate secrets**: LLM key lives only in the assessment app; DB credentials live only in
  the dashboard.

### Data flow

```
User (from WhatsApp) → opens assessment.<domain>
   ├─ completes questionnaire        [client/session state only, no DB]
   └─ on completion → 2 CTAs:
        ├─ "Download report" → app/api/report: session answers + LLM → PDF → download
        │                      [no DB read/write, no persistence]
        └─ "Join community"  → collect name/surname/phone → app/api/community →
                                authenticated POST (contacts + structured assessment) →
                                dashboard /api/webhooks/assessment → upsert Candidate
                                (+ embedding) in Postgres
```

What crosses the boundary toward the DB — only when the user joins — is the **contact info plus
the structured assessment answers, together in one webhook call**, validated with
`@kubri/contracts` on both sides (sender for correctness, receiver for security; the receiver
also enforces the shared-secret auth). If the user does not join, nothing crosses and nothing
is stored.

## Out of scope / deferred (YAGNI)

- **Persisting assessment results standalone** — not done. Raw answers gain value only when the
  user becomes a real contact (leaves name + phone). When that happens, the assessment answers
  are stored **as part of the `Candidate` record** via the new webhook (not as a separate
  entity). Anonymous assessments are never persisted.
- **Shared `packages/db` / `packages/i18n` / `packages/ui`/`pdf`** — not needed for this scope.
  `@react-pdf/renderer` is already available; the assessment app can start with local i18n.
- **Feature internals** — questionnaire content, PDF/concept-map layout, LLM prompt and model
  wiring (consult the `claude-api` skill at implementation time), and the exact mapping of the
  webhook payload onto `Candidate` fields (which columns hold the structured assessment, how it
  composes with `rawPayload` and the embedding text, how the `Pool`/`externalId` are resolved
  for assessment-sourced candidates) — all defined in a separate feature spec once the
  questionnaire is provided.

## Vercel / Deployment

One Git repo → **two Vercel Projects**, distinguished only by Root Directory. There is no
single "monorepo project" — each deployable app is its own Project.

| Vercel Project | Root Directory | Domain | Build |
|----------------|----------------|--------|-------|
| `kubri-dashboard` (existing) | `.` (root) | `app.kubri.it` | `prisma generate && next build` |
| `kubri-assessment` (new) | `apps/assessment` | `assessment.kubri.it` (placeholder) | `next build` |

Setting Root Directory to `apps/assessment` on a pnpm workspace makes Vercel auto-detect the
monorepo and include the workspace root in the build, so `packages/contracts` resolves with no
manual config.

**Environment variables — fully separated, the concrete form of priority A:**

- **Dashboard Project** (unchanged + 1 new): `DATABASE_URL`, `DIRECT_URL`, Supabase keys,
  `SUPABASE_EDGE_FUNCTION_URL`, Make webhook secret, `CRON_SECRET`, **+ `ASSESSMENT_WEBHOOK_SECRET`**
  (receiver side).
- **Assessment Project** (minimal, no DB): `ANTHROPIC_API_KEY` (LLM), `DASHBOARD_WEBHOOK_URL`,
  `ASSESSMENT_WEBHOOK_SECRET` (sender side). **No `DATABASE_URL`, no Supabase service-role key** —
  the public deploy physically cannot reach the DB except through the authenticated webhook.

**Per-environment safety:** `DASHBOARD_WEBHOOK_URL` differs per Vercel environment — Production
points at the prod dashboard (writes to Supabase prod); Preview/Dev point at the dev/staging
dashboard (writes to Supabase dev). So assessment preview deploys never create test candidates
in prod.

**Deploy organization:**
- Push to `main` → prod deploy of the affected Project(s); each PR → preview URLs.
- **Ignored Build Step** per Project so a push only rebuilds the app it touched
  (`npx turbo-ignore` with Turborepo, or a `git diff` path check without). Set this up so the
  two Projects don't both rebuild on every push.
- **Crons** (`vercel.json` at root: embeddings + notifications) stay on the dashboard Project
  only — `vercel.json` is relative to Root Directory. The assessment app inherits no crons.
- **DB migrations** — unchanged manual pre-merge flow (see `CLAUDE.md`); only the dashboard
  Project touches the DB. The assessment app is never in the migration loop.

**Operational notes:** the assessment build runs the root `postinstall` (`prisma generate`) —
harmless (offline, no DB needed), just minor extra work until `packages/db` is extracted.

## Follow-up (post-launch) — Phase 2 consolidation, DEFERRED

**Decision:** the monorepo consolidation is kept as a separate change, NOT bundled into the
assessment task. Rationale: the assessment work is **additive** (new files, dashboard untouched,
tiny blast radius); the consolidation is a **structural change to the live production system**
(Vercel Root Directory + Prisma migration resolution on the prod DB). Bundling couples a
low-risk feature to a higher-risk refactor with **zero efficiency gain** — the assessment app's
structure is identical whether the dashboard sits at root or under `apps/`, and `packages/db`
gives the API-only assessment app nothing. Effort ≈ 5/10, but risk ≈ 8/10 and self-inflicted if
entangled. Revisit only if a business reason (e.g. a third app sharing Prisma) demands symmetry
sooner.

**What Phase 2 does:** move the dashboard from the repo root into `apps/dashboard/`, making the
monorepo symmetric. Nothing from the incremental phase is discarded — it becomes the full
monorepo (Option 1). Three core moves:

1. **Move dashboard → `apps/dashboard/`** (`src/`, `public/`, `next.config.ts`, `tsconfig.json`,
   `components.json`, `vitest.config.ts`, …). `@/...` aliases keep working (relative to the app).
2. **Extract Prisma → `packages/db/`** (`@kubri/db`) — the actual reason to consolidate; future
   apps then share one client/schema.
3. **Vercel:** dashboard Project Root Directory `.` → `apps/dashboard`; move `vercel.json`
   (crons) into `apps/dashboard/`; env values unchanged.

Root becomes a pure workspace orchestrator. Turborepo and `packages/i18n` / `packages/ui` are
optional, on-demand.

**Prisma migration history — the one real hazard.** Migration history lives in **two halves that
must agree**: the `migrations/` folders in Git (26 today) + the `_prisma_migrations` table in the
DB, which records applied migrations by **name + SQL checksum** (it does NOT care about file
paths). Moving the folder touches only the Git half; the DB still matches **as long as** names
and SQL stay byte-identical and `migration_lock.toml` travels with them. The danger is "tidying
up" during the move:
- Never edit/reformat an already-applied migration (`prisma format` / `migrate dev` rewrite files
  → checksum mismatch → blocked). The project already avoids `prisma format` for this reason.
- Never squash the 26 into one (names vanish, DB no longer matches).
- **Never `prisma migrate reset`** — it drops the whole schema and re-applies from files: in prod
  that wipes all candidates (GDPR, irrecoverable) AND risks rebuilding without the **HNSW pgvector
  indexes** (whose true prod state isn't cleanly reproducible from files — see the known
  pgvector / `embeddingUpdatedAt` migration-drift notes). Prod is always `migrate deploy`, never
  `reset`, never `migrate dev`.

**Safe 5-step Prisma move:**
1. `git mv prisma packages/db/prisma` (preserves names, SQL, lock; Git keeps history)
2. update the 3 paths in `prisma.config.ts` (`schema`, `migrations.path`, the `.env` it loads)
3. `prisma generate` (regenerate client at the new location)
4. `prisma migrate status` against **dev** → must report **0 pending** ✅ (proof the two halves
   still agree)
5. never touch the 26 migrations' contents; never `reset`
