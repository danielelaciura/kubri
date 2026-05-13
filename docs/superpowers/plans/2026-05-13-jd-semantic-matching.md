# JD Semantic Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the lexical rule-based matcher with semantic search over `pgvector` embeddings generated via a Supabase Edge Function running `gte-small`. The location filter survives unchanged; the rest of the matcher (`tokens`, `synonyms`, `skills`, `description`) is removed.

**Architecture:** A new `embedding vector(384)` column lives directly on `Candidate` and `JobDescription`. The Make webhook (for candidates) and the JD server actions (for JDs) call a typed `generateEmbedding(text)` client which POSTs to a Supabase Edge Function `embed` that runs `Supabase.ai.Session('gte-small')`. The matcher's `rankCandidates` becomes a `prisma.$queryRaw` cosine-similarity query, combined with `locationScore`.

**Tech Stack:** Next.js 16, TypeScript strict, Prisma 7 (Postgres adapter), Supabase Postgres + `pgvector`, Supabase Edge Functions (Deno + `Supabase.ai`), Vitest, Zod.

**Spec:** [docs/superpowers/specs/2026-05-13-jd-semantic-matching-design.md](../specs/2026-05-13-jd-semantic-matching-design.md)

---

## File Map

**Created**
- `prisma/migrations/<timestamp>_pgvector_embeddings/migration.sql` — extension + columns + HNSW indexes
- `src/lib/embeddings/client.ts` — typed POST to the Edge Function
- `src/lib/embeddings/text.ts` — builders for `Candidate` and `JobDescription` embedding text
- `src/lib/embeddings/errors.ts` — `EmbeddingError`, `MatchingUnavailableError`
- `supabase/functions/embed/index.ts` — Deno Edge Function running `gte-small`
- `scripts/backfill-embeddings.ts` — idempotent one-shot backfill
- `src/app/api/cron/regenerate-embeddings/route.ts` — daily retry of `embedding IS NULL`
- `src/__tests__/lib/embeddings/text.test.ts` — unit tests on the text builders
- `src/__tests__/lib/embeddings/client.test.ts` — unit tests on the client (with `fetch` mocked)
- `src/__tests__/lib/jobs/matcher/semantic.test.ts` — query-shape and weight tests
- `src/__tests__/app/api/cron/regenerate-embeddings.test.ts`

**Modified**
- `prisma/schema.prisma` — add embedding columns to `Candidate` and `JobDescription`
- `src/lib/jobs/matcher/config.ts` — new weights (skills/description removed)
- `src/lib/jobs/matcher/index.ts` — rewritten: query pgvector + apply location
- `src/app/api/webhooks/make/candidate/route.ts` — generate embedding after upsert
- `src/lib/jobs/service.ts` — generate embedding after `createJobDescription` and `updateJobDescription`
- `.env.example` — new vars
- `package.json` — drop `snowball-stemmers`, `@types/snowball-stemmers`

**Deleted**
- `src/lib/jobs/matcher/tokens.ts`
- `src/lib/jobs/matcher/synonyms.ts`
- `src/lib/jobs/matcher/skills.ts`
- `src/lib/jobs/matcher/description.ts`
- `src/__tests__/lib/jobs/matcher/tokens.test.ts`
- `src/__tests__/lib/jobs/matcher/synonyms.test.ts`
- `src/__tests__/lib/jobs/matcher/skills.test.ts`
- `src/__tests__/lib/jobs/matcher/description.test.ts`

---

## Task 1: pgvector extension + schema migration

**Files:**
- Create: `prisma/migrations/<timestamp>_pgvector_embeddings/migration.sql`
- Modify: `prisma/schema.prisma` (`Candidate`, `JobDescription`)

- [ ] **Step 1: Add embedding fields to `prisma/schema.prisma`**

In `model Candidate` and `model JobDescription`, add (just before the relations / indexes block):

```prisma
  embedding             Unsupported("vector(384)")?
  embeddingText         String?
  embeddingUpdatedAt    DateTime?
```

- [ ] **Step 2: Generate the migration**

Run:
```
pnpm prisma migrate dev --create-only --name pgvector_embeddings
```

Expected: a new folder `prisma/migrations/<timestamp>_pgvector_embeddings/` with `migration.sql`.

- [ ] **Step 3: Replace the auto-generated SQL**

Open the new `migration.sql` and replace its contents with:

```sql
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "Candidate"
  ADD COLUMN "embedding"          vector(384),
  ADD COLUMN "embeddingText"      text,
  ADD COLUMN "embeddingUpdatedAt" timestamptz;

ALTER TABLE "JobDescription"
  ADD COLUMN "embedding"          vector(384),
  ADD COLUMN "embeddingText"      text,
  ADD COLUMN "embeddingUpdatedAt" timestamptz;

CREATE INDEX "Candidate_embedding_hnsw_idx"
  ON "Candidate" USING hnsw (embedding vector_cosine_ops);

CREATE INDEX "JobDescription_embedding_hnsw_idx"
  ON "JobDescription" USING hnsw (embedding vector_cosine_ops);
```

- [ ] **Step 4: Apply the migration in dev**

Run:
```
pnpm prisma migrate dev
```

Expected: "Database is now in sync with your schema." If pgvector isn't enabled in the dev Supabase project, enable it via Supabase Dashboard → Database → Extensions and re-run.

- [ ] **Step 5: Verify**

Run:
```
psql "$DATABASE_URL" -c "\d \"Candidate\"" | grep embedding
psql "$DATABASE_URL" -c "\d \"JobDescription\"" | grep embedding
```

Expected: three rows each (`embedding`, `embeddingText`, `embeddingUpdatedAt`).

