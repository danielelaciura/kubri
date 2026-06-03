# Email Notifications — New Candidates Digest

**Date:** 2026-06-03
**Status:** Design approved, pending spec review

## Summary

Per-user email notifications that periodically send each Kubri dashboard user a
digest of how many **new candidates** entered the platform during a period,
scoped to the **non-global pools** associated with the user's organization. The
user chooses the cadence (daily or weekly). If there are no new candidates in
the period, no email is sent.

## Goals

- Let each user opt in and choose a cadence (daily / weekly).
- Send a digest email summarising new candidates per pool, with a link back to
  the dashboard.
- Never send an empty email (zero new candidates → skip).
- Robust against missed/late cron runs (no gaps, no duplicates).
- Respect GDPR: no candidate PII leaves the infrastructure via email.

## Non-Goals (YAGNI for V1)

- No in-app / push / SMS channels (email only).
- No per-user choice of weekday or send time (fixed schedule).
- No per-user pool selection (always all non-global pools of the org).
- No candidate PII in the email body (summary + link only).
- No multi-channel `NotificationPreference` table.

## Key Decisions

| Topic | Decision |
|-------|----------|
| Email content | **Summary + link only** — counts and per-pool breakdown, CTA to dashboard. No candidate PII in the body. |
| Period model | **Watermark** — count candidates with `createdAt > lastNotifiedAt`. Cadence only controls *how often*, not the window. |
| Preference ownership | **Per-user, opt-in, any role** — default `notifyEnabled = false`; each user manages their own from settings. |
| Timing | **Fixed day, fixed hour** — one daily cron. DAILY users every day; WEEKLY users on a single fixed weekday. |
| Pool scope | **Non-global org pools** — pools joined to the user's org via `OrganizationPool` where `Pool.isGlobal = false`. |
| Initial cutoff | **Activation moment** — enabling the flag sets `lastNotifiedAt = now()`. First email covers only candidates that arrive after opt-in (no historical flood). |
| Email provider | **Resend + React Email** — native Next.js DX, TSX templates, EU region, ample free tier. |
| Preference storage | **Dedicated columns on `User`** — typed, indexable, simple cron query. |

## Architecture & Data Flow

```
Vercel Cron (1×/day, e.g. 07:00 UTC)
        │  GET /api/cron/notifications   (Authorization: Bearer CRON_SECRET)
        ▼
 select-recipients.ts ──► users with notifyEnabled = true that are "due" today
        │                   (DAILY always; WEEKLY only if today == WEEKLY_SEND_DAY)
        ▼
 for each user (isolated — a failure does not abort the batch):
   new-candidates.ts ──► per-pool count of candidates where
                         poolId ∈ non-global pools of the user's org
                         AND createdAt > lastNotifiedAt
        │
        ├─ total == 0 ─► skip; no email; lastNotifiedAt unchanged
        │
        └─ total > 0  ─► send-digest.ts ─► Resend (React Email template)
                              │
                              └─ on send success ─► lastNotifiedAt = now()
```

Principles:

- **Per-user isolation:** each send wrapped in try/catch; failures are logged and
  the batch continues.
- **Watermark updated only after a successful send** → idempotent; a missed/failed
  run is retried on the next cron with no gaps or duplicates.
- Reuses the existing cron auth pattern (`Bearer CRON_SECRET`) and the existing
  `Candidate` index `[poolId, createdAt]`.
- All queries scoped by organization → consistent with the non-negotiable
  security rules.

## Schema Changes (Prisma)

```prisma
enum NotifyFrequency {
  DAILY
  WEEKLY
}

model User {
  // ...existing fields...
  notifyEnabled   Boolean         @default(false)   // opt-in
  notifyFrequency NotifyFrequency @default(WEEKLY)   // used only when enabled
  lastNotifiedAt  DateTime?                          // send watermark; set to now() at opt-in
}
```

Notes:

- Additive, non-destructive migration (new columns with defaults + new enum) —
  no backfill, no expand & contract, no downtime.
