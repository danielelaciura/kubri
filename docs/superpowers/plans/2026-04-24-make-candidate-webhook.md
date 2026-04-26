# Make Candidate Webhook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `POST /api/webhooks/make/candidate` that accepts Make's interview-complete payload, authenticates it via shared secret, and upserts into a new `Candidate` Postgres table keyed by `(makeDatastoreId, externalId)`. Dashboard read path is unchanged (still reads from Make) — this PR only adds the write path.

**Architecture:** Single Next.js Route Handler. Zod validates only the 3 structural fields (`key`, `makeDatastoreId`, `data`); `data` contents are tolerated best-effort via an extended `normalize.ts`. New `Candidate` model owns its UUID; `CandidateNote`/`CandidateTag` switch from `makeRecordId` string to `candidateId` UUID FK with ON DELETE CASCADE. Idempotency via `@@unique([makeDatastoreId, externalId])` + upsert. Full incoming body persisted to `rawPayload` JSONB as safety net.

**Tech Stack:** Next.js 16 App Router, Prisma 7, Zod v4, Vitest (jsdom), Postgres (Supabase), cloudflared for local tunnel.

**Spec reference:** `docs/superpowers/specs/2026-04-24-make-candidate-webhook-design.md`

---

## File Structure

**Modify:**
- `prisma/schema.prisma` — add `Candidate` model; migrate `CandidateNote` / `CandidateTag` from `makeRecordId` → `candidateId` FK
- `src/lib/make/normalize.ts` — add `normalizeForUpsert()` that returns Prisma upsert input (does NOT replace existing `normalizeCandidate` used by read layer)
- `.env.example` — add `MAKE_WEBHOOK_SECRET`

