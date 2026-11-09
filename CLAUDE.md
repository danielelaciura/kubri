# CLAUDE.md — Kubri monorepo

## Project

Kubri S.r.l. is an Italian Benefit Corporation (Società Benefit) that helps social cooperatives,
employment agencies and public employment centers screen entry-level candidates. The product
targets the Italian market with future EU expansion.

This file holds only what is **shared across the monorepo**. Each app has its own rulebook, which
Claude Code loads when working inside that app — read it before touching the app:

| App | Rulebook | Specs & plans |
|---|---|---|
| `apps/dashboard` — operator web app (Next.js, Vercel) | `apps/dashboard/CLAUDE.md` | `docs/superpowers/` |
| `apps/chatbot` — WhatsApp interview engine (TypeScript worker, EU container) | `apps/chatbot/CLAUDE.md` | `apps/chatbot/docs/superpowers/` |
| `apps/assessment` — public skills-assessment app (no DB) | `apps/assessment/PRODUCT.md`, `DESIGN.md` | `docs/superpowers/` |

Keep app-specific rules in the app's file, not here.

## Project Structure

The repo is a **pnpm workspace monorepo**. The repo root is orchestration-only
(`package.json` = `kubri`, `pnpm-workspace.yaml`); all apps live under `apps/*` and
shared code under `packages/*`:

```
kubri/                              ← workspace root (orchestrator, no app code)
├── apps/
│   ├── dashboard/                  ← the operator dashboard
│   ├── chatbot/                    ← WhatsApp interview engine (replaces the Make bot)
│   └── assessment/                 ← public skills-assessment app (separate domain, no DB)
├── packages/
│   └── contracts/                  ← @kubri/contracts: shared Zod payload schemas
├── supabase/                       ← Edge Functions (deployed via Supabase CLI)
├── pnpm-workspace.yaml
└── package.json                    ← orchestrator (name "kubri")
```

### Cross-app rules

- Apps never import from each other. Shared code goes in `packages/*`; webhook/payload
  contracts between apps go in `@kubri/contracts`, so a contract break is a typecheck error.
- Dashboard and chatbot share the same Supabase Postgres (dev↔dev, prod↔prod) but own separate
  schemas: the dashboard owns `public`, the chatbot owns `bot` / `bot_queue`. Neither app reads,
  writes or migrates the other's schema; data flows through the candidate webhook.
- Candidate data is personal sensitive data (GDPR): no personal data in logs, secrets only in env.

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

The Make bot is being replaced by `apps/chatbot` (WhatsApp first), which keeps the same webhook
contract; until the switch-over, both may POST candidates.

### Competitors
- **Klaaryo** — direct competitor
- **Pronto Pro** — indirect competitor
- **Jobby** — former competitor, pivoted to a different business

## Git

- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`
- Branches: `feat/feature-name`, `fix/bug-name`
- PRs always target `main`
- Scope commits by app when it helps: `feat(chatbot): …`, `fix(dashboard): …`

## Database Migration Workflow (dev → prod)

Applies to every app with Prisma migrations (dashboard and chatbot). The commands below are the
dashboard's; the chatbot has equivalent scripts documented in `apps/chatbot/CLAUDE.md`.

Prod and dev are two separate Supabase projects. **Vercel does NOT apply
migrations on deploy** — they must be applied manually to prod before merging
the PR that ships the new code.

### Standard flow for any schema change

All Prisma commands run **from `apps/dashboard`** (where `prisma.config.ts` and the
`prisma/` dir live). `cd apps/dashboard` first.

1. Modify `apps/dashboard/prisma/schema.prisma`
2. Generate + apply to dev:
   ```bash
   cd apps/dashboard && pnpm exec prisma migrate dev --name <descriptive_name>
   ```
3. Implement code, test, commit (migration files + code together)
4. Open PR, code review
5. **Before merging:** apply to prod
   ```bash
   cd apps/dashboard && set -a && source .env.prod && set +a && pnpm exec prisma migrate deploy
   ```
   (`.env.prod` is gitignored, lives in `apps/dashboard/` — `DATABASE_URL` 6543 + `DIRECT_URL` 5432)
6. Verify status:
   ```bash
   cd apps/dashboard && set -a && source .env.prod && set +a && pnpm exec prisma migrate status
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