- Follows the project's standard migration workflow (CLAUDE.md → "Database
  Migration Workflow"): `prisma migrate dev` against dev, then
  `prisma migrate deploy` against **prod before merging** the PR.
- For enabled users `lastNotifiedAt` is always populated (set at opt-in), so the
  cron query can rely on it; a `?? user.createdAt` fallback is kept as defence in
  depth.

## File Structure

```
src/
  app/api/cron/notifications/route.ts        ← handler (Bearer CRON_SECRET), thin orchestrator
  lib/notifications/
    select-recipients.ts                     ← who is "due" today (DAILY + WEEKLY-on-day-X)
    new-candidates.ts                        ← new-candidate counts per user (non-global, watermark)
    send-digest.ts                           ← Resend send + lastNotifiedAt update
    config.ts                                ← constants (WEEKLY_SEND_DAY — the app compares today's weekday; the send hour is set by the cron schedule in vercel.json, not in code)
  lib/email/
    client.ts                                ← Resend init (RESEND_API_KEY, server-side only)
  emails/
    candidate-digest.tsx                     ← React Email template (summary + per-pool breakdown + CTA)
  lib/validations/notification.ts            ← Zod schema for the preference form
  components/settings/notification-form.tsx  ← client component (toggle + frequency select)
vercel.json                                  ← + 1 cron entry
.env.example                                 ← + RESEND_API_KEY, EMAIL_FROM
```

Each unit has a single responsibility and is testable in isolation: the query,
the recipient selection, and the send are separate; the cron handler is thin
orchestration.

## UI — Settings

A new "Notifiche email" `Card` in the existing settings Server Component, with a
client component `NotificationForm` (on/off toggle + Daily/Weekly select). It
saves via a **server action** validated with Zod and `revalidatePath`, mirroring
the existing `OrgNameForm` pattern. The preference is per-user (writes the logged-in
`User` row). **Enabling notifications sets `lastNotifiedAt = now()`** so the first
digest only covers candidates after opt-in.

UI strings go through the i18n strings file (Italian), per project convention.

## New Candidates Query

Single Prisma query per user:

```ts
prisma.candidate.groupBy({
  by: ['poolId'],
  where: {
    pool: {
      isGlobal: false,
      organizations: { some: { organizationId: user.organizationId } },
    },
    createdAt: { gt: user.lastNotifiedAt ?? user.createdAt },
  },
  _count: { _id: true },
});
```

Returns the per-pool breakdown; the sum is the total; empty → skip. Pool display
names are resolved for the email breakdown.

## Error Handling

- Per-user send in `try/catch`; failures logged via `console.error`.
- `lastNotifiedAt` updated **only** on a successful send.
- No explicit retry — the next cron run retries (idempotent by construction).
- Cron handler returns a JSON summary (e.g. `{ sent, skipped, failed }`).

## Testing

- Unit tests for `new-candidates` — watermark boundary, global-pool exclusion,
  org scoping.
- Unit tests for `select-recipients` — DAILY vs WEEKLY-on-day logic.
- The email template render and Resend client are mocked; no real sends in tests.

### Local template preview

For iterating on the email template, use the React Email dev server (the only
local-testing mechanism in scope for V1 — send/E2E mechanics are deferred):

```jsonc
// package.json
"email": "react-email dev --dir src/emails --port 3001"
```

`pnpm email` serves the templates at `localhost:3001` with hot reload (port 3001
to avoid clashing with `next dev` on 3000). Sample data is declared on the
component via `CandidateDigestEmail.PreviewProps = { … }`, so the preview always
renders realistic content with no DB access and no sending.

## Environment Variables

- `RESEND_API_KEY` — server-side only.
- `EMAIL_FROM` — verified sender address.
- (Existing) `CRON_SECRET` — reused for the cron endpoint auth.

## Rollout

1. Schema migration (dev → prod-before-merge, per CLAUDE.md).
2. Add `RESEND_API_KEY` / `EMAIL_FROM` to Vercel env (dev + prod) and verify the
   sender domain in Resend.
3. Add the cron entry to `vercel.json`.
4. Ship; users opt in from settings.
