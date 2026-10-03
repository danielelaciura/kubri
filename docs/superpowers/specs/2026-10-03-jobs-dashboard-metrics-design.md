# Jobs dashboard metrics + JD name normalization — Design

**Date:** 2026-10-03
**Status:** Approved in brainstorming, pending spec review
**Scope:** `apps/dashboard`

## Goal

Add a small KPI dashboard at the top of the "Analisi candidati" page
(`/dashboard/jobs`), fed exclusively by the matching runs that users trigger
(create / edit / "Rigenera" of an analysis). Alongside it, normalize the casing
of analysis (JD) names.

V1 KPIs:

1. **Analisi attive** — number of JDs of the org, plus how many were created in
   the last 30 days.
2. **Candidati a target** — unique candidates with `llmScore >= 80` (green /
   light-green band) in at least one analysis of the org.
3. **Mai passati da un matching** — candidates visible to the org that were
   never evaluated by the AI in any analysis, shown against the total pool.

Out of scope (YAGNI): trends over time, drill-down from the cards, skill gap,
per-status funnel, "analyses without target matches". All remain possible on
the same data model later.

## Background / constraints

- Match results are **not persisted today**. `jobs/[id]/page.tsx` → `Matches`
  ranks all org candidates by embedding, sends those with embedding score
  `>= 80` (max 30) to the Mistral rerank, and renders the result. Only the
  rerank cache (`llm:rerank:{jdId}:{candidate ids signature}`, 24h TTL,
  Upstash in prod) survives.
- `CandidateStatus` is per organization, not per JD — no per-analysis funnel is
  possible without a separate feature.
- The "Rigenera" button (`MatchesSection` → `refreshCandidatesForJob()`)
  currently calls `clearRerankCache()`, wiping the rerank cache of **every**
  JD of **every** organization.

## Part 1 — Data model and snapshot writes

### New model `JobMatch`

```prisma
model JobMatch {
  jobDescriptionId String   @db.Uuid
  candidateId      String   @db.Uuid
  organizationId   String   @db.Uuid
  llmScore         Int
  computedAt       DateTime @default(now())

  jobDescription JobDescription @relation(fields: [jobDescriptionId], references: [id], onDelete: Cascade)
  candidate      Candidate      @relation(fields: [candidateId], references: [id], onDelete: Cascade)
  organization   Organization   @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@id([jobDescriptionId, candidateId])
  @@index([organizationId, llmScore])
  @@index([organizationId, candidateId])
}
```

Back-relations (`jobMatches JobMatch[]`) are added to `JobDescription`,
`Candidate` and `Organization`.

- Stores **every candidate evaluated by the LLM** for that JD, not only those
  `>= 80`. The target threshold is applied at read time, so changing it later is
  a query change only. "Evaluated by the AI" is also the definition of "passed
  through a job matching".
- One row per (JD, candidate): unique-candidate vs. sum-of-matches counts are
  both derivable from the same rows without migration or backfill.
- Only the score is stored. Adding e.g. `missingSkills` later requires a
  regeneration, which is acceptable.
- Cascades clean up on JD / candidate / org deletion.
- The migration is hand-authored and must **not** contain the spurious
  `DROP INDEX` statements on the HNSW pgvector indexes that `migrate dev` injects.

### Snapshot writes — `src/lib/jobs/match-snapshot.ts`

`replaceJobMatchSnapshot({ jobDescriptionId, organizationId, entries })`, where
`entries: { candidateId: string; llmScore: number }[]`. In a single Prisma
transaction: `deleteMany` all rows of the JD, then `createMany` the new entries
(skipped when `entries` is empty).

`rerankCandidates` changes its return type to
`{ enrichments: CandidateEnrichment[]; fromCache: boolean }`. Callers are updated.

In `Matches` (`jobs/[id]/page.tsx`):

