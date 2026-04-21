# Dev/Prod Database Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate the Supabase project used in local development (`kubri-dev`) from the one reserved for production (`kubri-prod`), by cloning current data once and switching local env vars, without introducing runtime DB-selection logic.

**Architecture:** One-time `pg_dump` → `psql` clone from `kubri-prod` to the already-created empty `kubri-dev` Supabase project. Local `.env.local` is flipped to the new project; prod credentials never return to the file. `.env.example` gains comments to prevent future accidental reuse. No `src/` changes.

**Tech Stack:** Supabase Postgres, PostgreSQL client tools (`pg_dump`, `psql`) installed via Homebrew, Prisma 7 (already present).

**Spec:** [2026-04-21-dev-prod-db-split-design.md](../specs/2026-04-21-dev-prod-db-split-design.md)

---

## Pre-execution notes

- This plan is **operational**, not code-writing. There is no new logic to unit-test. Verification happens via explicit DB-state and UI checks between steps.
- `.env.local` is gitignored ([.gitignore](../../../.gitignore) lines 11 and 32). It will be edited but never committed. Only `.env.example` is committed at the end.
- Run every command from the worktree root: `/Users/daniele/Projects/kubri/.claude/worktrees/dreamy-montalcini-d676fe`.
- "Connection strings" in this plan always means Supabase **Session Pooler** (`DIRECT_URL`), not the transaction-pooled `DATABASE_URL`. `pg_dump`/`psql`/`prisma migrate` require direct connections.

---

## Task 1: Preflight — install Postgres client tools

**Files:** none (system install)

Check which major version Supabase is running, so the locally installed `pg_dump` matches. A `pg_dump` newer than the server refuses to dump.

- [ ] **Step 1: Check Supabase Postgres version**

In the Supabase dashboard for `kubri-prod`: **Project Settings → Infrastructure → Postgres version**. Expect `15.x` or `16.x`. Record the major version (`15` or `16`).

Alternative via CLI, once Step 2 installs `psql`: connect to prod and run `SELECT version();`. Circular with Step 2 — use the dashboard first.

- [ ] **Step 2: Install matching Postgres client via Homebrew**

If Supabase is version 15:

```bash
brew install postgresql@15
brew link --force postgresql@15
```

If Supabase is version 16:

```bash
brew install postgresql@16
brew link --force postgresql@16
```

- [ ] **Step 3: Verify installation and version match**

```bash
pg_dump --version
psql --version
```

Expected output: both print `(PostgreSQL) <major>.x` where `<major>` matches the Supabase version recorded in Step 1.

If the version mismatches, `brew unlink postgresql@<wrong>` then re-link the correct one.

- [ ] **Step 4: No commit** (system install, nothing in repo)

---

## Task 2: Gather connection strings into the shell

**Files:** none (environment variables only, scoped to the current shell)

The next tasks need both project connection strings. Putting them in shell variables keeps them out of shell history (avoids re-typing) and out of any file.

- [ ] **Step 1: Fetch `kubri-prod` Session Pooler URL from Supabase**

Supabase dashboard for `kubri-prod`: **Project Settings → Database → Connection string → Session pooler → URI**. It looks like `postgresql://postgres.<project-ref>:<password>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`.

- [ ] **Step 2: Fetch `kubri-dev` Session Pooler URL from Supabase**

Same procedure, but in the `kubri-dev` project.

- [ ] **Step 3: Export both to the current shell (do not paste the real passwords into this document or any file)**

```bash
read -s KUBRI_PROD_URL   # paste prod Session Pooler URL, press Enter
export KUBRI_PROD_URL
read -s KUBRI_DEV_URL    # paste dev Session Pooler URL, press Enter
export KUBRI_DEV_URL
```

`read -s` hides the input and keeps the variable out of shell history.

- [ ] **Step 4: Sanity check that both URLs respond**

```bash
psql "$KUBRI_PROD_URL" -c "SELECT current_database(), current_user;"
psql "$KUBRI_DEV_URL"  -c "SELECT current_database(), current_user;"
```

