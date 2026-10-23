# Candidate creation — PR 1: `ingestCandidate` refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the duplicated "upsert candidate + regenerate embedding" sequence from the two webhooks into one shared service, with no behavior change.

**Architecture:** New module `src/lib/candidates/ingest.ts` exposes `upsertCandidate` (accepts an optional Prisma transaction client), `refreshCandidateEmbedding` (best-effort, never throws) and `ingestCandidate` (both, in sequence). The Make and assessment webhook routes keep auth, Zod validation, pool resolution and payload mapping, and delegate the write to `ingestCandidate`. PR 2 reuses `upsertCandidate` inside a transaction and calls `refreshCandidateEmbedding` after commit.

**Tech Stack:** Next.js 16 route handlers, Prisma 7 (client generated in `src/generated/prisma`), pgvector via `$executeRaw`, vitest.

**Spec:** `docs/superpowers/specs/2026-10-23-candidate-creation-cv-import-design.md` (Rollout → PR 1)

---

## Conventions for every task

- All paths are relative to `apps/dashboard/` unless they start with `docs/` or `packages/`.
- Run tests from `apps/dashboard`: `pnpm exec vitest run <path>`.
- `vitest.setup.ts` refuses to run if `DATABASE_URL`/`DIRECT_URL` in `.env.local` point at a remote host. Every test in this plan mocks `@/lib/db`, so if the guard fires, run with the vars blanked (dotenv does not override already-set vars):
  `DATABASE_URL= DIRECT_URL= pnpm exec vitest run <path>`
- Branch: `refactor/ingest-candidate` off `main`.

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/candidates/ingest.ts` | Create | Upsert + embedding for any `Candidate` write path |
| `src/__tests__/lib/candidates/ingest.test.ts` | Create | Unit tests for the service |
| `src/app/api/webhooks/make/candidate/route.ts` | Modify | Delegate write to `ingestCandidate` |
| `src/app/api/webhooks/assessment/route.ts` | Modify | Delegate write to `ingestCandidate` |
| `src/__tests__/app/api/webhooks/make/candidate.test.ts` | Unchanged | Must stay green (safety net) |
| `src/__tests__/app/api/webhooks/assessment/route.test.ts` | Unchanged | Must stay green (safety net) |

---

### Task 1: Baseline — webhook tests are green before touching anything

**Files:** none

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull && git checkout -b refactor/ingest-candidate
```

- [ ] **Step 2: Run the two webhook suites**

Run: `cd apps/dashboard && pnpm exec vitest run src/__tests__/app/api/webhooks`
Expected: all tests PASS. Note the test count; it must be identical at the end of Task 4.

---

### Task 2: `ingest.ts` — failing tests

**Files:**
- Create: `src/__tests__/lib/candidates/ingest.test.ts`

- [ ] **Step 1: Write the tests**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    candidate: { upsert: vi.fn() },
    $executeRaw: vi.fn(),
  },
}));

vi.mock("@/lib/embeddings/client", () => ({
  generateEmbedding: vi.fn(),
  vectorToPgLiteral: (v: number[]) => `[${v.join(",")}]`,
}));

import { prisma } from "@/lib/db";
import { generateEmbedding } from "@/lib/embeddings/client";
import {
  ingestCandidate,
  refreshCandidateEmbedding,
  upsertCandidate,
} from "@/lib/candidates/ingest";

const POOL_ID = "00000000-0000-0000-0000-000000000001";

const DATA = {
  poolId: POOL_ID,
  externalId: "ext-1",
  firstName: "Ahmed",
  workExperience: ["Magazziniere"],
  rawPayload: { source: "test" },
};

const ROW = {
  id: "11111111-1111-1111-1111-111111111111",
  skillsAndCompetences: ["Muletto"],
  workExperience: ["Magazziniere"],
  educationAndTraining: [],
  desiredJob: "Magazziniere",
  jobConstraints: null,
};

const upsertMock = prisma.candidate.upsert as unknown as ReturnType<typeof vi.fn>;
const execMock = prisma.$executeRaw as unknown as ReturnType<typeof vi.fn>;
const embedMock = generateEmbedding as unknown as ReturnType<typeof vi.fn>;

describe("upsertCandidate", () => {
  beforeEach(() => vi.resetAllMocks());

  it("upserts on (poolId, externalId) with the same data for create and update", async () => {
    upsertMock.mockResolvedValueOnce(ROW);
    const row = await upsertCandidate(DATA);
    expect(row).toEqual(ROW);
    const arg = upsertMock.mock.calls[0]![0];
    expect(arg.where).toEqual({
      poolId_externalId: { poolId: POOL_ID, externalId: "ext-1" },
    });
    expect(arg.create).toEqual(DATA);
    expect(arg.update).toEqual(DATA);
    expect(arg.select).toMatchObject({ id: true, workExperience: true });
  });

  it("uses the transaction client when given one", async () => {
    const txUpsert = vi.fn().mockResolvedValueOnce(ROW);
    const tx = { candidate: { upsert: txUpsert } };
    await upsertCandidate(DATA, tx as never);
    expect(txUpsert).toHaveBeenCalledTimes(1);
    expect(upsertMock).not.toHaveBeenCalled();
  });
});