| Situation | Snapshot action |
|---|---|
| Rerank succeeded, `fromCache === false` | `replaceJobMatchSnapshot` with the enrichments (score rounded to int) |
| Rerank succeeded, `fromCache === true` | none |
| No candidate above the embedding threshold (`toRerank.length === 0`) | `replaceJobMatchSnapshot` with `[]` (clears stale rows) |
| `rankCandidates` or rerank failed | none — keep the last valid snapshot |

A failure inside `replaceJobMatchSnapshot` is caught and logged
(`console.error("[jobs/[id]] snapshot write failed", …)`); the matches still
render. The dashboard must never break the detail page.

Net effect: the snapshot is refreshed on create (redirect to detail), edit
(cache invalidated for the JD), "Rigenera", 24h cache expiry, or when the set
of candidates sent to the LLM changes (cache key changes). Plain repeat visits
do not write.

### "Rigenera" scoped to a single JD

`refreshCandidatesForJob(jdId: string)`:

1. `requireAdmin()` as today.
2. Verify the JD belongs to `ctx.organizationId` (`getJobDescription`); return
   silently otherwise.
3. `invalidateRerankCacheForJd(jdId)` (already exists) instead of
   `clearRerankCache()`.
4. `revalidatePath(\`/dashboard/jobs/${jdId}\`)` and `revalidatePath("/dashboard/jobs")`.

`MatchesSection` receives `jdId` as a prop and passes it through.

## Part 2 — Metrics service

`getJobsDashboardMetrics(organizationId)` in
`src/lib/jobs/dashboard-metrics.ts`. Resolves `poolIds` via
`getOrgAccessiblePoolIds`, builds `visibility = candidateVisibilityWhere(poolIds)`,
then runs five Prisma counts in `Promise.all`:

| Field | Query |
|---|---|
| `activeJobs` | `jobDescription.count({ where: { organizationId } })` |
| `jobsLast30Days` | same with `createdAt: { gte: now - 30 days }` |
| `targetCandidates` | `candidate.count({ where: { ...visibility, jobMatches: { some: { organizationId, llmScore: { gte: TARGET_MATCH_SCORE } } } } })` |
| `neverMatchedCandidates` | `candidate.count({ where: { ...visibility, jobMatches: { none: { organizationId } } } })` |
| `totalCandidates` | `candidate.count({ where: visibility })` |

- Counting from `Candidate` with relation filters yields unique candidates.
- The visibility filter ensures a candidate that is no longer visible to the
  org (e.g. `sharedWithGlobal` revoked) drops out of the numbers even if
  `JobMatch` rows remain — no cross-org leaks.
- `TARGET_MATCH_SCORE = 80` lives in one place (`src/lib/jobs/constants.ts`)
  and is also used by `score-badge.tsx` for the light-green band boundary, so
  KPI and colors cannot diverge.
- No raw SQL.

Return type:

```ts
interface JobsDashboardMetrics {
  activeJobs: number;
  jobsLast30Days: number;
  targetCandidates: number;
  neverMatchedCandidates: number;
  totalCandidates: number;
}
```

## Part 3 — UI

At the top of `/dashboard/jobs`, between the page title and the table: a
`md:grid-cols-3` grid of three existing `StatCard`s
(`src/components/stats/stat-card.tsx`), wrapped in a server component
`JobsDashboard` (`src/components/jobs/jobs-dashboard.tsx`):

| Card | Value | Description |
|---|---|---|
| Analisi attive | `activeJobs` | "+{n} negli ultimi 30 giorni" |
| Candidati a target | `targetCandidates` | "Score ≥ 80 in almeno un'analisi" |
| Mai passati da un matching | `neverMatchedCandidates` | "su {total} candidati totali" |

`StatCard.value` widens to accept a pre-formatted string so numbers are
formatted with the resolved locale (`it-IT` → `1.240`, `en-GB` → `1,240`);
descriptions format numbers the same way.

States:

- **No analyses** — the dashboard is not rendered; the existing empty state
  stays.
- **Snapshot not yet populated** (`activeJobs > 0 && neverMatchedCandidates ===
  totalCandidates`, i.e. right after release) — a muted note under the cards:
  "I dati si popolano quando apri o rigeneri un'analisi."