Expected for both: a single-row result listing `postgres` as the database and a `postgres`-family user. Connection errors here must be fixed before proceeding (wrong password, IP allow list, or network issue).

- [ ] **Step 5: Confirm `kubri-dev` is empty**

```bash
psql "$KUBRI_DEV_URL" -c "\dt public.*"
```

Expected: `Did not find any relations.` If tables already exist (e.g. a previous attempt), stop — do not overwrite without knowing what is there. Drop the public schema manually (`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`) only after confirming no conflict.

- [ ] **Step 6: No commit**

---

## Task 3: Dump `kubri-prod`

**Files:**
- Create (temporary): `/tmp/kubri-snapshot.sql`

- [ ] **Step 1: Run `pg_dump`**

```bash
pg_dump "$KUBRI_PROD_URL" --no-owner --no-acl --clean --if-exists > /tmp/kubri-snapshot.sql
```

Flag rationale:
- `--no-owner` strips `ALTER ... OWNER TO` — the Supabase superuser differs between projects.
- `--no-acl` strips `GRANT`/`REVOKE` — same reason.
- `--clean --if-exists` emits `DROP ... IF EXISTS` before each `CREATE`. Harmless against the empty `kubri-dev` and makes the restore idempotent if rerun.

- [ ] **Step 2: Verify the dump file is non-empty and well-formed**

```bash
wc -l /tmp/kubri-snapshot.sql
grep -c "^CREATE TABLE" /tmp/kubri-snapshot.sql
grep -c "_prisma_migrations" /tmp/kubri-snapshot.sql
```

Expected:
- Line count: at least several hundred (schema + data).
- `CREATE TABLE` count: at least **6** — five Prisma models (`Organization`, `User`, `CandidateNote`, `CandidateTag`, `AuditLog`) plus `_prisma_migrations`.
- `_prisma_migrations` match count: at least 2 (one `CREATE TABLE`, one or more `INSERT`).

If `_prisma_migrations` is missing, Prisma will try to re-run the init migration on dev and fail — do not proceed.

- [ ] **Step 3: No commit** (dump is in `/tmp`, gitignored by being outside the repo)

---

## Task 4: Restore into `kubri-dev`

**Files:**
- Read: `/tmp/kubri-snapshot.sql`

- [ ] **Step 1: Apply the dump to `kubri-dev`**

```bash
psql "$KUBRI_DEV_URL" --set ON_ERROR_STOP=on -f /tmp/kubri-snapshot.sql > /tmp/kubri-restore.log 2>&1
echo "exit: $?"
```

`ON_ERROR_STOP=on` aborts on the first error instead of continuing with a partially restored DB. Output goes to a log so we can grep it.

Expected: `exit: 0`.

- [ ] **Step 2: Scan the log for warnings/errors**

```bash
grep -iE "error|fatal" /tmp/kubri-restore.log | head -50
```

Expected: no lines, or only benign ones. Benign means:
- `ERROR:  must be owner of extension plpgsql` — harmless: the dump includes a `COMMENT ON EXTENSION plpgsql` that Supabase's restricted role cannot execute. Skippable.
- `NOTICE:  extension "..." already exists, skipping` — informational, not an error despite the `grep -i error` match on nothing (notices do not contain "error").

If there are real errors (`permission denied`, `syntax error`, `role "..." does not exist`, `ON_ERROR_STOP` abort), stop and investigate before Step 3.

- [ ] **Step 3: Verify the dev DB now has all expected tables and row counts match prod**

```bash
for tbl in Organization User CandidateNote CandidateTag AuditLog _prisma_migrations; do
  echo -n "$tbl: prod="
  psql "$KUBRI_PROD_URL" -tAc "SELECT COUNT(*) FROM \"$tbl\";"
  echo -n "$tbl: dev ="
  psql "$KUBRI_DEV_URL"  -tAc "SELECT COUNT(*) FROM \"$tbl\";"
done
```

Expected: the `prod=` and `dev =` values line up row-for-row for each table. Non-matching counts mean the restore was partial — rerun Task 3 + Task 4 after dropping the dev public schema.