describe("refreshCandidateEmbedding", () => {
  beforeEach(() => vi.resetAllMocks());

  it("writes the embedding when there is text", async () => {
    embedMock.mockResolvedValueOnce([0.1, 0.2]);
    execMock.mockResolvedValueOnce(1);
    await refreshCandidateEmbedding(ROW, "test");
    expect(embedMock).toHaveBeenCalledTimes(1);
    expect(execMock).toHaveBeenCalledTimes(1);
  });

  it("skips when the embedding text is empty", async () => {
    await refreshCandidateEmbedding(
      { ...ROW, skillsAndCompetences: [], workExperience: [], desiredJob: null },
      "test",
    );
    expect(embedMock).not.toHaveBeenCalled();
  });

  it("logs and swallows embedding failures", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    embedMock.mockRejectedValueOnce(new Error("edge down"));
    await expect(refreshCandidateEmbedding(ROW, "my-tag")).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledWith(
      "[my-tag] embedding failed",
      expect.objectContaining({ candidateId: ROW.id }),
    );
    err.mockRestore();
  });
});

describe("ingestCandidate", () => {
  beforeEach(() => vi.resetAllMocks());

  it("upserts then refreshes the embedding and returns the id", async () => {
    upsertMock.mockResolvedValueOnce(ROW);
    embedMock.mockResolvedValueOnce([0.1]);
    execMock.mockResolvedValueOnce(1);
    const res = await ingestCandidate(DATA, "test");
    expect(res).toEqual({ candidateId: ROW.id });
    expect(embedMock).toHaveBeenCalledTimes(1);
  });

  it("propagates upsert failures", async () => {
    upsertMock.mockRejectedValueOnce(new Error("db down"));
    await expect(ingestCandidate(DATA, "test")).rejects.toThrow("db down");
  });
});
```

Note: `buildCandidateEmbeddingText` (real, not mocked) returns `""` when skills, experience, education, desiredJob and constraints are all empty — that is what the "skips" test relies on. Check `src/lib/embeddings/text.ts` if the test fails for that reason and adjust the fixture so every input it reads is empty.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/__tests__/lib/candidates/ingest.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/candidates/ingest"`.

---

### Task 3: `ingest.ts` — implementation

**Files:**
- Create: `src/lib/candidates/ingest.ts`

- [ ] **Step 1: Write the module**

```ts
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { generateEmbedding, vectorToPgLiteral } from "@/lib/embeddings/client";
import { buildCandidateEmbeddingText } from "@/lib/embeddings/text";

const EMBEDDING_SOURCE_SELECT = {
  id: true,
  skillsAndCompetences: true,
  workExperience: true,
  educationAndTraining: true,
  desiredJob: true,
  jobConstraints: true,
} as const;

export type CandidateEmbeddingSource = Prisma.CandidateGetPayload<{
  select: typeof EMBEDDING_SOURCE_SELECT;
}>;

/**
 * Upsert a candidate on (poolId, externalId). The single write primitive for
 * every Candidate ingestion path (Make webhook, assessment webhook, dashboard
 * creation, backfills). Pass `db` to run inside a transaction.
 */
export async function upsertCandidate(
  data: Prisma.CandidateUncheckedCreateInput,
  db: Prisma.TransactionClient = prisma,
): Promise<CandidateEmbeddingSource> {
  return db.candidate.upsert({
    where: {
      poolId_externalId: { poolId: data.poolId, externalId: data.externalId },
    },
    create: data,
    update: data,
    select: EMBEDDING_SOURCE_SELECT,
  });
}

/**
 * Regenerate the candidate's embedding. Best-effort: on failure it logs and
 * leaves `embedding` null for the nightly cron to retry. Never throws.
 * Call it after any surrounding transaction has committed.
 */
export async function refreshCandidateEmbedding(
  candidate: CandidateEmbeddingSource,
  logTag: string,
): Promise<void> {
  const embeddingText = buildCandidateEmbeddingText({
    skillsAndCompetences: candidate.skillsAndCompetences,
    workExperience: candidate.workExperience,
    educationAndTraining: candidate.educationAndTraining,
    desiredJob: candidate.desiredJob,
    jobConstraints: candidate.jobConstraints,
  });
  if (embeddingText.length === 0) return;

  try {
    const vector = await generateEmbedding(embeddingText);
    await prisma.$executeRaw`
      UPDATE "Candidate"
      SET "embedding" = ${vectorToPgLiteral(vector)}::vector,
          "embeddingText" = ${embeddingText},
          "embeddingUpdatedAt" = now()
      WHERE id = ${candidate.id}::uuid
    `;
  } catch (e) {
    console.error(`[${logTag}] embedding failed`, {
      candidateId: candidate.id,
      error: e,
    });
  }
}

/** Upsert + embedding. Throws only if the upsert fails. */
export async function ingestCandidate(
  data: Prisma.CandidateUncheckedCreateInput,
  logTag: string,
): Promise<{ candidateId: string }> {
  const candidate = await upsertCandidate(data);
  await refreshCandidateEmbedding(candidate, logTag);
  return { candidateId: candidate.id };
}
```