- [ ] **Step 6: Commit**

```
git add prisma/
git commit -m "feat(db): add pgvector extension and embedding columns

Adds the vector(384) column on Candidate and JobDescription plus
HNSW indexes for semantic similarity search."
```

---

## Task 2: Embedding text builders

**Files:**
- Create: `src/lib/embeddings/text.ts`
- Test: `src/__tests__/lib/embeddings/text.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/lib/embeddings/text.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildCandidateEmbeddingText,
  buildJobDescriptionEmbeddingText,
} from "@/lib/embeddings/text";

describe("buildCandidateEmbeddingText", () => {
  it("joins all five populated fields with newlines", () => {
    const text = buildCandidateEmbeddingText({
      skillsAndCompetences: ["HACCP", "cucina"],
      workExperience: ["3 anni in pizzeria"],
      educationAndTraining: ["diploma alberghiero"],
      desiredJob: "aiuto cuoco",
      jobConstraints: "no turni notturni",
    });
    expect(text).toBe(
      [
        "HACCP, cucina",
        "3 anni in pizzeria",
        "diploma alberghiero",
        "aiuto cuoco",
        "no turni notturni",
      ].join("\n"),
    );
  });

  it("omits empty arrays and empty strings", () => {
    const text = buildCandidateEmbeddingText({
      skillsAndCompetences: [],
      workExperience: ["magazzino"],
      educationAndTraining: [],
      desiredJob: "",
      jobConstraints: null,
    });
    expect(text).toBe("magazzino");
  });

  it("returns empty string when nothing is populated", () => {
    const text = buildCandidateEmbeddingText({
      skillsAndCompetences: [],
      workExperience: [],
      educationAndTraining: [],
      desiredJob: null,
      jobConstraints: null,
    });
    expect(text).toBe("");
  });

  it("trims and skips blank strings within arrays", () => {
    const text = buildCandidateEmbeddingText({
      skillsAndCompetences: ["  ", "pulizie", ""],
      workExperience: [],
      educationAndTraining: [],
      desiredJob: null,
      jobConstraints: null,
    });
    expect(text).toBe("pulizie");
  });
});

describe("buildJobDescriptionEmbeddingText", () => {
  it("joins name, description and skills", () => {
    const text = buildJobDescriptionEmbeddingText({
      name: "Cameriere weekend",
      description: "Servizio sala in ristorante centro",
      skills: ["sala", "italiano B1"],
    });
    expect(text).toBe(
      ["Cameriere weekend", "Servizio sala in ristorante centro", "sala, italiano B1"].join("\n"),
    );
  });

  it("omits empty skills array and empty description", () => {
    const text = buildJobDescriptionEmbeddingText({
      name: "Cuoco",
      description: "",
      skills: [],
    });
    expect(text).toBe("Cuoco");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run:
```
pnpm test -- text.test
```
Expected: FAIL — `Cannot find module '@/lib/embeddings/text'`.

- [ ] **Step 3: Implement the builders**

Create `src/lib/embeddings/text.ts`:

```ts
export interface CandidateEmbeddingInput {
  skillsAndCompetences: string[];
  workExperience: string[];
  educationAndTraining: string[];
  desiredJob: string | null | undefined;
  jobConstraints: string | null | undefined;
}

export interface JobDescriptionEmbeddingInput {
  name: string;
  description: string;
  skills: string[];
}

function cleanArray(values: string[]): string {
  return values.map((v) => v.trim()).filter((v) => v.length > 0).join(", ");
}

function cleanString(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export function buildCandidateEmbeddingText(input: CandidateEmbeddingInput): string {
  const parts = [
    cleanArray(input.skillsAndCompetences),
    cleanArray(input.workExperience),
    cleanArray(input.educationAndTraining),
    cleanString(input.desiredJob),
    cleanString(input.jobConstraints),
  ];
  return parts.filter((p) => p.length > 0).join("\n");
}

export function buildJobDescriptionEmbeddingText(input: JobDescriptionEmbeddingInput): string {
  const parts = [
    input.name.trim(),
    input.description.trim(),
    cleanArray(input.skills),
  ];
  return parts.filter((p) => p.length > 0).join("\n");
}
```

- [ ] **Step 4: Run tests**

Run:
```
pnpm test -- text.test
```
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```
git add src/lib/embeddings/text.ts src/__tests__/lib/embeddings/text.test.ts
git commit -m "feat(embeddings): add text builders for Candidate and JD"
```

---

## Task 3: Embedding error types

**Files:**
- Create: `src/lib/embeddings/errors.ts`

- [ ] **Step 1: Implement**

Create `src/lib/embeddings/errors.ts`:

```ts
export class EmbeddingError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "EmbeddingError";
  }
}

export class MatchingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MatchingUnavailableError";
  }
}
```

- [ ] **Step 2: Commit**

```
git add src/lib/embeddings/errors.ts
git commit -m "feat(embeddings): add typed error classes"
```

---

## Task 4: Embedding client (with tests)

**Files:**
- Create: `src/lib/embeddings/client.ts`
- Test: `src/__tests__/lib/embeddings/client.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/lib/embeddings/client.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { generateEmbedding } from "@/lib/embeddings/client";
import { EmbeddingError } from "@/lib/embeddings/errors";

const ORIGINAL_FETCH = global.fetch;