- [ ] **Step 4: No commit**

---

## Task 5: Verify Prisma sees `kubri-dev` as up-to-date

**Files:** none (temporary env override)

- [ ] **Step 1: Run `prisma migrate status` against `kubri-dev` without touching `.env.local`**

```bash
DATABASE_URL="$KUBRI_DEV_URL" DIRECT_URL="$KUBRI_DEV_URL" pnpm prisma migrate status
```

Expected output contains:
- `Database schema is up to date!` (or equivalent "no pending migrations")
- Lists migration `20260407091332_init` as applied.

If it reports pending migrations, the `_prisma_migrations` table was not restored correctly — return to Task 3 Step 2.

- [ ] **Step 2: No commit**

---

## Task 6: Switch `.env.local` to `kubri-dev`

**Files:**
- Modify: `.env.local` (gitignored, not committed)

- [ ] **Step 1: Back up current `.env.local` outside the repo**

```bash
cp .env.local ~/kubri-env-backup-$(date +%Y%m%d-%H%M%S).local
```

The user should also archive `KUBRI_PROD_URL` and the matching Supabase password into their password manager before this task. From here on, prod credentials exist only in the password manager and (later) in Vercel.

- [ ] **Step 2: Extract the two values from `$KUBRI_DEV_URL`**

The Session Pooler URL is what goes into `DIRECT_URL`. For `DATABASE_URL`, Supabase uses a Transaction Pooler URL on port 6543 with `?pgbouncer=true&connection_limit=1`. Fetch it from the Supabase dashboard (**Project Settings → Database → Connection string → Transaction pooler → URI**), export it:

```bash
read -s KUBRI_DEV_POOLED_URL
export KUBRI_DEV_POOLED_URL
```

- [ ] **Step 3: Overwrite `.env.local` with `kubri-dev` values**

