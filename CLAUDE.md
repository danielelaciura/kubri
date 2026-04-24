# CLAUDE.md — Kubri Dashboard

## Project

Kubri Dashboard is the web app that Kubri's client organizations (social cooperatives, employment agencies, public employment centers) use to view, filter, and manage candidate profiles collected by the Kubri AI chatbot on Telegram/WhatsApp.

Kubri S.r.l. is an Italian Benefit Corporation (Società Benefit). The product targets the Italian market with future EU expansion.

## Critical Architectural Decision: Hybrid Data Architecture

This project uses a **hybrid data architecture**. Understanding this is essential before writing any code.

| Data | Where it lives | Who writes | Who reads |
|------|----------------|-----------|-----------|
| Users, organizations, roles, invites | **PostgreSQL** (our DB) | Dashboard app | Dashboard app |
| Notes, tags, audit logs | **PostgreSQL** (our DB) | Dashboard app | Dashboard app |
| Candidate profiles, interviews, transcripts | **Make.com Data Store** | Chatbot (via Make scenarios) | Dashboard app (via Make.com API) |

**The Make.com Data Store is the single source of truth for candidate data.** The dashboard NEVER writes candidate profile data. It only reads it via the Make.com API. Dashboard-specific metadata (notes, tags) lives in PostgreSQL and references Make records by `make_record_id`.

This is a temporary architecture. Phase 2 will migrate candidate data to PostgreSQL.

### What this means in practice

- To list candidates → call Make.com Data Store API, NOT a PostgreSQL query
- To show candidate detail → call Make.com API for profile + PostgreSQL for notes/tags
- To filter candidates → fetch from Make.com API (limited filters) + application-level filtering
- To add a note to a candidate → write to PostgreSQL with `make_record_id` as foreign reference
- Caching is mandatory — every Make.com API call must go through the cache layer

## Stack

- **Framework:** Next.js 14+ with App Router
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS
- **UI Components:** shadcn/ui
- **Database:** PostgreSQL (Supabase or Neon) — business logic only
- **ORM:** Prisma — for PostgreSQL only
- **Candidate data:** Make.com Data Store API
- **Caching:** Redis (Upstash) or in-memory LRU
- **Auth:** NextAuth.js (Auth.js v5) or Supabase Auth
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

## The Make.com Integration Layer (`src/lib/make/`)

This is the most critical module in the codebase. All candidate data flows through here.

### `client.ts` — Make.com API Client

- Wraps the Make.com Data Store REST API
- Handles authentication (API token per organization, stored encrypted in PostgreSQL)
- Handles pagination, rate limiting, retries
- NEVER called directly from components — always through the cache layer

### `cache.ts` — Caching Layer

- Every Make.com API call goes through cache
- Cache key format: `make:{org_id}:{datastore_id}:{endpoint}:{params_hash}`
- Default TTL: 60s for lists, 30s for single records
- Manual invalidation via refresh button in UI
- If cache backend is down, fall through to direct API call

### `types.ts` — Make.com Data Store Types

- TypeScript types that mirror the exact structure of records in Make.com Data Store
- Field names here must match the Make.com Data Store field names exactly
- This file is the single place where Make.com field names are defined

### `normalize.ts` — Data Normalization

- Transforms raw Make.com records into the app's `Candidate` type
- Handles missing fields, malformed data, type coercion
- This is where the mapping between Make.com field names and app field names happens
- Must be defensive — Make.com data can be inconsistent

## Database Schema (PostgreSQL)

PostgreSQL contains ONLY business logic data. No candidate profiles.

```
Organization
  ├── id (uuid, PK)
  ├── name
  ├── slug (unique)
  ├── make_datastore_id (string)
  ├── make_api_token (encrypted string)
  ├── created_at
  └── settings (jsonb)

User
  ├── id (uuid, PK)
  ├── email (unique)
  ├── name
  ├── role (enum: admin_kubri, org_admin, org_member)
  ├── organization_id (FK → Organization)
  ├── created_at
  └── last_login_at

CandidateNote
  ├── id (uuid, PK)
  ├── make_record_id (string)       ← NOT a FK, references Make.com record
  ├── organization_id (FK → Organization)
  ├── user_id (FK → User)
  ├── content (text)
  └── created_at

CandidateTag
  ├── id (uuid, PK)
  ├── make_record_id (string)       ← NOT a FK, references Make.com record
  ├── organization_id (FK → Organization)
  ├── tag (string)
  └── created_at

AuditLog
  ├── id (uuid, PK)
  ├── user_id (FK → User)
  ├── organization_id (FK → Organization)
  ├── action (string)
  ├── resource_type (string)
  ├── resource_id (string)
  ├── metadata (jsonb)
  └── created_at
```

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