describe("generateEmbedding", () => {
  beforeEach(() => {
    process.env["SUPABASE_EDGE_FUNCTION_URL"] = "https://example.supabase.co/functions/v1";
    process.env["SUPABASE_SERVICE_ROLE_KEY"] = "test-key";
    process.env["EMBEDDING_TIMEOUT_MS"] = "3000";
  });
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it("returns the 384-dim vector on success", async () => {
    const fakeVector = Array.from({ length: 384 }, (_, i) => i / 1000);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: fakeVector }),
    }) as unknown as typeof fetch;

    const result = await generateEmbedding("hello world");
    expect(result).toHaveLength(384);
    expect(result[0]).toBe(0);
  });

  it("throws EmbeddingError on non-2xx", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "boom",
    }) as unknown as typeof fetch;

    await expect(generateEmbedding("x")).rejects.toBeInstanceOf(EmbeddingError);
  });

  it("throws EmbeddingError on malformed response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ unexpected: true }),
    }) as unknown as typeof fetch;

    await expect(generateEmbedding("x")).rejects.toBeInstanceOf(EmbeddingError);
  });

  it("throws EmbeddingError when vector length is wrong", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: [1, 2, 3] }),
    }) as unknown as typeof fetch;

    await expect(generateEmbedding("x")).rejects.toBeInstanceOf(EmbeddingError);
  });

  it("throws EmbeddingError when env is missing", async () => {
    delete process.env["SUPABASE_EDGE_FUNCTION_URL"];
    await expect(generateEmbedding("x")).rejects.toBeInstanceOf(EmbeddingError);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run:
```
pnpm test -- client.test
```
Expected: FAIL — `Cannot find module '@/lib/embeddings/client'`.

- [ ] **Step 3: Implement**

Create `src/lib/embeddings/client.ts`:

```ts
import { EmbeddingError } from "./errors";

const EMBEDDING_DIM = 384;

export async function generateEmbedding(text: string): Promise<number[]> {
  const url = process.env["SUPABASE_EDGE_FUNCTION_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) {
    throw new EmbeddingError("Embedding service env vars missing");
  }
  const timeoutMs = Number(process.env["EMBEDDING_TIMEOUT_MS"] ?? "3000");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${url}/embed`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
  } catch (e) {
    throw new EmbeddingError("Embedding request failed", e);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new EmbeddingError(`Embedding HTTP ${res.status}: ${body}`);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch (e) {
    throw new EmbeddingError("Embedding response is not JSON", e);
  }

  if (
    typeof data !== "object" ||
    data === null ||
    !Array.isArray((data as { embedding?: unknown }).embedding)
  ) {
    throw new EmbeddingError("Embedding response missing 'embedding' array");
  }

  const vector = (data as { embedding: number[] }).embedding;
  if (vector.length !== EMBEDDING_DIM) {
    throw new EmbeddingError(
      `Embedding has wrong dim: expected ${EMBEDDING_DIM}, got ${vector.length}`,
    );
  }
  return vector;
}

export function vectorToPgLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}
```

- [ ] **Step 4: Run tests**

Run:
```
pnpm test -- client.test
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```
git add src/lib/embeddings/client.ts src/__tests__/lib/embeddings/client.test.ts
git commit -m "feat(embeddings): add typed client for Supabase Edge Function"
```

---

## Task 5: Supabase Edge Function `embed`

**Files:**
- Create: `supabase/functions/embed/index.ts`

- [ ] **Step 1: Create the function file**

Create `supabase/functions/embed/index.ts`:

```ts
// Deno Edge Function — runs gte-small via Supabase.ai
// deno-lint-ignore-file no-explicit-any
declare const Deno: any;
// @ts-ignore Supabase global
const Supabase: any = (globalThis as any).Supabase;

const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }
  const auth = req.headers.get("authorization");
  if (!SERVICE_ROLE || auth !== `Bearer ${SERVICE_ROLE}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  let body: { text?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  if (typeof body.text !== "string" || body.text.length === 0) {
    return new Response(JSON.stringify({ error: "text_required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const session = new Supabase.ai.Session("gte-small");
  const embedding = await session.run(body.text, { mean_pool: true, normalize: true });

  return new Response(JSON.stringify({ embedding }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
```

- [ ] **Step 2: Deploy to dev**

Run:
```
npx supabase functions deploy embed --project-ref <dev-project-ref>
```

Expected: "Deployed Function embed". If `supabase` CLI is not installed locally, install it (`brew install supabase/tap/supabase`) or deploy from the Supabase Dashboard.

- [ ] **Step 3: Smoke test the function**

Run:
```
curl -X POST "$SUPABASE_EDGE_FUNCTION_URL/embed" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"barista esperto in caffè"}' | jq '.embedding | length'
```
Expected: `384`.

- [ ] **Step 4: Commit**

```
git add supabase/
git commit -m "feat(embeddings): add Supabase Edge Function running gte-small"
```

---

## Task 6: Wire embedding into candidate webhook

**Files:**
- Modify: `src/app/api/webhooks/make/candidate/route.ts`
- Test: `src/__tests__/app/api/webhooks/make/candidate.test.ts` (existing — extend)

- [ ] **Step 1: Read the existing test file**

Run:
```
cat src/__tests__/app/api/webhooks/make/candidate.test.ts
```

Note the existing test setup (Prisma mock, supabase auth bypass, etc.) so the new test reuses the same scaffolding.

- [ ] **Step 2: Add a failing test for embedding generation**

Append the following test inside the existing `describe` block in `src/__tests__/app/api/webhooks/make/candidate.test.ts`:

```ts
import { vi } from "vitest";

vi.mock("@/lib/embeddings/client", () => ({
  generateEmbedding: vi.fn(),
  vectorToPgLiteral: (v: number[]) => `[${v.join(",")}]`,
}));

it("generates and stores the embedding after upsert", async () => {
  const { generateEmbedding } = await import("@/lib/embeddings/client");
  const fakeVector = Array.from({ length: 384 }, () => 0.1);
  (generateEmbedding as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(fakeVector);

  // call the POST handler with a valid payload using the existing test helper
  const res = await callWebhook(validPayload);
  expect(res.status).toBe(200);

  expect(generateEmbedding).toHaveBeenCalledTimes(1);
  const argText = (generateEmbedding as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
  expect(typeof argText).toBe("string");
  expect(argText.length).toBeGreaterThan(0);

  // Verify that a raw UPDATE was issued to set embedding.
  // (Use the prisma mock from the existing setup; assert $executeRaw was called.)
});

it("returns 200 even if embedding generation fails (embedding stays null)", async () => {
  const { generateEmbedding } = await import("@/lib/embeddings/client");
  (generateEmbedding as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("down"));
  const res = await callWebhook(validPayload);
  expect(res.status).toBe(200);
});
```

> Note: adapt `callWebhook` and `validPayload` to the helpers already used in the existing test file.

- [ ] **Step 3: Run to confirm failure**

Run:
```
pnpm test -- candidate.test
```
Expected: FAIL — `generateEmbedding` is not called.

- [ ] **Step 4: Modify the route handler**

In `src/app/api/webhooks/make/candidate/route.ts`, add imports at the top:

```ts
import { generateEmbedding, vectorToPgLiteral } from "@/lib/embeddings/client";
import { buildCandidateEmbeddingText } from "@/lib/embeddings/text";
```

Replace the upsert + return block (where today it returns `{ ok: true, candidateId }`) with:

```ts
const candidate = await prisma.candidate.upsert({
  where: {
    poolId_externalId: { poolId: pool.id, externalId: parsed.data.key },
  },
  create: upsertInput,
  update: upsertInput,
  select: {
    id: true,
    skillsAndCompetences: true,
    workExperience: true,
    educationAndTraining: true,
    desiredJob: true,
    jobConstraints: true,
  },
});

const embeddingText = buildCandidateEmbeddingText({
  skillsAndCompetences: candidate.skillsAndCompetences,
  workExperience: candidate.workExperience,
  educationAndTraining: candidate.educationAndTraining,
  desiredJob: candidate.desiredJob,
  jobConstraints: candidate.jobConstraints,
});

if (embeddingText.length > 0) {
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
    console.error("[webhook make/candidate] embedding failed", {
      candidateId: candidate.id,
      error: e,
    });
  }
}

return NextResponse.json({ ok: true, candidateId: candidate.id });
```

- [ ] **Step 5: Run tests**

Run:
```
pnpm test -- candidate.test
```
Expected: PASS.

- [ ] **Step 6: Commit**

```
git add src/app/api/webhooks/make/candidate/route.ts src/__tests__/app/api/webhooks/make/candidate.test.ts
git commit -m "feat(webhook): generate candidate embedding after upsert"
```

---

## Task 7: Wire embedding into JD service

**Files:**
- Modify: `src/lib/jobs/service.ts`
- Test: `src/__tests__/lib/jobs/service.test.ts` (existing — extend)

- [ ] **Step 1: Add failing tests**

In `src/__tests__/lib/jobs/service.test.ts`, add at the top:

```ts
import { vi } from "vitest";
vi.mock("@/lib/embeddings/client", () => ({
  generateEmbedding: vi.fn().mockResolvedValue(Array.from({ length: 384 }, () => 0.1)),
  vectorToPgLiteral: (v: number[]) => `[${v.join(",")}]`,
}));
```

And inside the existing `describe` block, add:

```ts
it("generates an embedding when creating a JD", async () => {
  const { generateEmbedding } = await import("@/lib/embeddings/client");
  await createJobDescription({
    input: {
      name: "Cameriere",
      description: "Servizio sala",
      skills: ["sala"],
      locationRaw: "Milano",
      searchRadiusKm: 25,
    },
    organizationId: org.id,
    userId: user.id,
  });
  expect(generateEmbedding).toHaveBeenCalled();
});

it("regenerates the embedding when updating a JD", async () => {
  const { generateEmbedding } = await import("@/lib/embeddings/client");
  const jd = await createJobDescription({ /* ... as above ... */ });
  (generateEmbedding as unknown as ReturnType<typeof vi.fn>).mockClear();
  await updateJobDescription({
    id: jd.id,
    organizationId: org.id,
    input: { /* ... updated input ... */ },
  });
  expect(generateEmbedding).toHaveBeenCalledTimes(1);
});
```

> Adapt the fixture variables (`org`, `user`) to those already present in the test file.

- [ ] **Step 2: Run to confirm failure**

Run:
```
pnpm test -- service.test
```
Expected: FAIL — `generateEmbedding` not called.

- [ ] **Step 3: Implement**

In `src/lib/jobs/service.ts`:

```ts
import { generateEmbedding, vectorToPgLiteral } from "@/lib/embeddings/client";
import { buildJobDescriptionEmbeddingText } from "@/lib/embeddings/text";
```

Add a private helper at the bottom of the file:

```ts
async function syncJobDescriptionEmbedding(id: string, input: {
  name: string; description: string; skills: string[];
}) {
  const text = buildJobDescriptionEmbeddingText(input);
  if (text.length === 0) return;
  try {
    const vector = await generateEmbedding(text);
    await prisma.$executeRaw`
      UPDATE "JobDescription"
      SET "embedding" = ${vectorToPgLiteral(vector)}::vector,
          "embeddingText" = ${text},
          "embeddingUpdatedAt" = now()
      WHERE id = ${id}::uuid
    `;
  } catch (e) {
    console.error("[jobs] embedding failed", { jobDescriptionId: id, error: e });
  }
}
```

At the end of `createJobDescription`, before the return, call:

```ts
const jd = await prisma.jobDescription.create({ /* existing */ });
await syncJobDescriptionEmbedding(jd.id, {
  name: jd.name,
  description: jd.description,
  skills: jd.skills,
});
return jd;
```

At the end of `updateJobDescription`, after the update succeeds:

```ts
await syncJobDescriptionEmbedding(id, {
  name: input.name,
  description: input.description,
  skills: input.skills,
});
```

- [ ] **Step 4: Run tests**

Run:
```
pnpm test -- service.test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/lib/jobs/service.ts src/__tests__/lib/jobs/service.test.ts
git commit -m "feat(jobs): generate JD embedding on create and update"
```

---

## Task 8: Rewrite matcher config + index

**Files:**
- Modify: `src/lib/jobs/matcher/config.ts`
- Modify: `src/lib/jobs/matcher/index.ts`
- Create: `src/__tests__/lib/jobs/matcher/semantic.test.ts`

- [ ] **Step 1: Replace `config.ts`**

Overwrite `src/lib/jobs/matcher/config.ts`:

```ts
export const MATCHER_CONFIG = {
  weights: {
    semantic: 0.7,
    location: 0.3,
  },
  displayThreshold: 25,
  fallbackTopN: 10,
  maxResults: 50,
  candidatePoolFetchSize: 200,
} as const;
```

- [ ] **Step 2: Write failing tests for the new matcher**

Create `src/__tests__/lib/jobs/matcher/semantic.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeMatchFromScores } from "@/lib/jobs/matcher";
import { MATCHER_CONFIG } from "@/lib/jobs/matcher/config";

describe("computeMatchFromScores", () => {
  it("combines semantic and location with the configured weights", () => {
    const result = computeMatchFromScores({ semantic: 1, location: 1 });
    expect(result.final).toBe(100);
    expect(result.breakdown).toEqual({ semantic: 1, location: 1 });
  });

  it("returns 0 when both components are 0", () => {
    expect(computeMatchFromScores({ semantic: 0, location: 0 }).final).toBe(0);
  });

  it("rounds correctly", () => {
    // 0.7 * 0.5 + 0.3 * 0.5 = 0.5 → 50
    expect(computeMatchFromScores({ semantic: 0.5, location: 0.5 }).final).toBe(50);
  });

  it("weights semantic more than location", () => {
    const a = computeMatchFromScores({ semantic: 1, location: 0 }).final;
    const b = computeMatchFromScores({ semantic: 0, location: 1 }).final;
    expect(a).toBeGreaterThan(b);
    expect(a).toBe(Math.round(100 * MATCHER_CONFIG.weights.semantic));
    expect(b).toBe(Math.round(100 * MATCHER_CONFIG.weights.location));
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run:
```
pnpm test -- semantic.test
```
Expected: FAIL — module exports don't match yet.

- [ ] **Step 4: Rewrite `index.ts`**

Replace `src/lib/jobs/matcher/index.ts` with:

```ts
import { prisma } from "@/lib/db";
import type { Candidate } from "@/types";
import { MATCHER_CONFIG } from "./config";
import { locationScore } from "./location";
import { MatchingUnavailableError } from "@/lib/embeddings/errors";

export interface JdForMatching {
  embedding: number[] | null;
  locationMunicipality: string | null;
  locationProvince: string | null;
  locationRegion: string | null;
}

export interface MatchResult {
  final: number;
  breakdown: { semantic: number; location: number };
}

export interface RankedCandidate {
  candidate: Candidate;
  match: MatchResult;
  isFallback: boolean;
}

export function computeMatchFromScores(scores: { semantic: number; location: number }): MatchResult {
  const w = MATCHER_CONFIG.weights;
  const final = Math.round(100 * (w.semantic * scores.semantic + w.location * scores.location));
  return { final, breakdown: { semantic: scores.semantic, location: scores.location } };
}

export async function rankCandidates(
  jd: JdForMatching,
  candidates: Candidate[],
): Promise<RankedCandidate[]> {
  if (!jd.embedding) {
    throw new MatchingUnavailableError("JD has no embedding yet");
  }
  if (candidates.length === 0) return [];

  const vectorLiteral = `[${jd.embedding.join(",")}]`;
  const ids = candidates.map((c) => c.id);

  type Row = { id: string; semantic: number };
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT id::text AS id,
           1 - (embedding <=> ${vectorLiteral}::vector) AS semantic
    FROM "Candidate"
    WHERE id = ANY(${ids}::uuid[])
      AND embedding IS NOT NULL
  `;
  const semanticById = new Map<string, number>(rows.map((r) => [r.id, Number(r.semantic)]));

  const scored = candidates.map((c) => {
    const semantic = semanticById.get(c.id) ?? 0;
    const candidateLocation = (c.jobPreferences.preferredLocation || c.address || "").trim();
    const location = locationScore({
      jd: {
        municipality: jd.locationMunicipality,
        province: jd.locationProvince,
        region: jd.locationRegion,
      },
      candidateLocation,
    });
    return { candidate: c, match: computeMatchFromScores({ semantic, location }) };
  });

  scored.sort((a, b) => b.match.final - a.match.final);

  const above = scored.filter((s) => s.match.final >= MATCHER_CONFIG.displayThreshold);
  if (above.length > 0) {
    return above.slice(0, MATCHER_CONFIG.maxResults).map((s) => ({ ...s, isFallback: false }));
  }
  return scored
    .slice(0, MATCHER_CONFIG.fallbackTopN)
    .map((s) => ({ ...s, isFallback: true }));
}
```

Notes:
- The signature stays the same as today (`(jd, candidates) → RankedCandidate[]`) but it is **now async** — the page consumer must `await` it.
- `JdForMatching` requires `embedding: number[] | null`. The page consumer must include the JD's embedding when loading the JD (see Task 8b).
- `locationScore` is unchanged and called with the same args it accepts today: `{ jd: { municipality, province, region }, candidateLocation: string }`.

- [ ] **Step 5: Run tests**

Run:
```
pnpm test -- semantic.test
```
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```
git add src/lib/jobs/matcher/config.ts src/lib/jobs/matcher/index.ts src/__tests__/lib/jobs/matcher/semantic.test.ts
git commit -m "feat(matcher): replace lexical scoring with pgvector semantic query"
```

---

## Task 8b: Update the page consumer

**Files:**
- Modify: `src/app/(dashboard)/dashboard/jobs/[id]/page.tsx`
- Modify: `src/lib/jobs/service.ts` (if `getJobDescription` does not already load the embedding)

- [ ] **Step 1: Make `getJobDescription` include the embedding**

The Prisma model has `embedding` typed as `Unsupported("vector(384)")?`. Prisma cannot select `Unsupported` columns with `findFirst` directly. Replace the body of `getJobDescription` in `src/lib/jobs/service.ts` with a raw query that returns the embedding as `number[]`:

```ts
export async function getJobDescription(params: { id: string; organizationId: string }) {
  const rows = await prisma.$queryRaw<Array<{
    id: string;
    name: string;
    description: string;
    skills: string[];
    locationRaw: string;
    locationMunicipality: string | null;
    locationProvince: string | null;
    locationRegion: string | null;
    searchRadiusKm: number;
    embedding: number[] | null;
  }>>`
    SELECT id::text, name, description, skills,
           "locationRaw", "locationMunicipality", "locationProvince", "locationRegion",
           "searchRadiusKm",
           CASE WHEN embedding IS NULL THEN NULL
                ELSE embedding::text END AS embedding
    FROM "JobDescription"
    WHERE id = ${params.id}::uuid AND "organizationId" = ${params.organizationId}::uuid
    LIMIT 1;
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    ...r,
    embedding: r.embedding == null
      ? null
      : (JSON.parse(String(r.embedding).replace("(", "[").replace(")", "]")) as number[]),
  };
}
```

> The pgvector `vector` cast to `text` produces `[0.12,-0.45,...]` which is valid JSON. The `replace` calls are defensive in case the driver returns the parenthesised form.

- [ ] **Step 2: Update the page consumer**

In `src/app/(dashboard)/dashboard/jobs/[id]/page.tsx`:

a. Update `JdForMatchingLocal` to include `embedding: number[] | null`.

b. Update the `Matches` component:

```ts
async function Matches({ jd, orgId }: { jd: JdForMatchingLocal; orgId: string }) {
  try {
    const candidates = await getCandidatesForOrg(orgId);
    const ranked = await rankCandidates(jd, candidates);
    return <MatchTable ranked={ranked} />;
  } catch (e) {
    const isUnavailable =
      e instanceof Error && e.name === "MatchingUnavailableError";
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {isUnavailable
          ? "Matching non ancora disponibile: l'embedding di questa offerta è in elaborazione."
          : "Impossibile caricare i candidati. Riprova più tardi."}
      </div>
    );
  }
}
```

- [ ] **Step 3: Run the full test suite and the dev server**

Run:
```
pnpm test
pnpm dev
```
Open `http://localhost:3000/dashboard/jobs/<some-id>` and verify the match table renders. With an existing JD that has no embedding yet, you should see the "embedding in elaborazione" message until the cron/backfill runs.

- [ ] **Step 4: Commit**

```
git add src/app/\(dashboard\)/dashboard/jobs/\[id\]/page.tsx src/lib/jobs/service.ts
git commit -m "feat(jobs): wire JD detail page to async semantic rankCandidates"
```

---

## Task 9: Remove the rule-based matcher

**Files (delete):**
- `src/lib/jobs/matcher/tokens.ts`
- `src/lib/jobs/matcher/synonyms.ts`
- `src/lib/jobs/matcher/skills.ts`
- `src/lib/jobs/matcher/description.ts`
- `src/__tests__/lib/jobs/matcher/tokens.test.ts`
- `src/__tests__/lib/jobs/matcher/synonyms.test.ts`
- `src/__tests__/lib/jobs/matcher/skills.test.ts`
- `src/__tests__/lib/jobs/matcher/description.test.ts`

- [ ] **Step 1: Delete files**

Run:
```
rm src/lib/jobs/matcher/tokens.ts \
   src/lib/jobs/matcher/synonyms.ts \
   src/lib/jobs/matcher/skills.ts \
   src/lib/jobs/matcher/description.ts \
   src/__tests__/lib/jobs/matcher/tokens.test.ts \
   src/__tests__/lib/jobs/matcher/synonyms.test.ts \
   src/__tests__/lib/jobs/matcher/skills.test.ts \
   src/__tests__/lib/jobs/matcher/description.test.ts
```

- [ ] **Step 2: Update existing matcher index tests if they import removed symbols**

Run:
```
grep -RIn "tokens\|synonyms\|skillsScore\|descriptionScore" src/
```
Expected after fix: no matches in source code (only references should be in git history). Update any remaining call site in `src/__tests__/lib/jobs/matcher/index.test.ts` to use `computeMatchFromScores` instead.

- [ ] **Step 3: Drop the dependency**

In `package.json`, remove:
- `"snowball-stemmers": "^0.6.0"` from `dependencies`
- `"@types/snowball-stemmers": "^0.6.2"` from `devDependencies`

Run:
```
pnpm install
```

- [ ] **Step 4: Run the full test suite**

Run:
```
pnpm test
```
Expected: all green.

- [ ] **Step 5: Commit**

```
git add -A
git commit -m "refactor(matcher): drop rule-based lexical scoring

Removes tokens, synonyms, skills and description matcher modules
and the snowball-stemmers dependency. Semantic ranking from pgvector
plus the existing location filter replace the old lexical pipeline."
```

---

## Task 10: Backfill script

**Files:**
- Create: `scripts/backfill-embeddings.ts`

- [ ] **Step 1: Implement**

Create `scripts/backfill-embeddings.ts`:

```ts
import "dotenv/config";
import { prisma } from "@/lib/db";
import { generateEmbedding, vectorToPgLiteral } from "@/lib/embeddings/client";
import {
  buildCandidateEmbeddingText,
  buildJobDescriptionEmbeddingText,
} from "@/lib/embeddings/text";

type Target = "candidates" | "jobs" | "all";

function parseArgs(): { target: Target; force: boolean } {
  const args = process.argv.slice(2);
  let target: Target = "all";
  let force = false;
  for (const a of args) {
    if (a.startsWith("--target=")) {
      const v = a.slice("--target=".length);
      if (v === "candidates" || v === "jobs" || v === "all") target = v;
    }
    if (a === "--force") force = true;
  }
  return { target, force };
}

async function backfillCandidates(force: boolean) {
  const where = force ? {} : { embedding: null };
  const total = await prisma.candidate.count({ where });
  console.log(`[candidates] ${total} records to process`);
  let done = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch = await prisma.candidate.findMany({
      where,
      take: 50,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        skillsAndCompetences: true,
        workExperience: true,
        educationAndTraining: true,
        desiredJob: true,
        jobConstraints: true,
      },
    });
    if (batch.length === 0) break;
    for (const c of batch) {
      const text = buildCandidateEmbeddingText(c);
      if (text.length === 0) {
        done++;
        continue;
      }
      try {
        const v = await generateEmbedding(text);
        await prisma.$executeRaw`
          UPDATE "Candidate"
          SET "embedding" = ${vectorToPgLiteral(v)}::vector,
              "embeddingText" = ${text},
              "embeddingUpdatedAt" = now()
          WHERE id = ${c.id}::uuid
        `;
      } catch (e) {
        console.error(`[candidates] ${c.id} failed`, e);
      }
      done++;
      console.log(`[candidates] ${done}/${total} ${c.id} ok`);
    }
    if (!force) break; // when filtering by NULL, once batch is empty we are done
  }
}

async function backfillJobs(force: boolean) {
  const where = force ? {} : { embedding: null };
  const total = await prisma.jobDescription.count({ where });
  console.log(`[jobs] ${total} records to process`);
  let done = 0;
  while (true) {
    const batch = await prisma.jobDescription.findMany({
      where,
      take: 50,
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, description: true, skills: true },
    });
    if (batch.length === 0) break;
    for (const j of batch) {
      const text = buildJobDescriptionEmbeddingText(j);
      if (text.length === 0) {
        done++;
        continue;
      }
      try {
        const v = await generateEmbedding(text);
        await prisma.$executeRaw`
          UPDATE "JobDescription"
          SET "embedding" = ${vectorToPgLiteral(v)}::vector,
              "embeddingText" = ${text},
              "embeddingUpdatedAt" = now()
          WHERE id = ${j.id}::uuid
        `;
      } catch (e) {
        console.error(`[jobs] ${j.id} failed`, e);
      }
      done++;
      console.log(`[jobs] ${done}/${total} ${j.id} ok`);
    }
    if (!force) break;
  }
}

async function main() {
  const { target, force } = parseArgs();
  if (target === "all" || target === "candidates") await backfillCandidates(force);
  if (target === "all" || target === "jobs") await backfillJobs(force);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke test in dev**

Run:
```
pnpm tsx scripts/backfill-embeddings.ts --target=all
```
Expected: logs all candidates and JDs being processed.

- [ ] **Step 3: Verify**

Run:
```
psql "$DATABASE_URL" -c 'SELECT count(*) FROM "Candidate" WHERE embedding IS NOT NULL;'
psql "$DATABASE_URL" -c 'SELECT count(*) FROM "JobDescription" WHERE embedding IS NOT NULL;'
```
Expected: counts match the totals from the dashboard.

- [ ] **Step 4: Commit**

```
git add scripts/backfill-embeddings.ts
git commit -m "feat(embeddings): add idempotent backfill script"
```

---

## Task 11: Cron route for retry of null embeddings

**Files:**
- Create: `src/app/api/cron/regenerate-embeddings/route.ts`
- Test: `src/__tests__/app/api/cron/regenerate-embeddings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/app/api/cron/regenerate-embeddings.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/embeddings/client", () => ({
  generateEmbedding: vi.fn().mockResolvedValue(Array.from({ length: 384 }, () => 0.1)),
  vectorToPgLiteral: (v: number[]) => `[${v.join(",")}]`,
}));

describe("GET /api/cron/regenerate-embeddings", () => {
  beforeEach(() => {
    process.env["CRON_SECRET"] = "test-cron";
  });

  it("rejects unauthenticated calls", async () => {
    const { GET } = await import("@/app/api/cron/regenerate-embeddings/route");
    const res = await GET(new Request("http://x/api/cron/regenerate-embeddings"));
    expect(res.status).toBe(401);
  });

  it("processes candidates and jobs with null embeddings", async () => {
    const { GET } = await import("@/app/api/cron/regenerate-embeddings/route");
    const req = new Request("http://x/api/cron/regenerate-embeddings", {
      headers: { authorization: "Bearer test-cron" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("candidates");
    expect(body).toHaveProperty("jobs");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run:
```
pnpm test -- regenerate-embeddings.test
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

Create `src/app/api/cron/regenerate-embeddings/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateEmbedding, vectorToPgLiteral } from "@/lib/embeddings/client";
import {
  buildCandidateEmbeddingText,
  buildJobDescriptionEmbeddingText,
} from "@/lib/embeddings/text";

const MAX_PER_RUN = 500;

export async function GET(req: Request): Promise<Response> {
  const expected = process.env["CRON_SECRET"];
  const auth = req.headers.get("authorization");
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let candidates = 0;
  const candBatch = await prisma.candidate.findMany({
    where: { embedding: null },
    take: MAX_PER_RUN,
    select: {
      id: true,
      skillsAndCompetences: true,
      workExperience: true,
      educationAndTraining: true,
      desiredJob: true,
      jobConstraints: true,
    },
  });
  for (const c of candBatch) {
    const text = buildCandidateEmbeddingText(c);
    if (!text) continue;
    try {
      const v = await generateEmbedding(text);
      await prisma.$executeRaw`
        UPDATE "Candidate"
        SET "embedding" = ${vectorToPgLiteral(v)}::vector,
            "embeddingText" = ${text},
            "embeddingUpdatedAt" = now()
        WHERE id = ${c.id}::uuid
      `;
      candidates++;
    } catch (e) {
      console.error("[cron] candidate embedding failed", c.id, e);
    }
  }

  let jobs = 0;
  const jobBatch = await prisma.jobDescription.findMany({
    where: { embedding: null },
    take: MAX_PER_RUN,
    select: { id: true, name: true, description: true, skills: true },
  });
  for (const j of jobBatch) {
    const text = buildJobDescriptionEmbeddingText(j);
    if (!text) continue;
    try {
      const v = await generateEmbedding(text);
      await prisma.$executeRaw`
        UPDATE "JobDescription"
        SET "embedding" = ${vectorToPgLiteral(v)}::vector,
            "embeddingText" = ${text},
            "embeddingUpdatedAt" = now()
        WHERE id = ${j.id}::uuid
      `;
      jobs++;
    } catch (e) {
      console.error("[cron] job embedding failed", j.id, e);
    }
  }

  return NextResponse.json({ candidates, jobs });
}
```

- [ ] **Step 4: Register the cron schedule**

Add to (or create) `vercel.json` at repo root:

```json
{
  "crons": [
    {
      "path": "/api/cron/regenerate-embeddings",
      "schedule": "0 3 * * *"
    }
  ]
}
```

- [ ] **Step 5: Run tests**

Run:
```
pnpm test -- regenerate-embeddings.test
```
Expected: PASS.

- [ ] **Step 6: Commit**

```
git add src/app/api/cron/regenerate-embeddings/route.ts src/__tests__/app/api/cron/regenerate-embeddings.test.ts vercel.json
git commit -m "feat(cron): daily retry for null embeddings"
```

---

## Task 12: Env example + final verification

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add new env vars**

Append to `.env.example`:

```
# Semantic matching
SUPABASE_EDGE_FUNCTION_URL="https://<project-ref>.supabase.co/functions/v1"
EMBEDDING_TIMEOUT_MS="3000"

# Cron
CRON_SECRET="<random-string>"
```

- [ ] **Step 2: Full suite + lint + typecheck**

Run:
```
pnpm lint && pnpm test && pnpm prisma validate
```
Expected: all pass.

- [ ] **Step 3: Manual smoke test in dev**

1. Open a JD with location set
2. Verify the list of matched candidates renders without error
3. Inspect the top candidate — its score should reflect the new 0.7/0.3 blend
4. Modify the JD description, save, verify a new ranking emerges

- [ ] **Step 4: Apply migration to prod (per CLAUDE.md workflow)**

Run:
```
set -a && source .env.prod && set +a && pnpm prisma migrate deploy
set -a && source .env.prod && set +a && pnpm prisma migrate status
```
Expected: status reports the new migration as applied.

- [ ] **Step 5: Deploy `embed` function to prod**

Run:
```
npx supabase functions deploy embed --project-ref <prod-project-ref>
```

- [ ] **Step 6: Run prod backfill once**

Run:
```
set -a && source .env.prod && set +a && pnpm tsx scripts/backfill-embeddings.ts --target=all
```

- [ ] **Step 7: Commit env update + open PR**

```
git add .env.example
git commit -m "chore(env): document semantic matching env vars"
git push -u origin claude/trusting-jang-e76bfb
gh pr create --title "feat: semantic JD matching via pgvector + gte-small" \
  --body "$(cat <<'EOF'
## Summary
- Replaces lexical rule-based matcher with semantic search over pgvector
- Embeddings generated by a Supabase Edge Function running gte-small (EU, free tier)
- Location filter preserved; new weights 0.7 semantic / 0.3 location

## Test plan
- [ ] Dev migration applied
- [ ] Edge function deployed
- [ ] Backfill run in dev
- [ ] Manual smoke test on a real JD
- [ ] Prod migration applied before merge
EOF
)"
```

---

## Open items (post-merge)

- Tune `displayThreshold` (initial 25) after the first week of real data.
- Watch the cron logs for repeated failures — they indicate a deeper issue with the Edge Function.
- Plan the LLM-narrative follow-up (separate spec).
