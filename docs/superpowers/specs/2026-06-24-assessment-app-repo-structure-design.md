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
   - **"Join the Kubri community"** → collects name, surname, phone number (lead capture).

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
("B-via-API"). It has no Prisma client and no DB credentials. It persists the only data worth
keeping (community leads) by POSTing to an authenticated endpoint on the dashboard. This is
consistent with `CLAUDE.md`'s rule that candidate/lead writes go through a controlled endpoint,
not from arbitrary UI/server actions, and it keeps DB credentials out of the public surface
(priority A).

The report PDF is generated from the **current session's answers** + LLM — it needs no DB
read — so the public app can do all heavy lifting (LLM + PDF) in its own backend with **zero**
DB access.

### Repo structure

```
kubri/
├── pnpm-workspace.yaml          # packages: ['apps/*', 'packages/*'] (+ root)
├── package.json                 # root: dashboard (kubri-dashboard), nearly untouched
├── prisma/                      # stays at root (owned by dashboard)
├── src/app/api/assessment/      # NEW authenticated endpoint: lead-capture → Postgres
├── packages/
│   └── contracts/               # @kubri/contracts: Zod schema + types for the lead payload
└── apps/
    └── assessment/              # @kubri/assessment: public Next app (separate domain)
        ├── env: LLM key ONLY — NO DB credentials
        └── src/app/
            ├── (questionnaire, mobile-first, no auth)
            └── api/
                ├── report/      # LLM → concept map → PDF (@react-pdf/renderer)
                └── community/   # forwards the lead to dashboard /api/assessment
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
        │                      [no DB read/write]
        └─ "Join community"  → app/api/community → authenticated POST →
                                dashboard /api/assessment → Postgres (lead only)
```

The only thing crossing the boundary toward the DB is the **lead** (name, surname, phone),
validated with `@kubri/contracts` on both sides.

## Out of scope / deferred (YAGNI)

- **Persisting assessment results** — not done. Raw answers gain value only when the user
  becomes a real contact (leaves name + phone). Only community leads are stored.
- **Shared `packages/db` / `packages/i18n` / `packages/ui`/`pdf`** — not needed for this scope.
  `@react-pdf/renderer` is already available; the assessment app can start with local i18n.
- **Feature internals** — questionnaire content, PDF/concept-map layout, LLM prompt and model
  wiring (consult the `claude-api` skill at implementation time), and the lead data model
  (does the lead become a `Candidate`? a separate `Lead` entity? does it enter the Make
  funnel?) — all defined in a separate feature spec once the questionnaire is provided.

## Follow-up (post-launch) — REQUIRED

**Once the assessment feature is live in production, complete the architectural migration:**
move the existing dashboard from the repo root into `apps/dashboard/`, making the monorepo
symmetric (two apps under `apps/`, shared code under `packages/`). The incremental layout
(dashboard at root + `apps/assessment`) is a deliberate temporary asymmetry; this follow-up
closes it. Nothing done in the incremental phase is thrown away — it becomes Option 1 in full.