Open `.env.local` in an editor and replace the two lines so that the file reads (keeping any other existing vars like `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, `MAKE_API_BASE_URL` unchanged):

```
DATABASE_URL=<value of KUBRI_DEV_POOLED_URL>
DIRECT_URL=<value of KUBRI_DEV_URL>
```

Do not include the `?pgbouncer=true&connection_limit=1` parameters in `DIRECT_URL`. They belong on `DATABASE_URL` only.

- [ ] **Step 4: Confirm the file content is correct**

```bash
grep -E '^(DATABASE_URL|DIRECT_URL)=' .env.local
```

Expected: two lines, both containing the `kubri-dev` project ref (first 8 chars), neither containing the `kubri-prod` project ref.

- [ ] **Step 5: No commit** (`.env.local` is gitignored)

---

## Task 7: Update `.env.example` with explicit guidance

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Rewrite the Database section**

Current content of [.env.example](../../../.env.example) lines 1-3:

```
# Database (Supabase PostgreSQL)
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...
```

Replace with:

```
# Database (Supabase PostgreSQL — local development only)
# Use the kubri-dev Supabase project here. Production credentials
# belong only in Vercel environment variables, never in this file or .env.local.
# DATABASE_URL: Transaction pooler (port 6543), with ?pgbouncer=true&connection_limit=1
# DIRECT_URL:   Session pooler (port 5432), used by Prisma migrations
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...
```

No other section changes.

- [ ] **Step 2: Verify no real credentials leaked into the diff**

```bash
git diff .env.example | grep -iE "(supabase|postgres\.)" | grep -v "postgresql://\.\.\."
```

Expected: empty output. Any line that appears is a real-looking URL that must not be committed.

- [ ] **Step 3: No commit yet** (commit is Task 9, after functional verification passes)

---

## Task 8: Functional verification

**Files:** none (runtime check)

This is the critical verification: the dev server uses `kubri-dev`, and writes land there, not in `kubri-prod`.

- [ ] **Step 1: Start the dev server**

```bash
pnpm dev
```

Expected: compiles without errors; log shows "Ready in <N>ms" and `http://localhost:3000`.

- [ ] **Step 2: Log in using a seeded user**

Open `http://localhost:3000/login`. Use credentials from the dumped data (any existing user in the `User` table of what was prod). Login succeeds; dashboard renders.

If no credentials are known, the fastest path is to reset a user's password via a Prisma shell: `pnpm prisma studio --browser none` pointed at `kubri-dev`, edit a `User.passwordHash` to a known bcrypt hash. This is dev-only.

- [ ] **Step 3: Create a note against a candidate**

Navigate to the candidates list → open any candidate detail page → add a short note (e.g. "dev-split smoke test 2026-04-21").

- [ ] **Step 4: Confirm the note exists in `kubri-dev`**

```bash
psql "$KUBRI_DEV_URL" -c "SELECT id, content, \"createdAt\" FROM \"CandidateNote\" ORDER BY \"createdAt\" DESC LIMIT 1;"
```

Expected: the most recent row is the note just created, with matching text.

- [ ] **Step 5: Confirm the same note does NOT exist in `kubri-prod`**

```bash
psql "$KUBRI_PROD_URL" -c "SELECT id, content, \"createdAt\" FROM \"CandidateNote\" WHERE content LIKE 'dev-split smoke test%';"
```

Expected: `(0 rows)`. If this returns a row, `.env.local` is still pointing at prod — return to Task 6 and investigate which value is wrong.

- [ ] **Step 6: Stop the dev server** (Ctrl+C)

- [ ] **Step 7: No commit**

---

## Task 9: Cleanup and commit

**Files:**
- Delete: `/tmp/kubri-snapshot.sql`, `/tmp/kubri-restore.log`
- Commit: `.env.example`

- [ ] **Step 1: Remove the dump and log**

```bash
rm -f /tmp/kubri-snapshot.sql /tmp/kubri-restore.log
```

- [ ] **Step 2: Unset the shell variables holding connection strings**

```bash
unset KUBRI_PROD_URL KUBRI_DEV_URL KUBRI_DEV_POOLED_URL
```

- [ ] **Step 3: Stage and commit the `.env.example` change only**

```bash
git add .env.example
git status
```

Expected `git status` output: only `.env.example` staged, nothing else. If any other file appears staged (especially `.env.local`), unstage it: `git restore --staged <file>`.

- [ ] **Step 4: Create the commit**

```bash
git commit -m "$(cat <<'EOF'
docs: clarify env.example to separate dev from prod DB creds

Adds guidance comments to the Database section of .env.example
explaining that .env.local should point at kubri-dev only.
Prod credentials live in Vercel env vars.

Refs: docs/superpowers/specs/2026-04-21-dev-prod-db-split-design.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify commit landed cleanly**

```bash
git log -1 --stat
```

Expected: one file changed (`.env.example`), ~7 insertions, 1 deletion (the comment-line rewrite).

---

## Definition of Done

All of the following must be true:

1. `kubri-dev` Supabase project contains all tables from `kubri-prod` with matching row counts.
2. `pnpm prisma migrate status` reports no pending migrations against `kubri-dev`.
3. `.env.local` points at `kubri-dev` only; the `kubri-prod` project ref does not appear in it.
4. A write performed via the dev server lands in `kubri-dev` and is absent in `kubri-prod`.
5. `.env.example` contains the clarifying comments, committed to `main`-bound branch.
6. `/tmp/kubri-snapshot.sql` and `/tmp/kubri-restore.log` are removed.
7. Shell no longer has `KUBRI_PROD_URL` or `KUBRI_DEV_URL` exported.

## Rollback

If something goes wrong mid-execution:

- **After Task 4, before Task 6**: just drop and recreate `public` schema on `kubri-dev` — nothing else changed. `.env.local` still points at prod, dev server still works as before.
- **After Task 6, before Task 9 commit**: restore `.env.local` from the backup copy created in Task 6 Step 1. Nothing is committed yet, so `git reset` is not needed.
- **After Task 9 commit**: `git revert <commit>` to undo the `.env.example` change; manually restore `.env.local` from backup. The `kubri-dev` data can stay — it is harmless.
