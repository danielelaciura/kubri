# Phase 2 — Move Dashboard into apps/dashboard (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the existing dashboard Next app out of the repo root into `apps/dashboard/`, making the monorepo symmetric so the public `apps/assessment` app builds and deploys on Vercel.

**Why now (not deferred):** The incremental layout (dashboard = a Next app AT the repo root, with `src/middleware.ts` and `src/app`) makes the nested `apps/assessment` app **undeployable** on Vercel. Empirically confirmed: with `turbopack.root` = workspace root, Turbopack pulls the dashboard's root `src/middleware.ts` into the assessment build; with the inferred root it can't resolve `next` (pnpm installs it at the workspace root); and `next build --webpack` produces output Vercel's Next 16 integration rejects (`routes-manifest-deterministic.json` ENOENT). All three failures share one root cause: a Next app sitting at the workspace root. Standard monorepos keep the root as orchestration-only with all apps under `apps/*` — this plan does exactly that.

**Architecture:** `git mv` the entire dashboard (src, prisma, public, all its config + scripts, its package.json) into `apps/dashboard/`. The repo root becomes a pure pnpm-workspace orchestrator (no app, no Prisma). Nothing about the dashboard's internals changes — all its paths are relative (`@/*` → `./src/*`, prisma generator `../src/generated/prisma`, `prisma.config.ts` → `prisma/...`) and stay correct because `src/` and `prisma/` move together. The Vercel dashboard project's Root Directory changes `.` → `apps/dashboard`. The assessment app then builds cleanly (the root is clean).

**Tech Stack:** pnpm workspaces, Next 16.2.2, Prisma 7 (Postgres/pgvector), Vercel.

**Spec:** `docs/superpowers/specs/2026-06-24-assessment-app-repo-structure-design.md` (Phase 2 section).

## Decisions (fixed for this plan)

- **Prisma moves WITH the dashboard** into `apps/dashboard/prisma` — NOT extracted to `packages/db`. The assessment app has no DB access, so a shared db package buys nothing now (YAGNI) and avoids extra migration-history risk.
- **`supabase/` stays at the repo root** — it is deployed via the Supabase CLI, not part of any Vercel build, and `tsconfig` already excludes `supabase/functions`.
- **`scripts/` (backfill/seed) move with the dashboard** into `apps/dashboard/scripts`.
- **Root becomes an orchestrator** package (`name: "kubri"`, private, no app deps).
- **The assessment app keeps `turbopack.root` = workspace root** — once the root has no `src/middleware.ts`, that config resolves `next` AND has nothing to mis-pickup, so the Turbopack build succeeds.

## ⚠️ Non-negotiable safety rails

- **Prisma migration history:** move `prisma/` with `git mv` only. Never edit an existing migration, never squash, **never `prisma migrate reset`** (drops the schema → wipes candidates + risks losing the HNSW pgvector indexes). After the move, `prisma migrate status` against **dev** must report **0 pending** — that is the proof the move didn't disturb history. See the project notes on pgvector / `embeddingUpdatedAt` migration drift.
- **Production cutover is the one risky step:** changing the dashboard Vercel project's Root Directory affects all its deploys. Validate on a PR preview first, then merge. Keep the ability to revert Root Directory to `.`.
- **PR flow:** all of this lands via a PR, never a direct merge to main.

## File map (what moves, what stays)