### Make.com API
- Never call the Make.com API directly from components
- Always go through `src/lib/make/client.ts` → `cache.ts`
- Always normalize responses through `normalize.ts`
- Handle API errors gracefully — the UI must never crash because Make.com is down

### Styling and UI
- Use shadcn/ui for all base components (Button, Input, Table, Dialog, etc.)
- Tailwind for layout and spacing. No custom CSS unless strictly necessary
- Color palette: defined in `tailwind.config.ts`, based on Kubri brand
- The UI is in Italian. UI text strings go in separate files to prepare for future i18n
- Mobile-first, but priority is desktop/tablet (operators use laptops or tablets)

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

```env
# Database (PostgreSQL — business logic only)
DATABASE_URL=postgresql://...

# Auth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=...

# Make.com API (global — org-specific tokens are in the Organization table)
MAKE_API_BASE_URL=https://eu2.make.com/api/v2

# Cache (if using Redis)
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...

# Supabase (if used for auth/storage)
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

## Domain Context

### What is Kubri
Kubri AI is a multilingual virtual assistant that conducts screening interviews on Telegram (and future WhatsApp). Candidates respond by typing or sending voice messages, in their preferred language. Responses are automatically extracted and structured into a profile.

### Target
Social cooperatives, employment agencies (APL), public employment centers. They look for entry-level profiles: waiters, warehouse workers, cleaners, logistics operators, kitchen staff. Candidates are often people with language barriers or informal work experience.

### Current data flow
1. The candidate chats with the Telegram bot
2. The Make scenario manages the conversation and saves data to the Make.com Data Store ("test agent DB V4")
3. The `flow_control` field (JSON) tracks interview state
4. A scheduled scenario handles incomplete interviews
5. Completed profiles are exported to Google Drive as Excel/PDF

### Data flow with the dashboard (Phase 1)
1. The chatbot (via Make) writes candidate data to Make.com Data Store (as it does today — no changes)
2. The dashboard reads candidate data from Make.com Data Store via API
3. The dashboard writes notes, tags, and metadata to its own PostgreSQL database
4. The operator views, filters, and manages profiles from the dashboard

### Competitors
- **Klaaryo** — direct competitor
- **Pronto Pro** — indirect competitor
- **Jobby** — former competitor, pivoted to a different business

## Things NOT To Do

- Do NOT store candidate profile data in PostgreSQL — it stays in Make.com Data Store for Phase 1
- Do NOT build the chatbot — it is out of scope, it stays on Make
- Do NOT implement AI candidate-position matching — that is Phase 3
- Do NOT integrate WhatsApp Business API — that is Phase 2
- Do NOT build an interview question editor — that is Phase 2
- Do NOT use MongoDB or any NoSQL database — the project uses PostgreSQL for business logic
- Do NOT call the Make.com API directly from React components — always go through the integration layer
- Do NOT add unnecessary dependencies — keep the bundle lightweight

## Development Priorities

1. **Auth + multi-tenancy** — nothing works without this
2. **PostgreSQL schema + Prisma** — the foundation
3. **Make.com API integration layer** (client, cache, normalize) — the bridge to candidate data
4. **Candidates table with filters** — the core feature
5. **Candidate detail** — to make the product usable
6. **CSV/PDF export** — for operators' workflow
7. **Organization management** — invites, roles
8. **Basic statistics** — nice-to-have for launch

## Security — Non-Negotiable Rules

1. Every PostgreSQL query on notes/tags filters by `organizationId` of the logged-in user
2. Every Make.com API call uses the organization's own `make_datastore_id` and `make_api_token`
3. Roles are enforced server-side, never client-side only
4. Candidate data is personal sensitive data (GDPR) — audit log access, no data leaks between orgs
5. Make.com API tokens stored in PostgreSQL must be encrypted at rest
6. `make_api_token` is never exposed to the client — all Make.com calls happen server-side