- **Loading** — `<Suspense>` with a three-card skeleton; the table does not
  wait for the metrics.
- **Error** — inline error message instead of the cards; the table still
  renders. Error logged server-side.

Visible to all org roles (aggregate numbers, no personal data).

i18n: new `jobs.dashboard.*` keys (card titles, descriptions with
placeholders, populate note, error) in **both** `it.ts` and `en.ts`.

## Part 4 — JD name normalization

Applies to `JobDescription.name` only; description, skills and location are
untouched.

### Rule (heuristic "C") — `normalizeJobName(name)` in `src/lib/jobs/normalize-name.ts`

1. Trim and collapse internal whitespace to single spaces.
2. If every letter of the whole title is uppercase (Unicode-aware, `\p{Lu}` /
   `\p{Ll}`): lowercase everything (`toLocaleLowerCase("it")`).
3. Otherwise, per whitespace-separated token: if the token contains **at least
   two letters and all of its letters are uppercase**, keep it as-is (treated as
   an acronym: `OSS`, `HACCP`, `B2B`, `OSS/ASA`); else lowercase it.
4. Uppercase the first letter of the resulting string (first `\p{L}` character).

Examples:

| Input | Output |
|---|---|
| `MAGAZZINIERE CARRELLISTA` | `Magazziniere carrellista` |
| `Addetto Alle Pulizie` | `Addetto alle pulizie` |
| `Operatore OSS Milano` | `Operatore OSS milano` |
| `operatore HACCP` | `Operatore HACCP` |
| `OPERATORE OSS` | `Operatore oss` (known limitation: all-caps title loses acronyms) |
| `Addetto A Magazzino` | `Addetto a magazzino` (single letters are not acronyms) |

The function is idempotent (`normalize(normalize(x)) === normalize(x)`).
Proper nouns (e.g. city names) are lowercased — accepted trade-off.

### Write path

`jobDescriptionInputSchema.name` gains `.transform(normalizeJobName)` after the
existing `trim/min/max`. Create and edit therefore persist the normalized name.
Two names that normalize to the same value hit the existing
`@@unique([organizationId, name])` → existing "Esiste già un'analisi con questo
nome" error. No new UI.

### Backfill — `scripts/normalize-job-names.ts`

One-off script (backfills are the sanctioned exception for direct writes):

- Iterates all JDs; computes `normalizeJobName(name)`; skips unchanged ones.
- **Collision check:** if another JD of the same org already has (or will
  have, within this run) the normalized name, skip and report
  `orgId / jdId / original / normalized`. Never fails the whole run.
- Updates `name`, then calls the existing `syncJobDescriptionEmbedding` for the
  JD, because the name is part of the embedding text (`RUOLO: {name}`).
- `--dry-run` flag prints the planned changes and collisions without writing.
- Prints a summary: renamed / unchanged / skipped-collision / embedding errors.

## Testing (vitest)

- `normalizeJobName`: table-driven tests for all examples above, whitespace,
  accented letters (`ADDETTO ALLA CUCINA È` → `Addetto alla cucina è`),
  empty-after-trim not applicable (schema `min(1)` runs first), idempotency.
- `jobDescriptionInputSchema`: name is normalized on parse.
- `replaceJobMatchSnapshot`: delete + create in one transaction; empty entries
  → delete only.
- `getJobsDashboardMetrics`: Prisma mocked; asserts org scoping, threshold
  `>= 80`, 30-day window, visibility filter present on every candidate count.
- `rerankCandidates`: `fromCache` true on hit, false on miss (update existing
  rerank tests for the new return shape).
- `refreshCandidatesForJob`: invalidates only the given JD; no-op for a JD of
  another org.
- i18n parity test covers the new keys automatically.

## Rollout

1. Apply the `JobMatch` migration to prod before merging (standard flow).
2. Merge → deploy.
3. Run `scripts/normalize-job-names.ts --dry-run` against prod, review
   collisions, then run for real.
4. Open each existing analysis and press "Rigenera" to populate the snapshot.