Move into `apps/dashboard/` (via `git mv`): `src/`, `prisma/`, `prisma.config.ts`, `public/`, `scripts/`, `next.config.ts`, `tsconfig.json`, `components.json`, `postcss.config.mjs`, `vitest.config.ts`, `vitest.setup.ts`, `eslint.config.mjs`, `vercel.json`, and the current root `package.json` (becomes the dashboard's).

Stays at repo root: `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.gitignore`, `docs/`, `CLAUDE.md`, `README.md`, `supabase/`, `apps/`, `packages/`, and a NEW orchestrator `package.json`.

Local-only (gitignored — the human moves these by hand in their main checkout, they are NOT in git): `.env.local`, `.env.prod` → `apps/dashboard/`.

---

## Task 1: Branch + move the dashboard tree into apps/dashboard

**Files:** large `git mv` of the dashboard into `apps/dashboard/`.

- [ ] **Step 1: Create the working branch**

```bash
git checkout main && git pull
git checkout -b feat/phase2-dashboard-into-apps
mkdir -p apps/dashboard
```

- [ ] **Step 2: Move the dashboard's package.json first (it becomes the dashboard package)**

```bash
git mv package.json apps/dashboard/package.json
```

- [ ] **Step 3: Move the dashboard source, prisma, and config into apps/dashboard**

```bash
git mv src prisma prisma.config.ts public scripts \
       next.config.ts tsconfig.json components.json postcss.config.mjs \
       vitest.config.ts vitest.setup.ts eslint.config.mjs vercel.json \
       apps/dashboard/
```

- [ ] **Step 4: Verify the tree**

Run: `git status --short && ls -A apps/dashboard`
Expected: the listed paths show as renames (`R`) into `apps/dashboard/`; repo root no longer contains `src/`, `prisma/`, `next.config.ts`, etc. `supabase/`, `docs/`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` remain at root.

- [ ] **Step 5: Commit the move (mechanical, no content changes yet)**

```bash
git add -A
git commit -m "refactor: move dashboard into apps/dashboard (Phase 2)"
```

---

## Task 2: Create the root orchestrator package.json

The root is no longer an app. It only coordinates the workspace.

**Files:**
- Create: `package.json` (new root orchestrator)

- [ ] **Step 1: Write the new root package.json**

`package.json`:

```json
{
  "name": "kubri",
  "version": "0.1.0",
  "private": true,
  "packageManager": "pnpm@10.33.0",
  "scripts": {
    "dev:dashboard": "pnpm --filter kubri-dashboard dev",
    "dev:assessment": "pnpm --filter @kubri/assessment dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test"
  }
}
```

- [ ] **Step 2: Reinstall so the workspace re-links with the new layout**

Run: `pnpm install`
Expected: completes; pnpm reports 3 workspace projects (`kubri-dashboard` at `apps/dashboard`, `@kubri/assessment`, `@kubri/contracts`). The dashboard's `postinstall` (`prisma generate`) runs from `apps/dashboard` and regenerates the client at `apps/dashboard/src/generated/prisma`.

- [ ] **Step 3: Add a root vitest config for the non-dashboard workspace tests**

The dashboard's `vitest.config.ts` moved into `apps/dashboard` (Task 1). The `@kubri/contracts` and `apps/assessment` tests were running through that root config, so they now need their own. Create `vitest.config.ts` at the repo root scoped to the non-dashboard tests:

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["packages/**/*.test.ts", "apps/assessment/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**", "apps/dashboard/**"],
  },
});
```

- [ ] **Step 4: Verify the workspace-level tests still run**

Run: `pnpm exec vitest run packages/contracts apps/assessment`
Expected: 7 passed (the 3 contracts + 4 community-route tests), using the new root config.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts
git commit -m "chore: root becomes pnpm workspace orchestrator"
```

---

## Task 3: Verify the dashboard is intact at its new location

No code changes expected — this task is verification gates. All dashboard paths are relative and moved together, so they should still resolve. If any step fails, STOP and report (do not "fix" by editing migrations or resetting).

**Files:** none (verification only). If a path genuinely needs fixing, it will be in `apps/dashboard/prisma.config.ts` or `apps/dashboard/package.json` — fix in place and note it.

- [ ] **Step 1: Prisma client generates from the new location**

Run: `pnpm --filter kubri-dashboard exec prisma generate`
Expected: "Generated Prisma Client ... to ./src/generated/prisma" (i.e. `apps/dashboard/src/generated/prisma`). The generator output `../src/generated/prisma` and the `@/generated/prisma` import both still resolve because `prisma/` and `src/` moved together.

- [ ] **Step 2: Migration history still matches the database (THE key safety gate)**

Run (from a shell with the dev DB env loaded, in `apps/dashboard`):
`cd apps/dashboard && set -a && source .env.local && set +a && pnpm exec prisma migrate status`
Expected: **"Database schema is up to date!"** / 0 pending migrations. This proves the `git mv` did not disturb the migration history (the DB tracks migrations by name + checksum, not path).

> If this errors with "could not find schema" → fix the `schema`/`migrations` paths in `apps/dashboard/prisma.config.ts` (they are relative: `prisma/schema.prisma`, `prisma/migrations`) and retry. Do NOT run `migrate dev` or `reset`.

- [ ] **Step 3: Dashboard type-check / lint**

Run: `pnpm --filter kubri-dashboard lint`
Expected: passes as before (same code, new location).

- [ ] **Step 4: Dashboard test suite**

Run: `pnpm --filter kubri-dashboard test`
Expected: same result as before the move — non-DB tests green; DB-backed tests fail only if `.env.local` is absent (known worktree limitation, not a regression).

- [ ] **Step 5: Dashboard production build**

Run: `pnpm --filter kubri-dashboard build`
Expected: `prisma generate && next build` succeeds. The dashboard now builds from `apps/dashboard` with the repo root as a clean workspace root.

- [ ] **Step 6: Commit only if a config path needed fixing; otherwise nothing to commit**

```bash
git add -A && git commit -m "fix: align dashboard config paths after move" || echo "no changes needed"
```

---

## Task 4: Switch the assessment app to Turbopack and confirm it builds

The whole point of Phase 2. With no `src/middleware.ts` at the workspace root, the assessment app's Turbopack build (root = workspace root) resolves `next` and has nothing to mis-pickup.

> **Note on PR #42:** the earlier experiment PR `fix/assessment-vercel-turbopack` proved the root cause and contains the correct end-state assessment config (drop `--webpack`, add `turbopack.root`). This branch is based on `main` and does NOT include it, so we re-apply those two edits here and **close PR #42 as superseded** by this Phase 2 PR. (The `packageManager` field from #42 is already covered by the new root orchestrator `package.json` in Task 2.)

**Files:**
- Modify: `apps/assessment/package.json` (build/dev scripts → drop `--webpack`)
- Modify: `apps/assessment/next.config.ts` (add `turbopack.root` = workspace root)

- [ ] **Step 0a: Drop `--webpack` from the assessment scripts**

In `apps/assessment/package.json`, set:

```json
    "dev": "next dev --port 3002",
    "build": "next build",
    "start": "next start --port 3002"
```

- [ ] **Step 0b: Point Turbopack at the workspace root**

Replace `apps/assessment/next.config.ts` with:

```ts
import type { NextConfig } from "next";
import path from "path";

// The workspace root (repo root, two levels up). Turbopack must use this as its
// root so it can resolve `next`, which pnpm installs in the workspace-root
// node_modules — outside this app's directory. Next still scopes the project to
// this app (apps/assessment); this only widens module resolution.
const workspaceRoot = path.resolve(__dirname, "../..");

const nextConfig: NextConfig = {
  // @kubri/contracts ships raw TS; Next must transpile it.
  transpilePackages: ["@kubri/contracts"],
  turbopack: {
    root: workspaceRoot,
  },
  outputFileTracingRoot: workspaceRoot,
};

export default nextConfig;
```

- [ ] **Step 1: Build the assessment app**

Run: `pnpm --filter @kubri/assessment build`
Expected: `✓ Compiled successfully` with routes `/`, `/_not-found`, `/api/community`. NO `Can't resolve '@/lib/supabase/middleware'` error (that file no longer exists at the workspace root).

- [ ] **Step 2: Re-run the assessment unit tests (regression check)**

Run: `pnpm exec vitest run packages/contracts apps/assessment`
Expected: 7 passed.

- [ ] **Step 3: Commit (only if any assessment config simplification was made)**

```bash
git add -A && git commit -m "chore: assessment build confirmed under clean workspace root" || echo "no changes"
```

---

## Task 5: Update docs and the Vercel/migration references

The move changes where the dashboard lives; docs that name root paths must follow.

**Files:**
- Modify: `CLAUDE.md` (paths: `prisma/schema.prisma` → `apps/dashboard/prisma/schema.prisma`; migration commands now run from `apps/dashboard`; project-structure tree; "generated client" path; the dashboard dev/build commands).
- Modify: `docs/superpowers/specs/2026-06-24-assessment-app-repo-structure-design.md` (mark Phase 2 done; update the deployment table — dashboard Root Directory is now `apps/dashboard`).
- Modify: `.env.example` location note (the dashboard env example now lives at `apps/dashboard/.env.example` if moved; if kept at root, note it documents the dashboard).

- [ ] **Step 1: Update CLAUDE.md path references**

Search `CLAUDE.md` for `prisma/`, `pnpm prisma`, `src/`, the Project Structure tree, and the Migration Workflow section. Update each to reflect `apps/dashboard/` (e.g. migration commands: `cd apps/dashboard && set -a && source .env.prod && set +a && pnpm exec prisma migrate deploy`). Update the Project Structure tree to show `apps/dashboard`, `apps/assessment`, `packages/contracts`.

- [ ] **Step 2: Update the design spec's deployment section**

In the spec, change the dashboard Vercel Project's Root Directory from `.` to `apps/dashboard`, and note Phase 2 is complete (the layout is now symmetric).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs apps/dashboard/.env.example .env.example 2>/dev/null
git commit -m "docs: update paths for the apps/dashboard layout (Phase 2)"
```

---

## Task 6: Open the PR + Vercel cutover (human-driven)

This is the production-affecting part. It is deliberate and gated.

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin feat/phase2-dashboard-into-apps
gh pr create --base main --title "Phase 2: move dashboard into apps/dashboard" --body "<summary + the Vercel cutover checklist below>"
```

- [ ] **Step 2: Dashboard Vercel project — change Root Directory (the cutover)**

In the **existing** `kubri-dashboard` Vercel project: Settings → Root Directory: `.` → **`apps/dashboard`**. (Crons in `apps/dashboard/vercel.json` are resolved relative to the new root automatically.) This applies to all subsequent deploys.

- [ ] **Step 3: Validate on the PR's preview deploys**

- Dashboard project preview (of this PR branch, now with Root Directory `apps/dashboard`) → must build green.
- Assessment project preview (of this PR branch) → must now build green (the original goal).

- [ ] **Step 4: Merge → production**

Once both previews are green, merge the PR. The dashboard prod deploy uses `apps/dashboard`; the assessment project can then be promoted/deployed to its domain. If the dashboard prod deploy misbehaves, revert the Vercel Root Directory to `.` and revert the PR.

---

## Out of scope (later)

- Extracting `packages/db` (shared Prisma), `packages/i18n`, `packages/ui` — only when a second consumer actually needs them.
- The assessment **feature phase**: dashboard-side webhook receiver, questionnaire UI, LLM report/PDF, `Candidate` mapping (separate spec, needs the questionnaire).
- Moving `supabase/` under the dashboard (left at root deliberately).
