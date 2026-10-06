# Jobs Dashboard Metrics + JD Name Normalization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 3-card KPI dashboard on `/dashboard/jobs` fed by persisted match snapshots, scope the "Rigenera" button to a single JD, and normalize JD name casing.

**Architecture:** A new `JobMatch` table stores, per (JD, candidate), the LLM score of every candidate the AI evaluated. The JD detail page writes it only when the rerank result is fresh (cache miss). A metrics service runs five Prisma counts (scoped by org + candidate visibility) and a server component renders them with the existing `StatCard`. JD names are normalized by a pure function wired into the Zod schema, plus a one-off backfill script.

**Tech Stack:** Next.js App Router (Server Components), Prisma (Postgres), Zod v4 (`zod/v4`), vitest, Tailwind/shadcn, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-03-jobs-dashboard-metrics-design.md`

**Conventions for every task:**
- All commands run from `apps/dashboard/` unless noted. Paths below are relative to `apps/dashboard/`.
- This worktree has **no `.env.local` and no DB**. Tests that need `DATABASE_URL` fail — those failures are pre-existing, not regressions. Only the test files named in each task must pass.
- Never use `any`. Never use raw SQL for new code (the existing `$queryRaw` / `$executeRaw` for pgvector stay).
- Commit messages: conventional commits, ending with the line
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/lib/jobs/normalize-name.ts` | create | `normalizeJobName` (pure) + `planJobNameRenames` (pure, used by backfill) |
| `src/lib/validations/job-description.ts` | modify | `name` gets `.transform(normalizeJobName)` |
| `src/lib/jobs/constants.ts` | create | `TARGET_MATCH_SCORE = 80` |
| `src/components/jobs/score-badge.tsx` | modify | light-green band boundary uses `TARGET_MATCH_SCORE` |
| `prisma/schema.prisma` | modify | `JobMatch` model + back-relations |
| `prisma/migrations/20261003120000_add_job_match/migration.sql` | create | hand-authored DDL |
| `src/lib/jobs/match-snapshot.ts` | create | `replaceJobMatchSnapshot` |
| `src/lib/llm/rerank.ts` | modify | return `{ enrichments, fromCache }`; drop `clearRerankCache` |
| `src/app/(dashboard)/dashboard/jobs/[id]/page.tsx` | modify | write snapshot after fresh rerank / no-affinity |
| `src/app/(dashboard)/dashboard/jobs/[id]/actions.ts` | modify | `refreshCandidatesForJob(jdId)` scoped to one JD |
| `src/components/jobs/matches-section.tsx` | modify | receives `jdId` prop |
| `src/lib/jobs/dashboard-metrics.ts` | create | `getJobsDashboardMetrics` |
| `src/lib/i18n/dictionaries/it.ts`, `en.ts` | modify | `jobs.dashboard.*` keys |
| `src/components/stats/stat-card.tsx` | modify | `value: number \| string` |
| `src/components/jobs/jobs-dashboard.tsx` | create | `JobsDashboard` (server) + `JobsDashboardSkeleton` |
| `src/app/(dashboard)/dashboard/jobs/page.tsx` | modify | render dashboard above the table |
| `src/lib/jobs/service.ts` | modify | export `syncJobDescriptionEmbedding`, return `boolean` |
| `scripts/normalize-job-names.ts` | create | one-off backfill |

Tests (all new or modified under `src/__tests__/`):
`lib/jobs/normalize-name.test.ts`, `lib/validations/job-description.test.ts`, `lib/jobs/match-snapshot.test.ts`, `lib/llm/rerank.test.ts`, `app/dashboard/jobs/refresh-action.test.ts`, `lib/jobs/dashboard-metrics.test.ts`.

---

### Task 0: Workspace setup

- [ ] **Step 1: Install dependencies (worktree has no node_modules)**

Run (from the worktree root): `pnpm install`
Expected: completes; `postinstall` runs `prisma generate` (if it fails for missing env, run `cd apps/dashboard && pnpm exec prisma generate` — generate does not need a DB connection).

- [ ] **Step 2: Baseline test run**

Run: `pnpm test 2>&1 | tail -20`
Expected: note which test files fail because of `DATABASE_URL` (pre-existing). Record the list; later tasks must not add new failures.

---

### Task 1: `normalizeJobName` and `planJobNameRenames`

**Files:**
- Create: `src/lib/jobs/normalize-name.ts`
- Test: `src/__tests__/lib/jobs/normalize-name.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { normalizeJobName, planJobNameRenames } from "@/lib/jobs/normalize-name";

describe("normalizeJobName", () => {
  it.each([
    ["MAGAZZINIERE CARRELLISTA", "Magazziniere carrellista"],
    ["Addetto Alle Pulizie", "Addetto alle pulizie"],
    ["Operatore OSS Milano", "Operatore OSS milano"],
    ["operatore HACCP", "Operatore HACCP"],
    ["OPERATORE OSS", "Operatore oss"],
    ["Addetto A Magazzino", "Addetto a magazzino"],
    ["Operatore OSS/ASA", "Operatore OSS/ASA"],
    ["Commerciale B2B", "Commerciale B2B"],
    ["ADDETTO ALLA CUCINA È", "Addetto alla cucina è"],
    ["  addetto    pulizie  ", "Addetto pulizie"],
    ["HACCP Addetto", "HACCP addetto"],
    ["già normalizzato", "Già normalizzato"],
  ])("%j -> %j", (input, expected) => {
    expect(normalizeJobName(input)).toBe(expected);
  });

  it("is idempotent", () => {
    for (const s of ["MAGAZZINIERE", "Operatore OSS Milano", "OSS", "addetto A b C", "Èlite Staff"]) {
      const once = normalizeJobName(s);
      expect(normalizeJobName(once)).toBe(once);
    }
  });

  it("leaves a string without letters untouched apart from whitespace", () => {
    expect(normalizeJobName(" 123  45 ")).toBe("123 45");
  });
});

describe("planJobNameRenames", () => {
  it("renames rows whose normalized name differs and counts unchanged ones", () => {
    const plan = planJobNameRenames([
      { id: "a", organizationId: "o1", name: "MAGAZZINIERE" },
      { id: "b", organizationId: "o1", name: "Cuoco" },
    ]);
    expect(plan.renames).toEqual([
      { id: "a", organizationId: "o1", from: "MAGAZZINIERE", to: "Magazziniere" },
    ]);
    expect(plan.collisions).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it("flags a collision with an already-normalized JD of the same org", () => {
    const plan = planJobNameRenames([
      { id: "a", organizationId: "o1", name: "MAGAZZINIERE" },
      { id: "b", organizationId: "o1", name: "Magazziniere" },
    ]);
    expect(plan.renames).toEqual([]);
    expect(plan.collisions).toEqual([
      { id: "a", organizationId: "o1", from: "MAGAZZINIERE", to: "Magazziniere" },
    ]);
    expect(plan.unchanged).toBe(1);
  });

  it("flags every member when two non-normalized names collide", () => {
    const plan = planJobNameRenames([
      { id: "a", organizationId: "o1", name: "MAGAZZINIERE" },
      { id: "b", organizationId: "o1", name: "magazziniere" },
    ]);
    expect(plan.renames).toEqual([]);
    expect(plan.collisions.map((c) => c.id).sort()).toEqual(["a", "b"]);
  });

  it("does not treat the same name in different orgs as a collision", () => {
    const plan = planJobNameRenames([
      { id: "a", organizationId: "o1", name: "MAGAZZINIERE" },
      { id: "b", organizationId: "o2", name: "MAGAZZINIERE" },
    ]);
    expect(plan.renames).toHaveLength(2);
    expect(plan.collisions).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/__tests__/lib/jobs/normalize-name.test.ts`
