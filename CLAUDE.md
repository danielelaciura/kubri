# CLAUDE.md — Kubri Dashboard

## Project

Kubri Dashboard is the web app that Kubri's client organizations (social cooperatives, employment agencies, public employment centers) use to view, filter, and manage candidate profiles collected by the Kubri AI chatbot on Telegram/WhatsApp.

Kubri S.r.l. is an Italian Benefit Corporation (Società Benefit). The product targets the Italian market with future EU expansion.

## Critical Architectural Decision: Webhook-driven Data Sync

The chatbot runs on Make.com but **all dashboard data, including candidate profiles, lives in PostgreSQL**. Make is upstream of Postgres, not a parallel source of truth.

| Data | Where it lives | How it gets there |
|------|----------------|-------------------|
| Users, organizations, pools, roles, invites | PostgreSQL | Dashboard app writes directly |
| Notes, tags, audit logs, job descriptions | PostgreSQL | Dashboard app writes directly |
| **Candidate profiles** | PostgreSQL (`Candidate` table) | **Webhook from Make** → `/api/webhooks/make/candidate` upserts the row |

The Make scenario produces a candidate and POSTs to the webhook. The webhook persists the candidate (including the raw payload in `Candidate.rawPayload` for traceability). From that moment on, **the dashboard reads and queries candidates from Postgres only**.

The historical "Make.com Data Store as source of truth" design has been superseded. If you see references to a Make-backed integration layer (`src/lib/make/`), that is the legacy path — new features target Postgres directly.

### What this means in practice

- To list candidates → query `Candidate` via Prisma, scoped by `poolId`
- To show candidate detail → query `Candidate` + join `CandidateNote` / `CandidateTag`
- To filter candidates → Prisma `where` clause; semantic search runs in Postgres via `pgvector`
- New candidate from chatbot → arrives via webhook, validate and upsert (write the embedding in the same handler)
- Manual updates → the webhook is the canonical write path; never call Make's API to mutate a candidate

## Stack

- **Framework:** Next.js 14+ with App Router
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS
- **UI Components:** shadcn/ui
- **Database:** Supabase Postgres (with `pgvector` extension for semantic search)
- **ORM:** Prisma
- **Candidate ingestion:** webhook from Make → upsert in `Candidate` table
- **Embeddings:** Supabase Edge Functions with `gte-small` (384-dim, multilingual, EU-hosted, free tier)
- **Auth:** Supabase Auth
- **PDF generation:** @react-pdf/renderer
- **Hosting:** Vercel
- **Package manager:** pnpm

## Project Structure

```
kubri-dashboard/
├── prisma/
│   └── schema.prisma              ← PostgreSQL schema (NO candidate tables)
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   └── login/
│   │   ├── (dashboard)/
│   │   │   └── dashboard/
│   │   │       ├── candidates/
│   │   │       │   ├── [id]/
│   │   │       │   │   └── page.tsx
│   │   │       │   └── page.tsx
│   │   │       ├── settings/
│   │   │       │   ├── members/
│   │   │       │   └── page.tsx
│   │   │       ├── stats/
│   │   │       │   └── page.tsx
│   │   │       └── layout.tsx
│   │   ├── (admin)/
│   │   │   └── admin/
│   │   │       ├── organizations/
│   │   │       └── page.tsx
│   │   ├── api/
│   │   │   └── [...nextauth]/
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── ui/                    ← shadcn/ui components
│   │   ├── candidates/            ← candidate-specific components
│   │   ├── layout/                ← sidebar, header, nav
│   │   └── shared/                ← reusable components
│   ├── lib/
│   │   ├── db.ts                  ← Prisma client singleton
│   │   ├── auth.ts                ← auth configuration
│   │   ├── make/
│   │   │   ├── client.ts          ← Make.com API client
│   │   │   ├── cache.ts           ← caching layer for Make.com API
│   │   │   ├── types.ts           ← Make.com Data Store record types
│   │   │   └── normalize.ts       ← raw Make data → app Candidate type
│   │   ├── utils.ts
│   │   └── validations/           ← Zod schemas
│   ├── types/
│   │   └── index.ts
│   └── styles/
│       └── globals.css
├── public/
├── .env.local
├── .env.example
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── CLAUDE.md
```

## Make → Postgres Webhook (`src/app/api/webhooks/make/candidate/`)

This is the ingestion path. The Make scenario POSTs a candidate payload here whenever a new profile is completed. The handler:

1. Validates the payload with Zod
2. Resolves the `Pool` based on the source organization / channel
3. Upserts the `Candidate` row (`@@unique([poolId, externalId])`)
4. Stores the raw payload verbatim in `Candidate.rawPayload`
5. Generates the embedding via the Supabase Edge Function and writes `embedding` / `embeddingText` / `embeddingUpdatedAt`
6. Returns 200

The webhook is the **only** sanctioned write path for candidate data. The dashboard's UI is read-only on candidate profile fields (notes and tags are separate models).

### Legacy `src/lib/make/` module

This directory contains the original Make.com API client (used when candidate data still lived in Make's Data Store). It is being phased out. **Do not add new features that depend on it.** Treat any code that still uses it as a migration target.

## Database Schema (PostgreSQL)

PostgreSQL is the canonical store for all dashboard data, including candidate profiles. The authoritative schema lives in `prisma/schema.prisma` — the list below is a high-level map, not a substitute.

Models (see `prisma/schema.prisma` for full field lists):

- **Organization** — tenants
- **Pool** — a candidate collection (one or more per organization, joined via `OrganizationPool`)
- **User** — dashboard accounts, scoped to an organization, with a role
- **JobDescription** — JD per organization, with `description`, `skills[]`, location fields and (after the semantic matching feature) an `embedding` vector
- **Candidate** — full candidate profile, scoped by `poolId`, identified externally by `externalId`. Holds the raw Make payload (`rawPayload`) and the embedding columns
- **CandidateNote**, **CandidateTag** — dashboard-side metadata linked to `Candidate` via FK
- **AuditLog** — append-only log of user actions

Conventions:

- All IDs are UUIDs
- Every query that touches notes, tags, candidates, JDs **must** scope by `organizationId` (or the `poolId` chain that resolves to it)
- Candidate `externalId` is unique only within a pool (`@@unique([poolId, externalId])`)

## Code Conventions

### TypeScript
- Strict mode enabled
- Never use `any` — use `unknown` with type guards if needed
- Prefer `interface` for objects, `type` for unions/intersections
- Export types from `src/types/`

### React Components
- Use Server Components by default. Add `"use client"` only when interactivity is needed
- Use `Suspense` + `loading.tsx` for loading states
- Interactive components (filters, forms, tables with sorting) are Client Components
- Do not use `useEffect` for data fetching — use Server Components or React Query

### API Routes
- Always validate input with Zod
- Return typed responses with appropriate status codes
- All API routes require a valid auth session

### Database (PostgreSQL)
- Never use raw SQL — always use Prisma
- Every query on notes/tags MUST include `where: { organizationId }` — no exceptions
- Use Prisma transactions for multi-step operations

### Candidate ingestion
- The Make webhook is the canonical write path for `Candidate` rows. Do not write to `Candidate` from anywhere else (except backfill scripts under `scripts/`)
- The webhook handler is responsible for upserting **and** for regenerating the embedding (sync). If embedding fails, log and leave `embedding = null`; a nightly cron will retry
- Never expose write endpoints for candidate profile fields to the dashboard UI

### Semantic search (embeddings)
- Embeddings are generated via a Supabase Edge Function running `gte-small` (multilingual, 384-dim, free, EU-hosted). Never send candidate text to an external embedding provider
- Embedding columns (`embedding`, `embeddingText`, `embeddingUpdatedAt`) live directly on `Candidate` and `JobDescription`
- The text used to generate the embedding is built by helpers in `src/lib/embeddings/text.ts`. Changing the composition logic requires a backfill
- Similarity queries use `prisma.$queryRaw` with the pgvector `<=>` operator. Always scope by `poolId`/`organizationId`

### Styling and UI
- Use shadcn/ui for all base components (Button, Input, Table, Dialog, etc.)
- Tailwind for layout and spacing. No custom CSS unless strictly necessary
- Color palette: defined in `tailwind.config.ts`, based on Kubri brand
- The UI is bilingual (Italian default / English). All UI strings go through the dictionary system — see the Internationalization (i18n) section
- Mobile-first, but priority is desktop/tablet (operators use laptops or tablets)

### Internationalization (i18n)

The dashboard is bilingual (Italian default + English). **Every user-visible string
— text, label, placeholder, button, toast, thrown error message, PDF/email copy —
MUST go through the dictionary system.** Never hardcode user-facing text in JSX or
server actions.

- Dictionaries live in `src/lib/i18n/dictionaries/it.ts` and `en.ts`. They must stay
  key-for-key identical: `en` is typed `satisfies Dictionary`, so a missing
  translation fails the build, and a vitest deep-parity test backs it up. Add every
  new key to BOTH files.
- **Server Components:** `const t = getDictionary(await getServerLocale());` then
  `t.group.key`.
- **Client Components:** `const t = useT();` (must render under `<I18nProvider>`, which
  the dashboard/admin shell provides). Never call `useT()` at module scope.
- **Outside the provider** (`error.tsx`, `not-found.tsx`, unauthenticated pages such as
  the invite/terms flows, and anything rendered as a sibling of `DashboardShell`): the
  hook is unavailable, so use `getDictionary(DEFAULT_LOCALE)` and add a short comment
  noting why.
- **Outputs rendered outside React** (PDF export, email digest): pass a `dictionary:
  Dictionary` prop resolved at the call site — request locale for the PDF
  (`getServerLocale()`), per-recipient locale for the email
  (`getDictionary(isLocale(user.language) ? user.language : DEFAULT_LOCALE)`).
- The active locale is the per-user `User.language` field (default `it`), changed from
  the profile page via the `setLanguage` server action (which `revalidatePath("/")` so
  Server Components re-read it). `getServerLocale()` is `cache()`-wrapped (one DB read
  per request).
- Locale-dependent date/number formatting must honour the resolved locale (e.g.
  `toLocaleDateString(locale === "it" ? "it-IT" : "en-GB", …)`).

### Naming
- Files and folders: `kebab-case`
- React components: `PascalCase`
- Functions and variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Prisma models: `PascalCase` singular
- DB tables: Prisma generates the names, do not rename manually

### Git
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`
- Branches: `feat/feature-name`, `fix/bug-name`
- PRs always target `main`

## Useful Commands

```bash
pnpm dev                    # start dev server
pnpm build                  # production build
pnpm lint                   # ESLint
pnpm prisma generate        # generate Prisma client
pnpm prisma migrate dev     # apply migration in dev
pnpm prisma db push         # push schema without migration (prototyping)
pnpm prisma studio          # GUI to explore the DB
```

## Database Migration Workflow (dev → prod)

Prod and dev are two separate Supabase projects. **Vercel does NOT apply
migrations on deploy** — they must be applied manually to prod before merging
the PR that ships the new code.

### Standard flow for any schema change

1. Modify `prisma/schema.prisma`
2. Generate + apply to dev:
   ```bash
   pnpm prisma migrate dev --name <descriptive_name>
   ```
3. Implement code, test, commit (migration files + code together)
4. Open PR, code review
5. **Before merging:** apply to prod
   ```bash
   set -a && source .env.prod && set +a && pnpm prisma migrate deploy
   ```
   (`.env.prod` is gitignored — contains `DATABASE_URL` 6543 + `DIRECT_URL` 5432)
6. Verify status:
   ```bash
   set -a && source .env.prod && set +a && pnpm prisma migrate status
   ```
7. Merge PR → Vercel auto-deploys the new code (DB already aligned)

### Why prod migration runs BEFORE merge

The new code expects the new schema. If we merge first, Vercel deploys code
that crashes against the old DB. Apply DB first, then ship code.

### Destructive migrations (drop column, rename, type change)

Use **expand & contract** to avoid downtime:
1. Release N: add new column, code writes to both old + new
2. Release N+1: backfill old rows → new column
3. Release N+2: code reads only from new column
4. Release N+3: drop old column

For our current scale (small data, low traffic), a direct drop is acceptable
if you accept ~10s of errors during the deploy window.

### Backups before risky migrations

```bash
pg_dump "$DIRECT_URL" > /tmp/kubri-prod-pre-<name>-$(date +%Y%m%d-%H%M%S).sql
```

### Cheat sheet

| Command | When |
|---------|------|
| `prisma migrate dev --name X` | Dev: new schema change |
| `prisma migrate deploy` | Prod (and CI): apply pending migrations |
| `prisma migrate status` | Check which migrations are pending |
| `prisma migrate resolve --applied X` | Mark a migration as applied without running it (recovery) |
| `prisma generate` | Regenerate TS client after schema change |

### Things NOT to do on prod

- ❌ `prisma db push` — bypasses migration history
- ❌ `prisma migrate reset` — wipes everything
- ❌ Editing already-committed migration files that have been applied
- ❌ Modifying schema directly via Supabase Studio — drifts from Prisma
- ❌ `prisma migrate dev` — dev-only command

### Auto-deploy alternative (NOT used)

Adding `prisma migrate deploy` to the build script (`"build": "prisma generate && prisma migrate deploy && next build"`) is rejected because:
- Failed migration = broken build = stuck prod
- New schema applied before old code spins down → 30-60s of errors
- Hard to roll back

Stick with the manual pre-merge flow.

### Connection strings reminder

- `DATABASE_URL` → port **6543** (transaction pooler, runtime queries)
- `DIRECT_URL` → port **5432** (session pooler, DDL-safe, used by Prisma migrate)
- Prisma reads `DIRECT_URL` first via `prisma.config.ts` (dotenv) — keep `.env.local` aligned with the dev DB so casual `prisma` commands don't hit prod by mistake

### Generated Prisma client

`src/generated/prisma/` is gitignored. `package.json` runs `prisma generate`
in both `postinstall` and `build` so Vercel produces it on every deploy.

## Environment Variables

See `.env.example` for the current authoritative list. The categories in use today:

- **Postgres**: `DATABASE_URL` (port 6543, pooler) and `DIRECT_URL` (port 5432, for Prisma migrate)
- **Supabase**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **Supabase Edge Functions** (semantic matching): `SUPABASE_EDGE_FUNCTION_URL`, `EMBEDDING_TIMEOUT_MS`
- **Make webhook**: shared secret for the candidate ingestion endpoint
- **Cron**: `CRON_SECRET` for protected scheduled jobs

## Domain Context

### What is Kubri
Kubri AI is a multilingual virtual assistant that conducts screening interviews on Telegram (and future WhatsApp). Candidates respond by typing or sending voice messages, in their preferred language. Responses are automatically extracted and structured into a profile.

### Target
Social cooperatives, employment agencies (APL), public employment centers. They look for entry-level profiles: waiters, warehouse workers, cleaners, logistics operators, kitchen staff. Candidates are often people with language barriers or informal work experience.

### Current data flow
1. The candidate chats with the Telegram bot
2. The Make scenario manages the conversation
3. When the profile is complete, the scenario POSTs the candidate to `/api/webhooks/make/candidate`
4. The dashboard upserts the `Candidate` row in Postgres and generates the embedding
5. The operator views, filters, matches and manages profiles entirely from Postgres data

### Competitors
- **Klaaryo** — direct competitor
- **Pronto Pro** — indirect competitor
- **Jobby** — former competitor, pivoted to a different business

## Things NOT To Do

- Do NOT bypass the Make webhook to write `Candidate` rows from the UI or from server actions — backfill scripts are the only exception
- Do NOT build the chatbot — it is out of scope, it stays on Make
- Do NOT integrate WhatsApp Business API — that is Phase 2
- Do NOT build an interview question editor — that is Phase 2
- Do NOT use MongoDB or any NoSQL database — the project uses PostgreSQL
- Do NOT add new features on top of `src/lib/make/` (legacy Make Data Store client) — that path is deprecated
- Do NOT send candidate text to external embedding providers — embeddings are generated inside Supabase
- Do NOT add unnecessary dependencies — keep the bundle lightweight

## Development Priorities

Done or in progress:

1. Auth + multi-tenancy (Supabase Auth, role-scoped access)
2. Prisma schema with Organization / Pool / User / Candidate / JD / Notes / Tags
3. Make webhook for candidate ingestion
4. Candidates table with filters
5. Candidate detail
6. CSV / PDF export
7. Organization management (invites, roles, pools)
8. JD creation and basic matching (location filter live, semantic matching in design)
9. Terms acceptance modal

Next:

- Semantic matching V1 (pgvector + Supabase Edge Function with `gte-small`) — see `docs/superpowers/specs/2026-05-13-jd-semantic-matching-design.md`
- LLM-driven candidate detail narrative (Haiku) — follow-up to semantic matching

## Security — Non-Negotiable Rules

1. Every Postgres query on notes, tags, candidates, JDs filters by `organizationId` (directly or through `poolId`) of the logged-in user
2. The Make webhook is authenticated with a shared secret in `Authorization`; reject any request without it
3. Roles are enforced server-side, never client-side only
4. Candidate data is personal sensitive data (GDPR) — audit log access, no data leaks between orgs
5. Embedding text and vectors never leave the Supabase infrastructure (Edge Function with `gte-small`)
6. The Supabase service role key is server-side only, never shipped to the client