- [ ] **Step 2: Run the tests**

Run: `pnpm exec vitest run src/__tests__/lib/candidates/ingest.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 3: Commit**

```bash
git add src/lib/candidates/ingest.ts src/__tests__/lib/candidates/ingest.test.ts
git commit -m "refactor(candidates): add shared ingestCandidate service"
```

---

### Task 4: Webhooks delegate to `ingestCandidate`

**Files:**
- Modify: `src/app/api/webhooks/make/candidate/route.ts`
- Modify: `src/app/api/webhooks/assessment/route.ts`

- [ ] **Step 1: Make webhook — replace the upsert/embedding block**

In `src/app/api/webhooks/make/candidate/route.ts`:

Replace the imports

```ts
import { prisma } from "@/lib/db";
```
```ts
import { generateEmbedding, vectorToPgLiteral } from "@/lib/embeddings/client";
import { buildCandidateEmbeddingText } from "@/lib/embeddings/text";
```

with a single import:

```ts
import { ingestCandidate } from "@/lib/candidates/ingest";
```

Replace everything from `const upsertInput = normalizeForUpsert(parsed.data, pool);` to the end of the function with:

```ts
  const upsertInput = normalizeForUpsert(parsed.data, pool);
  try {
    const { candidateId } = await ingestCandidate(
      upsertInput,
      "webhook make/candidate",
    );
    return NextResponse.json({ ok: true, candidateId });
  } catch (e) {
    console.error("[webhook make/candidate] upsert failed", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Assessment webhook — same change**

In `src/app/api/webhooks/assessment/route.ts`:

Remove the imports of `prisma`, `generateEmbedding`, `vectorToPgLiteral`, `buildCandidateEmbeddingText`; add:

```ts
import { ingestCandidate } from "@/lib/candidates/ingest";
```

Replace everything from the `try {` that wraps `prisma.candidate.upsert` to the end of the function with:

```ts
  try {
    const { candidateId } = await ingestCandidate(upsertInput, "webhook assessment");
    return NextResponse.json({ ok: true, candidateId });
  } catch (e) {
    console.error("[webhook assessment] upsert failed", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
```

The `upsertInput` object and the `externalId: contact.phone` choice stay exactly as they are.

- [ ] **Step 3: Run the webhook suites (unchanged tests)**

Run: `pnpm exec vitest run src/__tests__/app/api/webhooks src/__tests__/lib/candidates/ingest.test.ts`
Expected: PASS, same webhook test count as Task 1 Step 2. The webhook tests mock `@/lib/db` and `@/lib/embeddings/client`, which `ingest.ts` imports, so they keep exercising the real write path.

If a webhook test asserts on an exact `console.error` message for embedding failure, it still matches: the tag is passed through (`"[webhook make/candidate] embedding failed"`).

- [ ] **Step 4: Typecheck and lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/webhooks/make/candidate/route.ts src/app/api/webhooks/assessment/route.ts
git commit -m "refactor(webhooks): delegate candidate writes to ingestCandidate"
```

---

### Task 5: Full suite and PR

- [ ] **Step 1: Full test run**

Run: `pnpm exec vitest run`
Expected: no new failures vs `main`. (DB-backed suites under `src/lib/pools/__tests__` may fail if no local DB is configured — those failures are pre-existing, not regressions; compare against a `main` run if unsure.)

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin refactor/ingest-candidate
gh pr create --base main --title "refactor: shared ingestCandidate service for candidate writes" --body "$(cat <<'EOF'
## Summary
- New `src/lib/candidates/ingest.ts`: `upsertCandidate` (tx-aware), `refreshCandidateEmbedding` (best-effort), `ingestCandidate`
- Make and assessment webhooks delegate their write to it
- No behavior change, no schema change. Prepares dashboard candidate creation (spec: docs/superpowers/specs/2026-10-23-candidate-creation-cv-import-design.md)

## Test plan
- [ ] Existing webhook test suites unchanged and green
- [ ] New unit tests for ingest service

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