Expected: FAIL — cannot resolve `@/lib/jobs/normalize-name`.

- [ ] **Step 3: Write the implementation**

`src/lib/jobs/normalize-name.ts`:

```ts
const LETTER = /\p{L}/u;
const LOWERCASE_LETTER = /\p{Ll}/u;

function letterCount(s: string): number {
  let n = 0;
  for (const ch of s) if (LETTER.test(ch)) n++;
  return n;
}

/** True when `s` has at least `minLetters` letters and none of them is lowercase. */
function isUppercase(s: string, minLetters: number): boolean {
  return letterCount(s) >= minLetters && !LOWERCASE_LETTER.test(s);
}

function capitalizeFirstLetter(s: string): string {
  const chars = [...s];
  const i = chars.findIndex((ch) => LETTER.test(ch));
  if (i < 0) return s;
  chars[i] = chars[i]!.toLocaleUpperCase("it");
  return chars.join("");
}

/**
 * Sentence-case a JD name.
 *
 * - Whitespace is trimmed and collapsed.
 * - A fully uppercase title is lowercased entirely (acronyms included: we
 *   cannot tell them apart).
 * - Otherwise tokens with >= 2 letters, all uppercase, are kept as acronyms
 *   (OSS, HACCP, B2B, OSS/ASA); every other token is lowercased.
 * - The first letter is then uppercased.
 *
 * Idempotent.
 */
export function normalizeJobName(raw: string): string {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  const lowered = isUppercase(collapsed, 1)
    ? collapsed.toLocaleLowerCase("it")
    : collapsed
        .split(" ")
        .map((token) => (isUppercase(token, 2) ? token : token.toLocaleLowerCase("it")))
        .join(" ");
  return capitalizeFirstLetter(lowered);
}

export interface JobNameRow {
  id: string;
  organizationId: string;
  name: string;
}

export interface JobNameChange {
  id: string;
  organizationId: string;
  from: string;
  to: string;
}

export interface JobNameRenamePlan {
  renames: JobNameChange[];
  /** Rows whose normalized name would clash with another JD of the same org. */
  collisions: JobNameChange[];
  unchanged: number;
}

/**
 * Plan the backfill: group JDs by (org, normalized name). A group of one is a
 * plain rename (or unchanged); in a larger group every row that would have to
 * change is a collision and is skipped, since `(organizationId, name)` is unique.
 */
export function planJobNameRenames(rows: JobNameRow[]): JobNameRenamePlan {
  const groups = new Map<string, JobNameChange[]>();
  for (const r of rows) {
    const change: JobNameChange = {
      id: r.id,
      organizationId: r.organizationId,
      from: r.name,
      to: normalizeJobName(r.name),
    };
    const key = `${r.organizationId}\u0000${change.to}`;
    const group = groups.get(key);
    if (group) group.push(change);
    else groups.set(key, [change]);
  }

  const plan: JobNameRenamePlan = { renames: [], collisions: [], unchanged: 0 };
  for (const group of groups.values()) {
    for (const change of group) {
      if (change.from === change.to) plan.unchanged++;
      else if (group.length === 1) plan.renames.push(change);
      else plan.collisions.push(change);
    }
  }
  return plan;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/__tests__/lib/jobs/normalize-name.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/normalize-name.ts src/__tests__/lib/jobs/normalize-name.test.ts
git commit -m "feat(jobs): add JD name normalization helpers"
```

---

### Task 2: Normalize name in the JD Zod schema

**Files:**
- Modify: `src/lib/validations/job-description.ts`
- Test: `src/__tests__/lib/validations/job-description.test.ts`

- [ ] **Step 1: Write the failing test** — append inside the existing `describe("jobDescriptionInputSchema", …)` block:

```ts
  it("normalizes the name casing", () => {
    const r = jobDescriptionInputSchema.safeParse({ ...valid, name: "  OPERATORE   MAGAZZINO " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Operatore magazzino");
  });

  it("keeps acronyms in a mixed-case name", () => {
    const r = jobDescriptionInputSchema.safeParse({ ...valid, name: "Operatore OSS Notturno" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Operatore OSS notturno");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/__tests__/lib/validations/job-description.test.ts`
Expected: FAIL — received `"OPERATORE   MAGAZZINO"` (trimmed only).

- [ ] **Step 3: Implement** — in `src/lib/validations/job-description.ts` add the import and the transform:

```ts
import { normalizeJobName } from "@/lib/jobs/normalize-name";
```

```ts
  name: z
    .string()
    .trim()
    .min(1, "Il nome è obbligatorio")
    .max(120, "Massimo 120 caratteri")
    .transform(normalizeJobName),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/__tests__/lib/validations/job-description.test.ts src/__tests__/lib/jobs/service.test.ts`
