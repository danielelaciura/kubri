# Dev/Prod Database Split — Design

**Date:** 2026-04-21
**Status:** Approved, ready for implementation plan
**Scope:** Standalone prerequisite task. Enables clean deployment planning by separating the Supabase project used in local development from the one that will serve production.

## Context

The dashboard currently uses a single Supabase Postgres project for both local development and the (future) production environment. Every `prisma migrate dev` run on a laptop applies changes directly to the same DB that will serve real users. This blocks safe deployment planning: the Prisma migration strategy for production is ambiguous while local == prod.

A second Supabase project (`kubri-dev`) has been created. Both projects currently hold only fake/test data, so a one-time data clone has no GDPR implications.

## Goal

After this task:

- Local development (`pnpm dev`, Prisma CLI, tests) points exclusively at `kubri-dev`.
- The existing Supabase project (`kubri-prod`) is untouched from local machines. It will be reached only by future deploys running on Vercel.
- The codebase change is minimal: environment variables and documentation, no runtime logic forked on environment.

## Non-goals

- Cleaning up or reseeding `kubri-prod`. It keeps its current fake data until a separate pre-launch task.
- Any form of continuous sync between prod and dev. The point of the split is divergence.
- A second Prisma client, multi-tenant DB logic, or conditional database selection at runtime. Prisma reads `DATABASE_URL` from the environment; that is the only switch.
- Runtime safety check that warns when local points at the prod DB. Considered and dropped to keep the change minimal.

## Approach

### 1. One-time data clone (`kubri-prod` → `kubri-dev`)

Dump the current project, including schema and data, and restore into the new project.

```sh
pg_dump "$KUBRI_PROD_DIRECT_URL" --no-owner --no-acl > /tmp/kubri-snapshot.sql
psql "$KUBRI_DEV_DIRECT_URL" -f /tmp/kubri-snapshot.sql
```

Notes:

- `DIRECT_URL` is required (not `DATABASE_URL`): pgbouncer in transaction mode does not support the commands `pg_dump` emits.
- `--no-owner --no-acl` avoids role/permission statements that would fail against a different Supabase project's default roles.
- The Prisma `_prisma_migrations` table is part of the dump. After restore, `prisma migrate status` on `kubri-dev` reports "database is up to date", so no migrations re-run.
- The dump file is deleted after verification. It is not committed and not kept long-term.

### 2. Update `.env.local`

Replace `DATABASE_URL` and `DIRECT_URL` with the `kubri-dev` connection strings. The prod values are archived in the user's password manager and never return to `.env.local`.

### 3. Update `.env.example`

Document the split with comments so a future contributor does not paste prod credentials into the local file:

- `DATABASE_URL` / `DIRECT_URL` comment: "Local development DB (kubri-dev on Supabase). Never put production credentials here — prod values live in Vercel environment variables."

No new variables are added.

### 4. Verification

On the developer machine, with `.env.local` pointing at `kubri-dev`:

- `pnpm prisma migrate status` reports no pending migrations.
- `pnpm dev` starts, login works, the candidates list renders.
- Creating a `CandidateNote` or `CandidateTag` through the UI writes a row visible in the `kubri-dev` Supabase dashboard.
- The Supabase dashboard for `kubri-prod` shows no new rows created during the session.

## What changes in the codebase

- `.env.local`: new values (not in git).
- `.env.example`: ~2 lines of comments added.

That is the full scope. No `src/` changes.

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| `pg_dump` includes extensions or roles that `kubri-dev` rejects | `--no-owner --no-acl`; if further issues, fall back to schema-only dump via Prisma then data-only dump with `--data-only` |
| Developer forgets to update `.env.local` and keeps writing to prod | Verification step above explicitly checks which DB received the writes |
| Future contributor pastes prod creds into `.env.local` | `.env.example` comment flags this; longer-term, a runtime safety check can be added as a follow-up |
| Dump file left on disk contains (fake) data | Delete after verification; `/tmp` is ephemeral on most systems |

## Out of scope (follow-ups after this task)

- Cleaning `kubri-prod` before real launch.
- Deployment strategy (Vercel setup, Prisma `migrate deploy` strategy, observability). Resumes after this task lands.