**Create:**
- `prisma/migrations/20260424_add_candidate_table/migration.sql` — hand-written SQL (backfill requires JOIN that Prisma auto-generate can't produce)
- `src/lib/validations/webhook-candidate.ts` — Zod schema for webhook body
- `src/app/api/webhooks/make/candidate/route.ts` — Route Handler
- `src/__tests__/lib/validations/webhook-candidate.test.ts`
- `src/__tests__/lib/make/normalize-for-upsert.test.ts`
- `src/__tests__/app/api/webhooks/make/candidate.test.ts`

**Untouched (by design):**
- `src/lib/make/client.ts`, `cache.ts`, `service.ts` — still read from Make for the dashboard
- `src/app/(dashboard)/...` — no UI changes

---

## Task 1: Prisma schema + migration (no backfill yet — Note/Tag renames come in Task 2)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260424_add_candidate_table/migration.sql`

Splitting schema changes into two tasks: Task 1 adds `Candidate` and leaves Note/Tag alone (so the rest of the app keeps compiling). Task 2 rewires Note/Tag.

- [ ] **Step 1: Add `Candidate` model to `prisma/schema.prisma`**

Append at the end (before or after `JobDescription`, not inside it):

```prisma
model Candidate {
  id              String   @id @default(uuid()) @db.Uuid

  externalId      String
  makeDatastoreId String

  firstName       String?
  lastName        String?
  birthday        String?
  countryOfOrigin String?
  address         String?
  phone           String?

  workingPermit   String?
  meanOfTransport String?
  drivingLicense  String?

  educationAndTraining String[]
  workExperience       String[]
  skillsAndCompetences String[]

  language             String?
  additionalLanguages  String[]
  italianLevel         String?

  desiredJob               String?
  partTimePreference       Boolean?
  preferredLocation        String?
  jobConstraints           String?
  hasDesiredJobExperience  String?

  interviewLanguage   String?
  sourceOrganization  String?
  channel             String?

  rawPayload          Json

  sourceUpdatedAt     DateTime?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  @@unique([makeDatastoreId, externalId])
  @@index([makeDatastoreId])
  @@index([makeDatastoreId, createdAt])
  @@index([makeDatastoreId, lastName])
}
```

- [ ] **Step 2: Create migration directory and SQL file by hand**

```bash
mkdir -p prisma/migrations/20260424_add_candidate_table
```

Write `prisma/migrations/20260424_add_candidate_table/migration.sql`:

```sql
CREATE TABLE "Candidate" (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "externalId"              TEXT NOT NULL,
  "makeDatastoreId"         TEXT NOT NULL,
  "firstName"               TEXT,
  "lastName"                TEXT,
  birthday                  TEXT,
  "countryOfOrigin"         TEXT,
  address                   TEXT,
  phone                     TEXT,
  "workingPermit"           TEXT,
  "meanOfTransport"         TEXT,
  "drivingLicense"          TEXT,
  "educationAndTraining"    TEXT[] NOT NULL DEFAULT '{}',
  "workExperience"          TEXT[] NOT NULL DEFAULT '{}',
  "skillsAndCompetences"    TEXT[] NOT NULL DEFAULT '{}',
  language                  TEXT,
  "additionalLanguages"     TEXT[] NOT NULL DEFAULT '{}',
  "italianLevel"            TEXT,
  "desiredJob"              TEXT,
  "partTimePreference"      BOOLEAN,
  "preferredLocation"       TEXT,
  "jobConstraints"          TEXT,
  "hasDesiredJobExperience" TEXT,
  "interviewLanguage"       TEXT,
  "sourceOrganization"      TEXT,
  channel                   TEXT,
  "rawPayload"              JSONB NOT NULL,
  "sourceUpdatedAt"         TIMESTAMP(3),
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"               TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "Candidate_makeDatastoreId_externalId_key"
  ON "Candidate"("makeDatastoreId", "externalId");
CREATE INDEX "Candidate_makeDatastoreId_idx"
  ON "Candidate"("makeDatastoreId");
CREATE INDEX "Candidate_makeDatastoreId_createdAt_idx"
  ON "Candidate"("makeDatastoreId", "createdAt");
CREATE INDEX "Candidate_makeDatastoreId_lastName_idx"
  ON "Candidate"("makeDatastoreId", "lastName");
```

Note: we use `TIMESTAMP(3)` (not `TIMESTAMPTZ`) to match what Prisma emits for `DateTime` by default in this project — check existing migrations (`20260423_*`) to confirm the convention. If existing tables use TIMESTAMPTZ, switch to TIMESTAMPTZ for consistency.

- [ ] **Step 3: Verify convention by opening a recent migration**

Run: `cat prisma/migrations/20260423202930_add_job_descriptions/migration.sql | head -30`

If `"createdAt"` type there is `TIMESTAMP(3)`, leave the SQL as-is. If it's `TIMESTAMPTZ`, replace all `TIMESTAMP(3)` with `TIMESTAMPTZ` in the file above.

- [ ] **Step 4: Apply migration to dev DB**

Run: `pnpm prisma migrate dev`

Expected: migration applies successfully, Prisma client regenerates. `Candidate` now exists in dev DB. No data touched in Note/Tag.

- [ ] **Step 5: Sanity check with psql or Prisma Studio**

Run: `pnpm prisma studio` (or psql) — confirm `Candidate` table exists with the correct columns and indexes.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260424_add_candidate_table
git commit -m "feat: add Candidate model and migration"
```

---

## Task 2: Migrate CandidateNote / CandidateTag to candidateId FK

**Files:**
- Modify: `prisma/schema.prisma` (CandidateNote and CandidateTag models)
- Create: `prisma/migrations/20260424_candidate_notes_tags_fk/migration.sql`

Note/Tag tables are empty in dev and prod today, so the backfill `UPDATE` is a no-op in practice. But we write it correctly so this migration is safe to re-run on environments that might have data.

- [ ] **Step 1: Update `CandidateNote` model in schema**

Replace the existing `CandidateNote` model with:

```prisma
model CandidateNote {
  id             String   @id @default(uuid()) @db.Uuid
  candidateId    String   @db.Uuid
  organizationId String   @db.Uuid
  userId         String   @db.Uuid
  content        String
  createdAt      DateTime @default(now())

  candidate    Candidate    @relation(fields: [candidateId], references: [id], onDelete: Cascade)
  organization Organization @relation(fields: [organizationId], references: [id])
  user         User         @relation(fields: [userId], references: [id])

  @@index([candidateId])
  @@index([organizationId])
}
```

- [ ] **Step 2: Update `CandidateTag` model in schema**

Replace the existing `CandidateTag` model with:

```prisma
model CandidateTag {
  id             String   @id @default(uuid()) @db.Uuid
  candidateId    String   @db.Uuid
  organizationId String   @db.Uuid
  tag            String
  createdAt      DateTime @default(now())

  candidate    Candidate    @relation(fields: [candidateId], references: [id], onDelete: Cascade)
  organization Organization @relation(fields: [organizationId], references: [id])

  @@unique([candidateId, organizationId, tag])
  @@index([candidateId])
  @@index([organizationId])
}
```

- [ ] **Step 3: Add the back-relations on `Candidate`**

In the `Candidate` model added in Task 1, add right before `@@unique`:

```prisma
  notes CandidateNote[]
  tags  CandidateTag[]
```

- [ ] **Step 4: Create migration file by hand**

```bash
mkdir -p prisma/migrations/20260424_candidate_notes_tags_fk
```

Write `prisma/migrations/20260424_candidate_notes_tags_fk/migration.sql`:

```sql
-- CandidateNote: add candidateId FK, drop makeRecordId
ALTER TABLE "CandidateNote" ADD COLUMN "candidateId" UUID;

UPDATE "CandidateNote" cn
SET "candidateId" = c.id
FROM "Candidate" c, "Organization" o
WHERE o.id = cn."organizationId"
  AND c."makeDatastoreId" = o."makeDatastoreId"
  AND c."externalId" = cn."makeRecordId";

DELETE FROM "CandidateNote" WHERE "candidateId" IS NULL;

ALTER TABLE "CandidateNote" ALTER COLUMN "candidateId" SET NOT NULL;
DROP INDEX IF EXISTS "CandidateNote_makeRecordId_organizationId_idx";
ALTER TABLE "CandidateNote" DROP COLUMN "makeRecordId";

ALTER TABLE "CandidateNote"
  ADD CONSTRAINT "CandidateNote_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "Candidate"(id) ON DELETE CASCADE;
CREATE INDEX "CandidateNote_candidateId_idx" ON "CandidateNote"("candidateId");
CREATE INDEX "CandidateNote_organizationId_idx" ON "CandidateNote"("organizationId");

-- CandidateTag: add candidateId FK + unique
ALTER TABLE "CandidateTag" ADD COLUMN "candidateId" UUID;

UPDATE "CandidateTag" ct
SET "candidateId" = c.id
FROM "Candidate" c, "Organization" o
WHERE o.id = ct."organizationId"
  AND c."makeDatastoreId" = o."makeDatastoreId"
  AND c."externalId" = ct."makeRecordId";

DELETE FROM "CandidateTag" WHERE "candidateId" IS NULL;

ALTER TABLE "CandidateTag" ALTER COLUMN "candidateId" SET NOT NULL;
DROP INDEX IF EXISTS "CandidateTag_makeRecordId_organizationId_idx";
ALTER TABLE "CandidateTag" DROP COLUMN "makeRecordId";

ALTER TABLE "CandidateTag"
  ADD CONSTRAINT "CandidateTag_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "Candidate"(id) ON DELETE CASCADE;
CREATE INDEX "CandidateTag_candidateId_idx" ON "CandidateTag"("candidateId");
CREATE INDEX "CandidateTag_organizationId_idx" ON "CandidateTag"("organizationId");
ALTER TABLE "CandidateTag"
  ADD CONSTRAINT "CandidateTag_candidateId_organizationId_tag_key"
  UNIQUE ("candidateId", "organizationId", tag);
```

- [ ] **Step 5: Apply migration**

Run: `pnpm prisma migrate dev`

Expected: applies, client regenerates, no errors. Tables now use `candidateId`.

- [ ] **Step 6: Confirm the project still type-checks**

Run: `pnpm tsc --noEmit`

If any existing code references `makeRecordId` on notes/tags, fix those usages to read `candidateId` instead. Expect none based on current codebase (verify with a search before giving up).

Run a search to confirm: `rg "makeRecordId" src/`

If matches appear, they must be updated. Likely in any admin/stats code. Fix each call site minimally (e.g., rename the property in the query or rework the query to join through `Candidate`).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260424_candidate_notes_tags_fk
git add -u src/  # only if code fixes were needed in Step 6
git commit -m "feat: switch CandidateNote/CandidateTag to candidateId FK"
```

---

## Task 3: Zod validation schema (TDD)

**Files:**
- Create: `src/lib/validations/webhook-candidate.ts`
- Create: `src/__tests__/lib/validations/webhook-candidate.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/lib/validations/webhook-candidate.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { makeCandidateWebhookSchema } from "@/lib/validations/webhook-candidate";

describe("makeCandidateWebhookSchema", () => {
  it("accepts a minimal valid payload", () => {
    const result = makeCandidateWebhookSchema.safeParse({
      key: "abc123",
      makeDatastoreId: "ds_xyz",
      data: {},
    });
    expect(result.success).toBe(true);
  });

  it("accepts a rich data object", () => {
    const result = makeCandidateWebhookSchema.safeParse({
      key: "abc",
      makeDatastoreId: "ds",
      data: {
        first_name: "Mario",
        last_name: "Rossi",
        education_and_training: ["x"],
        job_preferences: { desired_job: "magazziniere" },
        interview_complete: true,
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects when key is missing", () => {
    const result = makeCandidateWebhookSchema.safeParse({
      makeDatastoreId: "ds",
      data: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects when key is empty string", () => {
    const result = makeCandidateWebhookSchema.safeParse({
      key: "",
      makeDatastoreId: "ds",
      data: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects when makeDatastoreId is missing", () => {
    const result = makeCandidateWebhookSchema.safeParse({
      key: "abc",
      data: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects when data is missing", () => {
    const result = makeCandidateWebhookSchema.safeParse({
      key: "abc",
      makeDatastoreId: "ds",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when data is not an object", () => {
    const result = makeCandidateWebhookSchema.safeParse({
      key: "abc",
      makeDatastoreId: "ds",
      data: "oops",
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm vitest run src/__tests__/lib/validations/webhook-candidate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the schema**

Create `src/lib/validations/webhook-candidate.ts`:

```typescript
import { z } from "zod/v4";

export const makeCandidateWebhookSchema = z.object({
  key: z.string().min(1),
  makeDatastoreId: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});

export type MakeCandidateWebhookPayload = z.infer<
  typeof makeCandidateWebhookSchema
>;
```

- [ ] **Step 4: Run tests, verify green**

Run: `pnpm vitest run src/__tests__/lib/validations/webhook-candidate.test.ts`
Expected: 7/7 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/webhook-candidate.ts src/__tests__/lib/validations/webhook-candidate.test.ts
git commit -m "feat: add Zod schema for Make candidate webhook"
```

---

## Task 4: normalizeForUpsert (TDD)

**Files:**
- Modify: `src/lib/make/normalize.ts`
- Create: `src/__tests__/lib/make/normalize-for-upsert.test.ts`

This function takes the validated webhook payload and returns a Prisma upsert input matching the `Candidate` model. Keep `normalizeCandidate` (used by the read layer) untouched.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/lib/make/normalize-for-upsert.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { normalizeForUpsert } from "@/lib/make/normalize";

describe("normalizeForUpsert", () => {
  it("maps a complete payload to Candidate upsert input", () => {
    const result = normalizeForUpsert({
      key: "ext_123",
      makeDatastoreId: "ds_abc",
      data: {
        first_name: "Mario",
        last_name: "Rossi",
        birthday: "1995-03-12",
        country: "Italia",
        address: "Via Roma 1",
        phone: "+39 333",
        working_permit: "permanente",
        transport: "auto",
        driving_license: "B",
        education_and_training: ["Liceo"],
        work_experience: ["Magazziniere 2y"],
        skills_and_competences: ["puntuale"],
        language: "italiano",
        additional_languages: ["inglese"],
        italian_level: "B2",
        job_preferences: {
          desired_job: "magazziniere",
          part_time_preference: true,
          preferred_location: "Milano",
          constraints: "no notturni",
          has_desired_job_experience: "sì",
        },
        source_organization: "APL Milano",
        last_updated: "2026-04-24T15:32:11Z",
      },
    });

    expect(result.externalId).toBe("ext_123");
    expect(result.makeDatastoreId).toBe("ds_abc");
    expect(result.firstName).toBe("Mario");
    expect(result.lastName).toBe("Rossi");
    expect(result.birthday).toBe("1995-03-12");
    expect(result.countryOfOrigin).toBe("Italia");
    expect(result.italianLevel).toBe("B2");
    expect(result.drivingLicense).toBe("B");
    expect(result.educationAndTraining).toEqual(["Liceo"]);
    expect(result.workExperience).toEqual(["Magazziniere 2y"]);
    expect(result.skillsAndCompetences).toEqual(["puntuale"]);
    expect(result.additionalLanguages).toEqual(["inglese"]);
    expect(result.desiredJob).toBe("magazziniere");
    expect(result.partTimePreference).toBe(true);
    expect(result.preferredLocation).toBe("Milano");
    expect(result.jobConstraints).toBe("no notturni");
    expect(result.hasDesiredJobExperience).toBe("sì");
    expect(result.sourceOrganization).toBe("APL Milano");
    expect(result.channel).toBe("telegram");
    expect(result.sourceUpdatedAt).toBeInstanceOf(Date);
    expect(result.rawPayload).toEqual({
      key: "ext_123",
      makeDatastoreId: "ds_abc",
      data: expect.any(Object),
    });
  });

  it("returns null for missing scalar fields (not empty string)", () => {
    const result = normalizeForUpsert({
      key: "k",
      makeDatastoreId: "ds",
      data: {},
    });
    expect(result.firstName).toBeNull();
    expect(result.lastName).toBeNull();
    expect(result.birthday).toBeNull();
    expect(result.italianLevel).toBeNull();
    expect(result.desiredJob).toBeNull();
    expect(result.partTimePreference).toBeNull();
    expect(result.educationAndTraining).toEqual([]);
    expect(result.additionalLanguages).toEqual([]);
    expect(result.sourceUpdatedAt).toBeNull();
  });

  it("derives channel=whatsapp when source_organization contains 'whatsapp'", () => {
    const result = normalizeForUpsert({
      key: "k",
      makeDatastoreId: "ds",
      data: { source_organization: "via WhatsApp Business" },
    });
    expect(result.channel).toBe("whatsapp");
  });

  it("coerces partTimePreference from non-boolean to null", () => {
    const result = normalizeForUpsert({
      key: "k",
      makeDatastoreId: "ds",
      data: { job_preferences: { part_time_preference: "yes" } },
    });
    expect(result.partTimePreference).toBeNull();
  });

  it("always stores the full payload in rawPayload", () => {
    const payload = {
      key: "k",
      makeDatastoreId: "ds",
      data: { some_new_unknown_field: "value" },
    };
    const result = normalizeForUpsert(payload);
    expect(result.rawPayload).toEqual(payload);
  });

  it("parses last_updated into a Date for sourceUpdatedAt", () => {
    const result = normalizeForUpsert({
      key: "k",
      makeDatastoreId: "ds",
      data: { last_updated: "2026-04-24T15:32:11Z" },
    });
    expect(result.sourceUpdatedAt?.toISOString()).toBe("2026-04-24T15:32:11.000Z");
  });

  it("returns null for sourceUpdatedAt when last_updated is invalid", () => {
    const result = normalizeForUpsert({
      key: "k",
      makeDatastoreId: "ds",
      data: { last_updated: "not-a-date" },
    });
    expect(result.sourceUpdatedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm vitest run src/__tests__/lib/make/normalize-for-upsert.test.ts`
Expected: FAIL — `normalizeForUpsert` not exported.

- [ ] **Step 3: Implement `normalizeForUpsert` in `src/lib/make/normalize.ts`**

Append to the bottom of `src/lib/make/normalize.ts` (keeping existing `normalizeCandidate` intact):

```typescript
import type { Prisma } from "@/generated/prisma/client";
import type { MakeCandidateWebhookPayload } from "@/lib/validations/webhook-candidate";

function nullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function parseNullableDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function deriveChannelOrNull(source: unknown): string | null {
  if (typeof source !== "string") return null;
  const s = source.toLowerCase();
  if (s.includes("whatsapp")) return "whatsapp";
  if (s.length > 0) return "telegram";
  return null;
}

export function normalizeForUpsert(
  payload: MakeCandidateWebhookPayload,
): Prisma.CandidateUncheckedCreateInput {
  const d = payload.data;
  const jp = (d["job_preferences"] ?? {}) as Record<string, unknown>;

  return {
    externalId: payload.key,
    makeDatastoreId: payload.makeDatastoreId,

    firstName: nullableString(d["first_name"]),
    lastName: nullableString(d["last_name"]),
    birthday: nullableString(d["birthday"]),
    countryOfOrigin: nullableString(d["country"]),
    address: nullableString(d["address"]),
    phone: nullableString(d["phone"]),

    workingPermit: nullableString(d["working_permit"]),
    meanOfTransport: nullableString(d["transport"]),
    drivingLicense: nullableString(d["driving_license"]),

    educationAndTraining: safeStringArray(d["education_and_training"]),
    workExperience: safeStringArray(d["work_experience"]),
    skillsAndCompetences: safeStringArray(d["skills_and_competences"]),

    language: nullableString(d["language"]),
    additionalLanguages: safeStringArray(d["additional_languages"]),
    italianLevel: nullableString(d["italian_level"]),

    desiredJob: nullableString(jp["desired_job"]),
    partTimePreference: nullableBoolean(jp["part_time_preference"]),
    preferredLocation: nullableString(jp["preferred_location"]),
    jobConstraints: nullableString(jp["constraints"]),
    hasDesiredJobExperience: nullableString(jp["has_desired_job_experience"]),

    interviewLanguage: nullableString(d["language"]),
    sourceOrganization: nullableString(d["source_organization"]),
    channel: deriveChannelOrNull(d["source_organization"]),

    rawPayload: payload as unknown as Prisma.InputJsonValue,

    sourceUpdatedAt: parseNullableDate(d["last_updated"]),
  };
}
```

`safeStringArray` already exists in this file — reuse it.

- [ ] **Step 4: Run tests, verify green**

Run: `pnpm vitest run src/__tests__/lib/make/normalize-for-upsert.test.ts`
Expected: 7/7 PASS.

- [ ] **Step 5: Run the full test suite to confirm nothing else broke**

Run: `pnpm vitest run`
Expected: all prior tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/make/normalize.ts src/__tests__/lib/make/normalize-for-upsert.test.ts
git commit -m "feat: add normalizeForUpsert for webhook → Prisma input"
```

---

## Task 5: Webhook Route Handler (TDD)

**Files:**
- Create: `src/app/api/webhooks/make/candidate/route.ts`
- Create: `src/__tests__/app/api/webhooks/make/candidate.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/app/api/webhooks/make/candidate.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    candidate: {
      upsert: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db";
import { POST } from "@/app/api/webhooks/make/candidate/route";

const SECRET = "test-secret-xyz";

function makeRequest(body: unknown, auth?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth !== undefined) headers["Authorization"] = auth;
  return new Request("http://localhost/api/webhooks/make/candidate", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/webhooks/make/candidate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env["MAKE_WEBHOOK_SECRET"] = SECRET;
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await POST(
      makeRequest({ key: "k", makeDatastoreId: "ds", data: {} }),
    );
    expect(res.status).toBe(401);
    expect(prisma.candidate.upsert).not.toHaveBeenCalled();
  });

  it("returns 401 when Authorization secret is wrong", async () => {
    const res = await POST(
      makeRequest(
        { key: "k", makeDatastoreId: "ds", data: {} },
        "Bearer wrong",
      ),
    );
    expect(res.status).toBe(401);
    expect(prisma.candidate.upsert).not.toHaveBeenCalled();
  });

  it("returns 400 when body is not valid JSON", async () => {
    const res = await POST(makeRequest("{not json", `Bearer ${SECRET}`));
    expect(res.status).toBe(400);
    expect(prisma.candidate.upsert).not.toHaveBeenCalled();
  });

  it("returns 400 when schema validation fails (missing key)", async () => {
    const res = await POST(
      makeRequest(
        { makeDatastoreId: "ds", data: {} },
        `Bearer ${SECRET}`,
      ),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("validation_failed");
    expect(prisma.candidate.upsert).not.toHaveBeenCalled();
  });

  it("returns 200 and upserts on happy path", async () => {
    vi.mocked(prisma.candidate.upsert).mockResolvedValue({
      id: "11111111-1111-1111-1111-111111111111",
    } as never);

    const res = await POST(
      makeRequest(
        {
          key: "ext_123",
          makeDatastoreId: "ds_abc",
          data: { first_name: "Mario", interview_complete: true },
        },
        `Bearer ${SECRET}`,
      ),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.candidateId).toBe("11111111-1111-1111-1111-111111111111");

    expect(prisma.candidate.upsert).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(prisma.candidate.upsert).mock.calls[0]![0];
    expect(arg.where).toEqual({
      makeDatastoreId_externalId: {
        makeDatastoreId: "ds_abc",
        externalId: "ext_123",
      },
    });
    expect(arg.create.firstName).toBe("Mario");
    expect(arg.update.firstName).toBe("Mario");
  });

  it("returns 500 when prisma throws", async () => {
    vi.mocked(prisma.candidate.upsert).mockRejectedValue(new Error("db down"));

    const res = await POST(
      makeRequest(
        { key: "k", makeDatastoreId: "ds", data: {} },
        `Bearer ${SECRET}`,
      ),
    );

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("internal_error");
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm vitest run src/__tests__/app/api/webhooks/make/candidate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the Route Handler**

Create `src/app/api/webhooks/make/candidate/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { makeCandidateWebhookSchema } from "@/lib/validations/webhook-candidate";
import { normalizeForUpsert } from "@/lib/make/normalize";

export async function POST(req: Request): Promise<Response> {
  // 1. Auth
  const expected = process.env["MAKE_WEBHOOK_SECRET"];
  const auth = req.headers.get("authorization");
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. Parse JSON (tolerate malformed body)
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // 3. Structural validation
  const parsed = makeCandidateWebhookSchema.safeParse(body);
  if (!parsed.success) {
    console.error(
      "[webhook make/candidate] validation failed",
      parsed.error.flatten(),
    );
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // 4. Normalize + upsert
  const upsertInput = normalizeForUpsert(parsed.data);
  try {
    const candidate = await prisma.candidate.upsert({
      where: {
        makeDatastoreId_externalId: {
          makeDatastoreId: parsed.data.makeDatastoreId,
          externalId: parsed.data.key,
        },
      },
      create: upsertInput,
      update: upsertInput,
      select: { id: true },
    });
    return NextResponse.json({ ok: true, candidateId: candidate.id });
  } catch (e) {
    console.error("[webhook make/candidate] upsert failed", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run tests, verify green**

Run: `pnpm vitest run src/__tests__/app/api/webhooks/make/candidate.test.ts`
Expected: 6/6 PASS.

- [ ] **Step 5: Run full test suite + lint + typecheck**

Run: `pnpm vitest run && pnpm tsc --noEmit && pnpm lint`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/webhooks/make/candidate/route.ts src/__tests__/app/api/webhooks/make/candidate.test.ts
git commit -m "feat: add POST /api/webhooks/make/candidate route handler"
```

---

## Task 6: Env vars documentation

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add entry to `.env.example`**

Append to the existing Make block in `.env.example`:

```
# Secret shared with Make scenario for webhook authentication.
# Generate with: openssl rand -hex 32
MAKE_WEBHOOK_SECRET=
```

- [ ] **Step 2: Set the value in local `.env.local`**

```bash
echo "MAKE_WEBHOOK_SECRET=$(openssl rand -hex 32)" >> .env.local
```

(The engineer runs this manually — do not commit `.env.local`.)

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "chore: document MAKE_WEBHOOK_SECRET env var"
```

---

## Task 7: Manual end-to-end smoke test (local)

**Files:** none modified — this is a verification step.

Run this before opening the PR. It proves the webhook works against a real Make scenario hitting a local tunnel.

- [ ] **Step 1: Start dev server**

Run: `pnpm dev` — keep running.

- [ ] **Step 2: Start cloudflared tunnel in another terminal**

Run: `cloudflared tunnel --url http://localhost:3000`

Copy the `https://<random>.trycloudflare.com` URL it prints.

- [ ] **Step 3: Smoke test with curl (no Make needed yet)**

```bash
SECRET=$(grep MAKE_WEBHOOK_SECRET .env.local | cut -d= -f2)
curl -X POST http://localhost:3000/api/webhooks/make/candidate \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "smoke_test_1",
    "makeDatastoreId": "ds_local_test",
    "data": {
      "first_name": "Mario",
      "last_name": "Rossi",
      "interview_complete": true,
      "last_updated": "2026-04-24T15:32:11Z"
    }
  }'
```

Expected: `{"ok":true,"candidateId":"..."}`

- [ ] **Step 4: Verify the record exists**

Run: `pnpm prisma studio` → open `Candidate` → confirm the row with `externalId=smoke_test_1`.

- [ ] **Step 5: Verify idempotency**

Re-run the same curl. Expected: still 200, same `candidateId`, updated `updatedAt` timestamp.

- [ ] **Step 6: Verify 401**

```bash
curl -X POST http://localhost:3000/api/webhooks/make/candidate \
  -H "Authorization: Bearer wrong" \
  -H "Content-Type: application/json" \
  -d '{"key":"x","makeDatastoreId":"y","data":{}}'
```

Expected: status 401, `{"error":"unauthorized"}`.

- [ ] **Step 7: (Optional) Test from Make scenario**

If a Make test scenario exists: point its HTTP module to `https://<tunnel>/api/webhooks/make/candidate` with `Authorization: Bearer <secret>`. Trigger an interview-complete. Confirm row in Postgres.

No commit in this task.

---

## Task 8: Production deploy

**Files:** none modified in this task.

Follow the migration workflow documented in `CLAUDE.md` ("Database Migration Workflow" section). Summary:

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/make-candidate-webhook
```

- [ ] **Step 2: Open PR + wait for review**

Target: `main`. Do NOT merge yet.

- [ ] **Step 3: Add `MAKE_WEBHOOK_SECRET` to Vercel**

Vercel Dashboard → Project → Settings → Environment Variables → add `MAKE_WEBHOOK_SECRET` (Production scope) → generate with `openssl rand -hex 32` locally and paste the value. Save — do NOT store this value in any file.

- [ ] **Step 4: Apply migrations to production DB BEFORE merging**

From the PR branch with prod `DATABASE_URL` in a shell (see CLAUDE.md for the exact command pattern):

```bash
DATABASE_URL="<PROD_DIRECT_URL>" pnpm prisma migrate deploy
```

Expected: both new migrations apply (`20260424_add_candidate_table` and `20260424_candidate_notes_tags_fk`).

- [ ] **Step 5: Verify prod schema**

Run (against prod):
```sql
\d "Candidate"
\d "CandidateNote"
\d "CandidateTag"
```

Confirm `Candidate` exists and Note/Tag have `candidateId` + no `makeRecordId`.

- [ ] **Step 6: Merge PR**

Vercel auto-deploys. Wait for deploy to go green.

- [ ] **Step 7: Update Make production scenario**

Add HTTP module at end of interview flow (`interview_complete = true` branch):
- URL: `https://app.kubri.it/api/webhooks/make/candidate`
- Method: POST
- Header: `Authorization: Bearer <MAKE_WEBHOOK_SECRET>`
- Header: `Content-Type: application/json`
- Body (JSON):
  ```json
  {
    "key": "{{key}}",
    "makeDatastoreId": "{{datastore_id}}",
    "data": {{data}}
  }
  ```

(The exact Make expressions depend on how the scenario references the current record — the engineer adapts.)

- [ ] **Step 8: Verify first real candidates land**

Trigger one real/test interview. Then, against prod:

```sql
SELECT id, "externalId", "makeDatastoreId", "firstName", "lastName", "createdAt"
FROM "Candidate"
ORDER BY "createdAt" DESC
LIMIT 5;
```

Expected: the test candidate appears. Dashboard continues to read from Make unchanged — no user-visible change.

No commit needed — deploy artifacts only.

---

## Self-Review

**Spec coverage (§ by §):**
- §3 Architecture: Task 1–5 implement webhook → `Candidate`. Dashboard read path untouched. ✅
- §4.1 Candidate model: Task 1 creates it with every field from spec. ✅
- §4.2 Note/Tag FK migration: Task 2. ✅
- §4.3 Backfill: Task 2 Step 4 SQL matches §7.1. ✅
- §5 Endpoint + auth + body + status codes: Task 5 route handler. ✅
- §5.5 Idempotency: `@@unique([makeDatastoreId, externalId])` from Task 1 + upsert in Task 5. ✅
- §6 Zod "tollerante in input": Task 3 (only 3 structural fields). ✅
- §6.2 Normalize: Task 4 `normalizeForUpsert` added alongside existing `normalizeCandidate`. ✅
- §7.1 SQL migration: split across Tasks 1 and 2 to match the non-data-migrating + data-migrating halves. ✅
- §7.2 Env vars: Task 6. ✅
- §7.3 Deploy steps: Task 8. ✅
- §8 Test plan: unit (Tasks 3, 4), integration (Task 5), manual e2e (Task 7). ✅
- §9 Next steps: documented as out of scope, not implemented. ✅

**Placeholder scan:** No TBDs. Every code step shows actual code. Every command has expected output.

**Type consistency:** `normalizeForUpsert` returns `Prisma.CandidateUncheckedCreateInput`. Route handler passes it to both `create` and `update` of `prisma.candidate.upsert`. Composite key uses the Prisma-generated name `makeDatastoreId_externalId` (Prisma's default concatenation for composite unique — confirmed by the `@@unique([makeDatastoreId, externalId])` declaration). `MakeCandidateWebhookPayload` type is imported in `normalize.ts` from `webhook-candidate.ts`.

**One risk to call out during execution:** If `pnpm tsc --noEmit` in Task 2 Step 6 surfaces existing usages of `makeRecordId` in server actions (admin/stats pages), those need minor adaptation. The plan acknowledges this and instructs a search + fix. Keep the fix scoped to make the code compile — any functional work on those features is out of scope.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-24-make-candidate-webhook.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