Expected: PASS (service tests use `"Addetto pulizie"`, already normalized).

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/job-description.ts src/__tests__/lib/validations/job-description.test.ts
git commit -m "feat(jobs): normalize JD name casing on save"
```

---

### Task 3: `TARGET_MATCH_SCORE` constant shared with the score badge

**Files:**
- Create: `src/lib/jobs/constants.ts`
- Modify: `src/components/jobs/score-badge.tsx:16-23`

- [ ] **Step 1: Create the constant**

`src/lib/jobs/constants.ts`:

```ts
/**
 * LLM score from which a candidate counts as "on target" for an analysis.
 * It is also the lower bound of the light-green band in `ScoreBadge`, so the
 * dashboard KPI and the colors operators see can never diverge.
 */
export const TARGET_MATCH_SCORE = 80;
```

- [ ] **Step 2: Use it in `score-badge.tsx`** — add the import at the top and replace the `< 80` boundary:

```ts
import { TARGET_MATCH_SCORE } from "@/lib/jobs/constants";
```

```ts
function fillColorClass(value: number): string {
  if (value < 50) return "bg-gray-400";
  if (value < 60) return "bg-red-500";
  if (value < 70) return "bg-orange-500";
  if (value < TARGET_MATCH_SCORE) return "bg-yellow-400";
  if (value < 90) return "bg-emerald-400";
  return "bg-emerald-600";
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit -p . 2>&1 | grep -E "score-badge|constants" || echo OK`
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/jobs/constants.ts src/components/jobs/score-badge.tsx
git commit -m "refactor(jobs): share target match score threshold"
```

---

### Task 4: `JobMatch` model and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261003120000_add_job_match/migration.sql`

- [ ] **Step 1: Add the model** — append after `model CandidateStatus { … }` in `prisma/schema.prisma`:

```prisma
// Snapshot of the last fresh AI evaluation of a JD: one row per candidate the
// LLM scored. Replaced wholesale on every recompute (see lib/jobs/match-snapshot).
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

- [ ] **Step 2: Add back-relations**

In `model Organization`, after `candidateStatuses CandidateStatus[]`:
```prisma
  jobMatches        JobMatch[]
```
In `model JobDescription`, after the `createdBy` relation line:
```prisma
  jobMatches   JobMatch[]
```
In `model Candidate`, after `statuses        CandidateStatus[]`:
```prisma
  jobMatches      JobMatch[]
```

Do **not** run `prisma format` (reflows the whole file).

- [ ] **Step 3: Hand-author the migration** (no DB in the worktree; also avoids the spurious HNSW `DROP INDEX` that `migrate dev` injects)

`prisma/migrations/20261003120000_add_job_match/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "JobMatch" (
    "jobDescriptionId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "llmScore" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobMatch_pkey" PRIMARY KEY ("jobDescriptionId","candidateId")
);

-- CreateIndex
CREATE INDEX "JobMatch_organizationId_llmScore_idx" ON "JobMatch"("organizationId", "llmScore");

-- CreateIndex
CREATE INDEX "JobMatch_organizationId_candidateId_idx" ON "JobMatch"("organizationId", "candidateId");

-- AddForeignKey
ALTER TABLE "JobMatch" ADD CONSTRAINT "JobMatch_jobDescriptionId_fkey" FOREIGN KEY ("jobDescriptionId") REFERENCES "JobDescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMatch" ADD CONSTRAINT "JobMatch_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMatch" ADD CONSTRAINT "JobMatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: Regenerate the client**

Run: `pnpm exec prisma generate`
Expected: "Generated Prisma Client". Then `pnpm exec tsc --noEmit -p . 2>&1 | head -5` shows no new errors.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261003120000_add_job_match/migration.sql
git commit -m "feat(db): add JobMatch snapshot table"
```

---

### Task 5: `replaceJobMatchSnapshot`

**Files:**
- Create: `src/lib/jobs/match-snapshot.ts`
- Test: `src/__tests__/lib/jobs/match-snapshot.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    jobMatch: {
      deleteMany: vi.fn((args: unknown) => ({ op: "deleteMany", args })),
      createMany: vi.fn((args: unknown) => ({ op: "createMany", args })),
    },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

import { replaceJobMatchSnapshot } from "@/lib/jobs/match-snapshot";

beforeEach(() => vi.clearAllMocks());

describe("replaceJobMatchSnapshot", () => {
  it("deletes the JD rows and inserts the new entries in one transaction", async () => {
    await replaceJobMatchSnapshot({
      jobDescriptionId: "jd-1",
      organizationId: "org-1",
      entries: [
        { candidateId: "c1", llmScore: 91 },
        { candidateId: "c2", llmScore: 64 },
      ],
    });

    expect(mockPrisma.jobMatch.deleteMany).toHaveBeenCalledWith({
      where: { jobDescriptionId: "jd-1", organizationId: "org-1" },
    });
    expect(mockPrisma.jobMatch.createMany).toHaveBeenCalledWith({
      data: [
        { jobDescriptionId: "jd-1", organizationId: "org-1", candidateId: "c1", llmScore: 91 },
        { jobDescriptionId: "jd-1", organizationId: "org-1", candidateId: "c2", llmScore: 64 },
      ],
    });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    const ops = mockPrisma.$transaction.mock.calls[0]![0] as Array<{ op: string }>;
    expect(ops.map((o) => o.op)).toEqual(["deleteMany", "createMany"]);
  });

  it("only deletes when there are no entries", async () => {
    await replaceJobMatchSnapshot({ jobDescriptionId: "jd-1", organizationId: "org-1", entries: [] });
    expect(mockPrisma.jobMatch.createMany).not.toHaveBeenCalled();
    const ops = mockPrisma.$transaction.mock.calls[0]![0] as Array<{ op: string }>;
    expect(ops.map((o) => o.op)).toEqual(["deleteMany"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/__tests__/lib/jobs/match-snapshot.test.ts`
Expected: FAIL — cannot resolve `@/lib/jobs/match-snapshot`.

- [ ] **Step 3: Implement**

`src/lib/jobs/match-snapshot.ts`:

```ts
import { prisma } from "@/lib/db";

export interface JobMatchSnapshotEntry {
  candidateId: string;
  llmScore: number;
}

/**
 * Replace the stored AI evaluation of a JD with a fresh one: delete every
 * existing row of the JD, then insert `entries`, atomically. An empty
 * `entries` clears the snapshot (no candidate reached the AI evaluation).
 */
export async function replaceJobMatchSnapshot(params: {
  jobDescriptionId: string;
  organizationId: string;
  entries: JobMatchSnapshotEntry[];
}): Promise<void> {
  const { jobDescriptionId, organizationId, entries } = params;
  const remove = prisma.jobMatch.deleteMany({ where: { jobDescriptionId, organizationId } });
  if (entries.length === 0) {
    await prisma.$transaction([remove]);
    return;
  }
  await prisma.$transaction([
    remove,
    prisma.jobMatch.createMany({
      data: entries.map((e) => ({
        jobDescriptionId,
        organizationId,
        candidateId: e.candidateId,
        llmScore: e.llmScore,
      })),
    }),
  ]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/__tests__/lib/jobs/match-snapshot.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/match-snapshot.ts src/__tests__/lib/jobs/match-snapshot.test.ts
git commit -m "feat(jobs): add job match snapshot writer"
```

---

### Task 6: `rerankCandidates` reports cache hits

**Files:**
- Modify: `src/lib/llm/rerank.ts:137-188`
- Test: `src/__tests__/lib/llm/rerank.test.ts`

- [ ] **Step 1: Update the tests to the new return shape and add `fromCache` assertions**

In `src/__tests__/lib/llm/rerank.test.ts`:

1. In "returns enrichments parsed from a well-formed Mistral response", replace the three lines after the call with:
```ts
    const { enrichments: out, fromCache } = await rerankCandidates("jd-1", baseInput);
    expect(fromCache).toBe(false);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ candidateId: "c1", score: 85, summary: "ok" });
    expect(out[1]).toMatchObject({ candidateId: "c2", score: 30, redFlags: ["off-topic"] });
```
(and delete the original `const out = …` line).

2. In "clamps scores into 0-100 …", replace `const out = await rerankCandidates("jd-1", baseInput);` with:
```ts
    const { enrichments: out } = await rerankCandidates("jd-1", baseInput);
```

3. Replace the whole "returns [] without calling the LLM when candidates is empty" test with:
```ts
  it("returns no enrichments without calling the LLM when candidates is empty", async () => {
    const out = await rerankCandidates("jd-1", { ...baseInput, candidates: [] });
    expect(out).toEqual({ enrichments: [], fromCache: false });
    expect(chatCompletion).not.toHaveBeenCalled();
  });
```

4. In "caches results so a second call within the TTL does not hit the LLM", replace the two calls with:
```ts
    const first = await rerankCandidates("jd-1", baseInput);
    const second = await rerankCandidates("jd-1", baseInput);
    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(second.enrichments).toEqual(first.enrichments);
```
(keep the existing `expect(chatCompletion).toHaveBeenCalledTimes(1);`).

5. Add a new test at the end of the `describe`:
```ts
  it("misses the cache again after invalidateRerankCacheForJd", async () => {
    vi.mocked(chatCompletion).mockResolvedValue(
      JSON.stringify({
        results: [
          { candidateId: "c1", score: 85, summary: "", matchedSkills: [], missingSkills: [], redFlags: [] },
          { candidateId: "c2", score: 30, summary: "", matchedSkills: [], missingSkills: [], redFlags: [] },
        ],
      }),
    );
    await rerankCandidates("jd-1", baseInput);
    await rerankCandidates("jd-2", baseInput);
    await invalidateRerankCacheForJd("jd-1");
    expect((await rerankCandidates("jd-1", baseInput)).fromCache).toBe(false);
    expect((await rerankCandidates("jd-2", baseInput)).fromCache).toBe(true);
  });
```
and extend the import: `import { rerankCandidates, invalidateRerankCacheForJd, _clearRerankCache } from "@/lib/llm/rerank";`

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/__tests__/lib/llm/rerank.test.ts`
Expected: FAIL — `fromCache` undefined / destructuring of array.

- [ ] **Step 3: Implement** — in `src/lib/llm/rerank.ts`:

Add after the `CandidateEnrichment` interface:
```ts
export interface RerankResult {
  enrichments: CandidateEnrichment[];
  /** True when served from the rerank cache (no LLM call was made). */
  fromCache: boolean;
}
```

Update the cache comment (it mentions the old button) to:
```ts
// Cache: key = `llm:rerank:{jdId}:{candidate ids signature}`, value =
// enrichments. Default TTL is 24h, tunable via LLM_RERANK_CACHE_TTL_MS. The
// "Ricalcola" button on the JD page and JD edits invalidate the cache for
// that JD only.
```

Delete the `clearRerankCache` function (its only caller is replaced in Task 8).

Replace `rerankCandidates` with:
```ts
export async function rerankCandidates(
  jdId: string,
  input: RerankInput,
): Promise<RerankResult> {
  if (input.candidates.length === 0) return { enrichments: [], fromCache: false };

  const store = getCacheStore();
  const key = cacheKey(jdId, input.candidates);
  const cached = await store.get<CandidateEnrichment[]>(key);
  if (cached) return { enrichments: cached, fromCache: true };

  const content = await chatCompletion({
    model: "mistral-small-latest",
    temperature: 0.2,
    jsonResponse: true,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserMessage(input) },
    ],
  });

  const enrichments = parseRerankResponse(content);
  await store.set(key, enrichments, cacheTtlMs());
  return { enrichments, fromCache: false };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/__tests__/lib/llm/rerank.test.ts`
Expected: PASS. (`tsc` will now report errors in `jobs/[id]/page.tsx` and `jobs/[id]/actions.ts` — fixed in Tasks 7 and 8; do not commit a broken typecheck alone, continue straight to Task 7.)

- [ ] **Step 5: Commit** (together with Task 7, see there)

---

### Task 7: Write the snapshot from the JD detail page

**Files:**
- Modify: `src/app/(dashboard)/dashboard/jobs/[id]/page.tsx`

No unit test (async Server Component); covered by Task 5/6 tests + manual check in Task 13.

- [ ] **Step 1: Add the import** next to the other `@/lib/jobs` imports:

```ts
import { replaceJobMatchSnapshot, type JobMatchSnapshotEntry } from "@/lib/jobs/match-snapshot";
```

- [ ] **Step 2: Add a helper** above `async function Matches(`:

```ts
/**
 * Persist the fresh AI evaluation for the jobs dashboard. Never throws: a
 * snapshot failure must not break the matches page.
 */
async function persistMatchSnapshot(
  jobDescriptionId: string,
  organizationId: string,
  entries: JobMatchSnapshotEntry[],
): Promise<void> {
  try {
    await replaceJobMatchSnapshot({ jobDescriptionId, organizationId, entries });
  } catch (e) {
    console.error("[jobs/[id]] snapshot write failed", e);
  }
}
```

- [ ] **Step 3: Clear the snapshot in the no-affinity branch** — replace:

```ts
  if (toRerank.length === 0) {
    return (
```
with:
```ts
  if (toRerank.length === 0) {
    await persistMatchSnapshot(jd.id, orgId, []);
    return (
```

- [ ] **Step 4: Use the new rerank result and write on cache miss** — replace the body of the second `try { … }` (the one calling `rerankCandidates`) with:

```ts
  try {
    const { enrichments, fromCache } = await rerankCandidates(jd.id, {
      jd: {
        name: jd.name,
        description: jd.description,
        skills: jd.skills,
        locationMunicipality: jd.locationMunicipality,
      },
      candidates: toRerank.map((r) => r.candidate),
    });
    const byId = new Map(enrichments.map((e) => [e.candidateId, e]));
    enriched = toRerank.flatMap((r) => {
      const enrichment = byId.get(r.candidate.id);
      return enrichment ? [{ ...r, llm: enrichment }] : [];
    });
    enriched.sort((a, b) => (b.llm?.score ?? -1) - (a.llm?.score ?? -1));
    if (!fromCache) {
      // Built from `enriched` (not raw `enrichments`): only candidates we sent,
      // each once — the LLM could echo unknown or duplicate ids.
      await persistMatchSnapshot(
        jd.id,
        orgId,
        enriched.flatMap((r) => (r.llm ? [{ candidateId: r.candidate.id, llmScore: r.llm.score }] : [])),
      );
    }
  } catch (e) {
```
(the `catch` block stays as is).

- [ ] **Step 5: Typecheck the page**

Run: `pnpm exec tsc --noEmit -p . 2>&1 | grep "jobs/\[id\]/page" || echo OK`
Expected: `OK` (an error remains in `actions.ts` until Task 8).

- [ ] **Step 6: Commit Tasks 6 + 7**

```bash
git add src/lib/llm/rerank.ts src/__tests__/lib/llm/rerank.test.ts "src/app/(dashboard)/dashboard/jobs/[id]/page.tsx"
git commit -m "feat(jobs): persist match snapshot on fresh rerank"
```

---

### Task 8: Scope "Ricalcola" to a single JD

**Files:**
- Modify: `src/app/(dashboard)/dashboard/jobs/[id]/actions.ts:14,122-126`
- Modify: `src/components/jobs/matches-section.tsx`
- Modify: `src/app/(dashboard)/dashboard/jobs/[id]/page.tsx` (pass `jdId`)
- Test: `src/__tests__/app/dashboard/jobs/refresh-action.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const ORG = "00000000-0000-0000-0000-0000000000b1";
const JD = "3f1c2b7e-8a4d-4c6e-9b2a-1d5e7f9a0c3b";

const { mockUser } = vi.hoisted(() => ({
  mockUser: { value: { id: "u1", role: "ORG_ADMIN", organizationId: "00000000-0000-0000-0000-0000000000b1" } as
    | { id: string; role: string; organizationId: string }
    | null },
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
  })),
}));
vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique: vi.fn(async () => mockUser.value) } },
}));
vi.mock("@/lib/jobs/service", () => ({
  getJobDescription: vi.fn(),
  updateJobDescription: vi.fn(),
  deleteJobDescription: vi.fn(),
  JobNameAlreadyExistsError: class extends Error {},
  JobNotFoundError: class extends Error {},
}));
vi.mock("@/lib/llm/rerank", () => ({ invalidateRerankCacheForJd: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/i18n/locale", () => ({ getServerLocale: vi.fn(async () => "it") }));

import { getJobDescription } from "@/lib/jobs/service";
import { invalidateRerankCacheForJd } from "@/lib/llm/rerank";
import { revalidatePath } from "next/cache";
import { refreshCandidatesForJob } from "@/app/(dashboard)/dashboard/jobs/[id]/actions";

beforeEach(() => {
  vi.clearAllMocks();
  mockUser.value = { id: "u1", role: "ORG_ADMIN", organizationId: ORG };
});

describe("refreshCandidatesForJob", () => {
  it("invalidates only the given JD of the user's org", async () => {
    vi.mocked(getJobDescription).mockResolvedValue({ id: JD } as never);
    await refreshCandidatesForJob(JD);
    expect(getJobDescription).toHaveBeenCalledWith({ id: JD, organizationId: ORG });
    expect(invalidateRerankCacheForJd).toHaveBeenCalledWith(JD);
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/jobs/${JD}`);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/jobs");
  });

  it("does nothing for a JD outside the user's org", async () => {
    vi.mocked(getJobDescription).mockResolvedValue(null);
    await refreshCandidatesForJob(JD);
    expect(invalidateRerankCacheForJd).not.toHaveBeenCalled();
  });

  it("does nothing for a non-admin", async () => {
    mockUser.value = { id: "u1", role: "ORG_MEMBER", organizationId: ORG };
    await refreshCandidatesForJob(JD);
    expect(getJobDescription).not.toHaveBeenCalled();
    expect(invalidateRerankCacheForJd).not.toHaveBeenCalled();
  });

  it("does nothing for a malformed id", async () => {
    await refreshCandidatesForJob("not-a-uuid");
    expect(getJobDescription).not.toHaveBeenCalled();
    expect(invalidateRerankCacheForJd).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/__tests__/app/dashboard/jobs/refresh-action.test.ts`
Expected: FAIL — `getJobDescription` not called / `invalidateRerankCacheForJd` not called with `JD`.

- [ ] **Step 3: Implement the action** — in `actions.ts`:

Replace the rerank import line with:
```ts
import { invalidateRerankCacheForJd } from "@/lib/llm/rerank";
```
Add `getJobDescription` to the existing `@/lib/jobs/service` import list, and add:
```ts
import { z } from "zod/v4";
```
Replace `refreshCandidatesForJob` with:
```ts
export async function refreshCandidatesForJob(jdId: string): Promise<void> {
  if (!z.uuid().safeParse(jdId).success) return;
  const ctx = await requireAdmin();
  if (!ctx) return;
  const jd = await getJobDescription({ id: jdId, organizationId: ctx.organizationId });
  if (!jd) return;
  await invalidateRerankCacheForJd(jdId);
  revalidatePath(`/dashboard/jobs/${jdId}`);
  revalidatePath("/dashboard/jobs");
}
```

- [ ] **Step 4: Pass `jdId` through `MatchesSection`** — in `src/components/jobs/matches-section.tsx`:

```ts
interface MatchesSectionProps {
  /** JD whose matches are recalculated by the refresh button. */
  jdId: string;
  /** Server-rendered matches (inside their own Suspense boundary). */
  children: ReactNode;
}
```
```ts
export function MatchesSection({ jdId, children }: MatchesSectionProps) {
```
```ts
      await refreshCandidatesForJob(jdId);
```

In `jobs/[id]/page.tsx` replace `<MatchesSection>` with `<MatchesSection jdId={jd.id}>`.

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm vitest run src/__tests__/app/dashboard/jobs/refresh-action.test.ts && pnpm exec tsc --noEmit -p .`
Expected: test PASS; `tsc` exits 0.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/dashboard/jobs/[id]/actions.ts" "src/app/(dashboard)/dashboard/jobs/[id]/page.tsx" src/components/jobs/matches-section.tsx src/__tests__/app/dashboard/jobs/refresh-action.test.ts
git commit -m "fix(jobs): scope match refresh to a single analysis"
```

---

### Task 9: `getJobsDashboardMetrics`

**Files:**
- Create: `src/lib/jobs/dashboard-metrics.ts`
- Test: `src/__tests__/lib/jobs/dashboard-metrics.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    jobDescription: { count: vi.fn() },
    candidate: { count: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/pools/access", () => ({
  getOrgAccessiblePoolIds: vi.fn(async () => ["p1", "p2"]),
}));

import { getJobsDashboardMetrics } from "@/lib/jobs/dashboard-metrics";

const VISIBILITY = { OR: [{ poolId: { in: ["p1", "p2"] } }, { sharedWithGlobal: true }] };
const NOW = new Date("2026-10-03T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.jobDescription.count.mockResolvedValueOnce(12).mockResolvedValueOnce(3);
  mockPrisma.candidate.count
    .mockResolvedValueOnce(87)
    .mockResolvedValueOnce(312)
    .mockResolvedValueOnce(1240);
});

describe("getJobsDashboardMetrics", () => {
  it("returns the five counts", async () => {
    const m = await getJobsDashboardMetrics("org-1", NOW);
    expect(m).toEqual({
      activeJobs: 12,
      jobsLast30Days: 3,
      targetCandidates: 87,
      neverMatchedCandidates: 312,
      totalCandidates: 1240,
    });
  });

  it("scopes JD counts by org and uses a 30-day window", async () => {
    await getJobsDashboardMetrics("org-1", NOW);
    expect(mockPrisma.jobDescription.count).toHaveBeenNthCalledWith(1, {
      where: { organizationId: "org-1" },
    });
    expect(mockPrisma.jobDescription.count).toHaveBeenNthCalledWith(2, {
      where: { organizationId: "org-1", createdAt: { gte: new Date("2026-09-03T12:00:00.000Z") } },
    });
  });

  it("counts target candidates with score >= 80 in the org, within visibility", async () => {
    await getJobsDashboardMetrics("org-1", NOW);
    expect(mockPrisma.candidate.count).toHaveBeenNthCalledWith(1, {
      where: { ...VISIBILITY, jobMatches: { some: { organizationId: "org-1", llmScore: { gte: 80 } } } },
    });
  });

  it("counts never-matched and total candidates within visibility", async () => {
    await getJobsDashboardMetrics("org-1", NOW);
    expect(mockPrisma.candidate.count).toHaveBeenNthCalledWith(2, {
      where: { ...VISIBILITY, jobMatches: { none: { organizationId: "org-1" } } },
    });
    expect(mockPrisma.candidate.count).toHaveBeenNthCalledWith(3, { where: VISIBILITY });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/__tests__/lib/jobs/dashboard-metrics.test.ts`
Expected: FAIL — cannot resolve `@/lib/jobs/dashboard-metrics`.

- [ ] **Step 3: Implement**

`src/lib/jobs/dashboard-metrics.ts`:

```ts
import { prisma } from "@/lib/db";
import { getOrgAccessiblePoolIds } from "@/lib/pools/access";
import { candidateVisibilityWhere } from "@/lib/pools/candidate-visibility";
import { TARGET_MATCH_SCORE } from "@/lib/jobs/constants";

const RECENT_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface JobsDashboardMetrics {
  activeJobs: number;
  jobsLast30Days: number;
  /** Unique visible candidates scoring >= TARGET_MATCH_SCORE in at least one JD. */
  targetCandidates: number;
  /** Visible candidates never evaluated by the AI in any JD of the org. */
  neverMatchedCandidates: number;
  totalCandidates: number;
}

/**
 * KPIs for the jobs dashboard, read from the `JobMatch` snapshots. Candidate
 * counts go through the org's visibility filter, so a candidate the org can no
 * longer see drops out even if snapshot rows remain.
 */
export async function getJobsDashboardMetrics(
  organizationId: string,
  now: Date = new Date(),
): Promise<JobsDashboardMetrics> {
  const visibility = candidateVisibilityWhere(await getOrgAccessiblePoolIds(organizationId));
  const since = new Date(now.getTime() - RECENT_WINDOW_DAYS * DAY_MS);

  const [activeJobs, jobsLast30Days, targetCandidates, neverMatchedCandidates, totalCandidates] =
    await Promise.all([
      prisma.jobDescription.count({ where: { organizationId } }),
      prisma.jobDescription.count({ where: { organizationId, createdAt: { gte: since } } }),
      prisma.candidate.count({
        where: {
          ...visibility,
          jobMatches: { some: { organizationId, llmScore: { gte: TARGET_MATCH_SCORE } } },
        },
      }),
      prisma.candidate.count({
        where: { ...visibility, jobMatches: { none: { organizationId } } },
      }),
      prisma.candidate.count({ where: visibility }),
    ]);

  return { activeJobs, jobsLast30Days, targetCandidates, neverMatchedCandidates, totalCandidates };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/__tests__/lib/jobs/dashboard-metrics.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/dashboard-metrics.ts src/__tests__/lib/jobs/dashboard-metrics.test.ts
git commit -m "feat(jobs): add jobs dashboard metrics service"
```

---

### Task 10: i18n keys

**Files:**
- Modify: `src/lib/i18n/dictionaries/it.ts` (inside `jobs: { … }`, after `updatingButton`)
- Modify: `src/lib/i18n/dictionaries/en.ts` (same position)

- [ ] **Step 1: Add the Italian keys** after `updatingButton: "Salvataggio…",`:

```ts
    dashboard: {
      activeJobs: "Analisi attive",
      activeJobsHint: "+{count} negli ultimi 30 giorni",
      targetCandidates: "Candidati a target",
      targetCandidatesHint: "Score ≥ {score} in almeno un'analisi",
      neverMatched: "Mai passati da un matching",
      neverMatchedHint: "su {total} candidati totali",
      notPopulated: "I dati si popolano quando apri o ricalcoli un'analisi.",
      loadError: "Impossibile caricare le metriche. Riprova più tardi.",
    },
```

- [ ] **Step 2: Add the English keys** after `updatingButton: "Saving…",`:

```ts
    dashboard: {
      activeJobs: "Active analyses",
      activeJobsHint: "+{count} in the last 30 days",
      targetCandidates: "Target candidates",
      targetCandidatesHint: "Score ≥ {score} in at least one analysis",
      neverMatched: "Never matched",
      neverMatchedHint: "out of {total} candidates",
      notPopulated: "Data fills in as you open or recalculate an analysis.",
      loadError: "Unable to load metrics. Please try again later.",
    },
```

(The UI button label is "Ricalcola"/`refreshMatches`, so the note says "ricalcoli", not "rigeneri".)

- [ ] **Step 3: Run the i18n parity test + typecheck**

Run: `pnpm vitest run src/lib/i18n/__tests__/index.test.ts && pnpm exec tsc --noEmit -p .`
Expected: parity test PASS; `tsc` exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/i18n/dictionaries/it.ts src/lib/i18n/dictionaries/en.ts
git commit -m "feat(i18n): add jobs dashboard strings"
```

---

### Task 11: Dashboard UI on `/dashboard/jobs`

**Files:**
- Modify: `src/components/stats/stat-card.tsx`
- Create: `src/components/jobs/jobs-dashboard.tsx`
- Modify: `src/app/(dashboard)/dashboard/jobs/page.tsx`

- [ ] **Step 1: Let `StatCard` accept a formatted value** — in `stat-card.tsx` change the prop type:

```ts
  /** A number, or a string already formatted for the active locale. */
  value: number | string;
```

- [ ] **Step 2: Create `src/components/jobs/jobs-dashboard.tsx`**

```tsx
import { Briefcase, Target, UserX } from "lucide-react";
import type { Dictionary, Locale } from "@/lib/i18n/types";
import { getJobsDashboardMetrics } from "@/lib/jobs/dashboard-metrics";
import { TARGET_MATCH_SCORE } from "@/lib/jobs/constants";
import { StatCard } from "@/components/stats/stat-card";
import { Skeleton } from "@/components/ui/skeleton";

interface JobsDashboardProps {
  organizationId: string;
  t: Dictionary;
  locale: Locale;
}

/** KPI cards above the analyses table. Rendered inside a Suspense boundary. */
export async function JobsDashboard({ organizationId, t, locale }: JobsDashboardProps) {
  let metrics;
  try {
    metrics = await getJobsDashboardMetrics(organizationId);
  } catch (e) {
    console.error("[jobs] dashboard metrics failed", e);
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {t.jobs.dashboard.loadError}
      </div>
    );
  }

  const fmt = new Intl.NumberFormat(locale === "it" ? "it-IT" : "en-GB");
  const d = t.jobs.dashboard;
  // Right after release no JD has been recalculated yet: every candidate is
  // "never matched". Explain it instead of showing a bare zero.
  const notPopulated =
    metrics.activeJobs > 0 && metrics.neverMatchedCandidates === metrics.totalCandidates;

  return (
    <div className="space-y-2">
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title={d.activeJobs}
          value={fmt.format(metrics.activeJobs)}
          description={d.activeJobsHint.replace("{count}", fmt.format(metrics.jobsLast30Days))}
          icon={Briefcase}
        />
        <StatCard
          title={d.targetCandidates}
          value={fmt.format(metrics.targetCandidates)}
          description={d.targetCandidatesHint.replace("{score}", String(TARGET_MATCH_SCORE))}
          icon={Target}
          iconClassName="bg-emerald-100 text-emerald-800"
        />
        <StatCard
          title={d.neverMatched}
          value={fmt.format(metrics.neverMatchedCandidates)}
          description={d.neverMatchedHint.replace("{total}", fmt.format(metrics.totalCandidates))}
          icon={UserX}
          iconClassName="bg-muted text-muted-foreground"
        />
      </div>
      {notPopulated && <p className="text-xs text-muted-foreground">{d.notPopulated}</p>}
    </div>
  );
}

/** Suspense fallback matching the three-card layout. */
export function JobsDashboardSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-[118px] rounded-xl" />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Render it on the jobs page** — in `src/app/(dashboard)/dashboard/jobs/page.tsx`:

Add imports:
```ts
import { Suspense } from "react";
import { JobsDashboard, JobsDashboardSkeleton } from "@/components/jobs/jobs-dashboard";
```
Replace the first line of the component body:
```ts
  const locale = await getServerLocale();
  const t = getDictionary(locale);
```
Insert right after the closing `</div>` of the title row (`<h1 …>{t.pages.jobs}</h1>` wrapper):
```tsx
      {jobs.length > 0 && (
        <Suspense fallback={<JobsDashboardSkeleton />}>
          <JobsDashboard organizationId={currentUser.organizationId} t={t} locale={locale} />
        </Suspense>
      )}
```

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm exec tsc --noEmit -p . && pnpm lint`
Expected: both exit 0 (no new warnings in the touched files).

- [ ] **Step 5: Commit**

```bash
git add src/components/stats/stat-card.tsx src/components/jobs/jobs-dashboard.tsx "src/app/(dashboard)/dashboard/jobs/page.tsx"
git commit -m "feat(jobs): show KPI dashboard on the analyses page"
```

---

### Task 12: Backfill script for existing JD names

**Files:**
- Modify: `src/lib/jobs/service.ts:165-184` (export + boolean return)
- Create: `scripts/normalize-job-names.ts`

- [ ] **Step 1: Export `syncJobDescriptionEmbedding` and report success** — in `src/lib/jobs/service.ts` replace the function with:

```ts
/** Regenerate and store the JD embedding. Returns false on failure (logged). */
export async function syncJobDescriptionEmbedding(id: string, input: {
  name: string;
  description: string;
  skills: string[];
}): Promise<boolean> {
  const text = buildJobDescriptionEmbeddingText(input);
  if (text.length === 0) return false;
  try {
    const vector = await generateEmbedding(text);
    await prisma.$executeRaw`
      UPDATE "JobDescription"
      SET "embedding" = ${vectorToPgLiteral(vector)}::vector,
          "embeddingText" = ${text},
          "embeddingUpdatedAt" = now()
      WHERE id = ${id}::uuid
    `;
    return true;
  } catch (e) {
    console.error("[jobs] embedding failed", { jobDescriptionId: id, error: e });
    return false;
  }
}
```

Run: `pnpm vitest run src/__tests__/lib/jobs/service.test.ts`
Expected: PASS (existing callers ignore the return value).

- [ ] **Step 2: Create `scripts/normalize-job-names.ts`**

```ts
/**
 * One-off backfill: normalize JobDescription.name casing (see
 * lib/jobs/normalize-name) and re-embed renamed JDs, since the name is part
 * of the embedding text. Names that would collide with another JD of the same
 * org are skipped and reported.
 *
 * Run: set -a && source .env.local && set +a && pnpm tsx scripts/normalize-job-names.ts [--dry-run]
 *
 * Idempotent. Safe to re-run.
 */
import { prisma } from "@/lib/db";
import { planJobNameRenames } from "@/lib/jobs/normalize-name";
import { syncJobDescriptionEmbedding } from "@/lib/jobs/service";

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code: unknown }).code === "P2002";
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const rows = await prisma.jobDescription.findMany({
    select: { id: true, organizationId: true, name: true, description: true, skills: true },
  });
  const plan = planJobNameRenames(rows);
  const byId = new Map(rows.map((r) => [r.id, r]));

  for (const c of plan.collisions) {
    console.warn(`[collision] org=${c.organizationId} jd=${c.id} "${c.from}" -> "${c.to}" (skipped)`);
  }

  let renamed = 0;
  let raceCollisions = 0;
  let embeddingErrors = 0;

  for (const r of plan.renames) {
    console.log(`[rename] org=${r.organizationId} jd=${r.id} "${r.from}" -> "${r.to}"`);
    if (dryRun) continue;
    const row = byId.get(r.id);
    if (!row) continue;
    try {
      await prisma.jobDescription.update({ where: { id: r.id }, data: { name: r.to } });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      raceCollisions++;
      console.warn(`[collision] jd=${r.id} "${r.to}" taken meanwhile (skipped)`);
      continue;
    }
    renamed++;
    const ok = await syncJobDescriptionEmbedding(r.id, {
      name: r.to,
      description: row.description,
      skills: row.skills,
    });
    if (!ok) embeddingErrors++;
  }

  console.log(
    [
      dryRun ? "DRY RUN — nothing written." : "Done.",
      `to rename: ${plan.renames.length}`,
      `renamed: ${renamed}`,
      `unchanged: ${plan.unchanged}`,
      `skipped (collision): ${plan.collisions.length + raceCollisions}`,
      `embedding errors: ${embeddingErrors}`,
    ].join("\n"),
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

(Embedding failures leave the old vector in place; the nightly cron only regenerates `embedding IS NULL`, so re-run the script — it is idempotent for names — or `backfill-embeddings.ts --target=jobs --force` if errors are reported.)

- [ ] **Step 3: Typecheck the script**

Run: `pnpm exec tsc --noEmit -p . 2>&1 | grep normalize-job-names || echo OK`
Expected: `OK` (`tsconfig.json` includes `**/*.ts`, so `scripts/` is typechecked). The script itself needs a DB to run; its logic is covered by the `planJobNameRenames` tests in Task 1.

- [ ] **Step 4: Commit**

```bash
git add src/lib/jobs/service.ts scripts/normalize-job-names.ts
git commit -m "feat(scripts): backfill normalized JD names"
```

---

### Task 13: Full verification

- [ ] **Step 1: Whole test suite**

Run: `pnpm test 2>&1 | tail -30`
Expected: only the pre-existing `DATABASE_URL` failures recorded in Task 0; every test file touched by this plan passes.

- [ ] **Step 2: Typecheck, lint, build**

Run: `pnpm exec tsc --noEmit -p . && pnpm lint && pnpm build`
Expected: all succeed. (`build` may need env vars; if it fails only on missing env at page-data collection, note it and rely on `tsc` + `lint`.)

- [ ] **Step 3: Migration sanity check**

Run: `grep -c "DROP INDEX" prisma/migrations/20261003120000_add_job_match/migration.sql`
Expected: `0`.

- [ ] **Step 4: Manual check (needs a dev DB — do it in the main checkout with `.env.local`, or hand to the user)**

1. `cd apps/dashboard && pnpm exec prisma migrate deploy` against the dev DB.
2. `pnpm dev:dashboard`, open `/dashboard/jobs`: three cards and the "data fills in" note.
3. Open an analysis, press "Ricalcola", go back: "Candidati a target" / "Mai passati" change; the note disappears once any candidate has been evaluated.
4. Edit an analysis with name `OPERATORE OSS NOTTURNO` → saved as `Operatore oss notturno`; with `Operatore OSS Notturno` → `Operatore OSS notturno`.
5. `pnpm tsx scripts/normalize-job-names.ts --dry-run` lists renames/collisions.

---

## Rollout (post-merge checklist for the PR description)

1. Before merge: `cd apps/dashboard && set -a && source .env.prod && set +a && pnpm exec prisma migrate deploy`, then `migrate status`.
2. Merge → Vercel deploy.
3. `set -a && source .env.prod && set +a && pnpm tsx scripts/normalize-job-names.ts --dry-run`, review collisions, then run without `--dry-run`.
4. Open each existing analysis and press "Ricalcola" to populate the snapshot.
