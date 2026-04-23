# Job Descriptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Job Description entity with CRUD UI, scoped by organization + role, that computes a live 0–100 match score for each candidate (fetched from Make.com) based on skills, description, and Italian administrative-hierarchy-aware location.

**Architecture:** New `JobDescription` Prisma model lives in PostgreSQL; candidate data continues to flow from Make.com via the existing `src/lib/make/` cache layer. A pure-TypeScript matching engine (`src/lib/jobs/matcher/`) combines three sub-scorers: lexical-with-Italian-stemming for skills, weighted token overlap for description, and a hierarchical resolver over a bundled ISTAT admin dataset for location. UI is Next.js App Router Server Components with Server Actions for mutations, shadcn/ui for primitives, Italian copy.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Prisma (PostgreSQL), Zod v4, shadcn/ui, Tailwind, NextAuth v5, Vitest, `snowball-stemmer` (new dep).

**Spec:** `docs/superpowers/specs/2026-04-15-job-descriptions-design.md`

---

## File Structure

**Create:**

- `prisma/schema.prisma` — add `JobDescription` model + relations on `Organization`/`User`.
- `prisma/migrations/<ts>_add_job_descriptions/migration.sql`.
- `src/lib/validations/job-description.ts` — Zod schemas.
- `src/lib/jobs/service.ts` — CRUD, always filters by `organizationId`.
- `src/lib/jobs/matcher/config.ts` — weights, threshold constants.
- `src/lib/jobs/matcher/tokens.ts` — normalize/tokenize/stem utilities.
- `src/lib/jobs/matcher/synonyms.ts` — Italian ↔ English synonym map.
- `src/lib/jobs/matcher/skills.ts` — `skillsScore`.
- `src/lib/jobs/matcher/description.ts` — `descriptionScore`.
- `src/lib/jobs/matcher/location.ts` — `locationScore` (depends on geo resolver).
- `src/lib/jobs/matcher/index.ts` — `computeMatch`, `rankCandidates`.
- `src/lib/geo/italy-admin.ts` — generated static dataset.
- `src/lib/geo/resolve.ts` — `resolveLocation`.
- `scripts/build-italy-admin.ts` — one-shot builder for the geo dataset.
- `src/app/(dashboard)/dashboard/jobs/page.tsx` — list.
- `src/app/(dashboard)/dashboard/jobs/new/page.tsx` — create form.
- `src/app/(dashboard)/dashboard/jobs/[id]/page.tsx` — detail + matches.
- `src/app/(dashboard)/dashboard/jobs/[id]/edit/page.tsx` — edit.
- `src/app/(dashboard)/dashboard/jobs/[id]/actions.ts` — server actions (update, delete).
- `src/app/(dashboard)/dashboard/jobs/actions.ts` — create action.
- `src/app/(admin)/admin/jobs/page.tsx` — cross-org admin list.
- `src/components/jobs/job-form.tsx` — shared create/edit client component.
- `src/components/jobs/skills-input.tsx` — chip tag input.
- `src/components/jobs/location-combobox.tsx` — autocomplete.
- `src/components/jobs/match-table.tsx` — client, sortable scores.
- `src/components/jobs/score-badge.tsx` — colored percent badge.
- Tests for everything matchable: `src/__tests__/lib/jobs/matcher/*.test.ts`, `src/__tests__/lib/geo/resolve.test.ts`, `src/__tests__/lib/jobs/service.test.ts`.

**Modify:**

- `src/components/layout/sidebar.tsx` — add "Offerte di lavoro" nav entry.
- `src/components/layout/header.tsx:27-33` — uncomment + wire the "+ Aggiungi Job description" button to navigate; gate by `ORG_ADMIN`.
- `src/lib/i18n/strings.ts` — add Italian copy for the feature.
- `package.json` — add `snowball-stemmer`.

---

## Conventions Used in This Plan

- All commands assume pwd = repo root (`/Users/daniele/Projects/kubri`).
- Tests use Vitest (`pnpm test -- <path>`). UI pages aren't unit-tested; we rely on typecheck + manual verification.
- Every commit message follows Conventional Commits.
- Every task ends with a commit step. Do not skip.
- Frequent commits — one per task is the minimum cadence.

---

## Task 1: Add Prisma model & migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_job_descriptions/migration.sql`

- [ ] **Step 1: Add the model to `prisma/schema.prisma`**

Append after `AuditLog`:

```prisma
model JobDescription {
  id                   String   @id @default(uuid())
  organizationId       String
  createdByUserId      String
  name                 String
  locationRaw          String
  locationMunicipality String?
  locationProvince     String?
  locationRegion       String?
  description          String
  skills               String[]
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id])
  createdBy    User         @relation(fields: [createdByUserId], references: [id])

  @@unique([organizationId, name])
  @@index([organizationId, createdAt])
}
```

Add reverse relations to the existing models:

```prisma
model Organization {
  // ...existing fields
  jobDescriptions JobDescription[]
}

model User {
  // ...existing fields
  jobDescriptions JobDescription[]
}
```

- [ ] **Step 2: Generate and apply the migration**

Run:
```bash
pnpm prisma migrate dev --name add_job_descriptions
pnpm prisma generate
```

Expected: new migration file under `prisma/migrations/`, Prisma client regenerated at `src/generated/prisma/`.

- [ ] **Step 3: Verify with a quick Prisma Studio check**

Run:
```bash
pnpm prisma validate
```

Expected: "The schema at `prisma/schema.prisma` is valid 🚀".

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(jobs): add JobDescription Prisma model"
```

---

## Task 2: Zod validation schemas

**Files:**
- Create: `src/lib/validations/job-description.ts`
- Test: `src/__tests__/lib/validations/job-description.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/lib/validations/job-description.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { jobDescriptionInputSchema } from "@/lib/validations/job-description";

describe("jobDescriptionInputSchema", () => {
  const valid = {
    name: "Addetto pulizie",
    locationRaw: "Milano",
    description: "Cerchiamo personale per pulizie di uffici e ambienti industriali.",
    skills: ["pulizie", "attenzione ai dettagli"],
  };

  it("accepts a valid input", () => {
    const r = jobDescriptionInputSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it("rejects empty name", () => {
    const r = jobDescriptionInputSchema.safeParse({ ...valid, name: "" });
    expect(r.success).toBe(false);
  });

  it("rejects description shorter than 20 chars", () => {
    const r = jobDescriptionInputSchema.safeParse({ ...valid, description: "troppo breve" });
    expect(r.success).toBe(false);
  });

  it("rejects empty location", () => {
    const r = jobDescriptionInputSchema.safeParse({ ...valid, locationRaw: "   " });
    expect(r.success).toBe(false);
  });

  it("accepts empty skills array", () => {
    const r = jobDescriptionInputSchema.safeParse({ ...valid, skills: [] });
    expect(r.success).toBe(true);
  });

  it("trims and filters empty skills", () => {
    const r = jobDescriptionInputSchema.safeParse({
      ...valid,
      skills: ["  pulizie  ", "", "  "],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.skills).toEqual(["pulizie"]);
  });

  it("caps skills at 30 entries", () => {
    const skills = Array.from({ length: 31 }, (_, i) => `s${i}`);
    const r = jobDescriptionInputSchema.safeParse({ ...valid, skills });
    expect(r.success).toBe(false);
  });

  it("caps name at 120 chars", () => {
    const r = jobDescriptionInputSchema.safeParse({ ...valid, name: "x".repeat(121) });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests (expect failure)**

Run: `pnpm test -- src/__tests__/lib/validations/job-description.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `src/lib/validations/job-description.ts`**

```typescript
import { z } from "zod/v4";

export const jobDescriptionInputSchema = z.object({
  name: z.string().trim().min(1, "Il nome è obbligatorio").max(120, "Massimo 120 caratteri"),
  locationRaw: z.string().trim().min(1, "La località è obbligatoria").max(120),
  description: z
    .string()
    .trim()
    .min(20, "La descrizione deve contenere almeno 20 caratteri")
    .max(5000),
  skills: z
    .array(z.string())
    .max(30, "Massimo 30 competenze")
    .transform((arr) => arr.map((s) => s.trim()).filter(Boolean)),
});

export type JobDescriptionInput = z.infer<typeof jobDescriptionInputSchema>;
```

- [ ] **Step 4: Run tests (expect pass)**

Run: `pnpm test -- src/__tests__/lib/validations/job-description.test.ts`
Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/job-description.ts src/__tests__/lib/validations/
git commit -m "feat(jobs): Zod schema for job description input"
```

---

## Task 3: Geo dataset builder script

**Files:**
- Create: `scripts/build-italy-admin.ts`
- Create: `src/lib/geo/italy-admin.ts` (generated)

- [ ] **Step 1: Create the builder script**

Create `scripts/build-italy-admin.ts`:

```typescript
/**
 * One-shot builder: downloads the ISTAT "Elenco dei comuni italiani" CSV
 * and emits src/lib/geo/italy-admin.ts.
 *
 * Run: pnpm tsx scripts/build-italy-admin.ts
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ISTAT_CSV_URL =
  "https://www.istat.it/storage/codici-unita-amministrative/Elenco-comuni-italiani.csv";

interface Row {
  municipality: string;
  province: string;
  provinceCode: string;
  region: string;
}

function parseCsv(text: string): Row[] {
  // ISTAT CSV uses ";" as separator and Latin-1. We fetch as text and
  // defensively re-encode if needed.
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(";");
  const idx = {
    region: header.findIndex((h) => h.includes("Regione") && !h.includes("ripartizione")),
    province: header.findIndex((h) => h === "Denominazione dell'Unità territoriale sovracomunale (valida a fini statistici)" || h.startsWith("Denominazione dell'Unità territoriale")),
    provinceCode: header.findIndex((h) => h.includes("Sigla automobilistica")),
    municipality: header.findIndex((h) => h.startsWith("Denominazione in italiano")),
  };
  if (Object.values(idx).some((i) => i < 0)) {
    throw new Error(`Could not locate required columns. Header: ${header.join(" | ")}`);
  }
  const out: Row[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(";");
    const municipality = cells[idx.municipality]?.trim();
    const province = cells[idx.province]?.trim();
    const provinceCode = cells[idx.provinceCode]?.trim();
    const region = cells[idx.region]?.trim();
    if (municipality && province && region) {
      out.push({ municipality, province, provinceCode, region });
    }
  }
  return out;
}

async function main() {
  const res = await fetch(ISTAT_CSV_URL);
  if (!res.ok) throw new Error(`ISTAT fetch failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  // ISTAT file ships as ISO-8859-1
  const text = new TextDecoder("iso-8859-1").decode(buf);
  const rows = parseCsv(text);
  if (rows.length < 7000) throw new Error(`Too few rows parsed: ${rows.length}`);

  const file = `// AUTO-GENERATED by scripts/build-italy-admin.ts — do not edit manually.
export interface ItalyAdminRow {
  municipality: string;
  province: string;
  provinceCode: string;
  region: string;
}

export const ITALY_ADMIN: readonly ItalyAdminRow[] = ${JSON.stringify(rows, null, 2)} as const;
`;
  const out = resolve(process.cwd(), "src/lib/geo/italy-admin.ts");
  writeFileSync(out, file, "utf8");
  console.log(`Wrote ${rows.length} rows to ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run the builder**

Run: `pnpm tsx scripts/build-italy-admin.ts`
Expected: prints "Wrote 7XXX rows to .../italy-admin.ts" and creates `src/lib/geo/italy-admin.ts`.

If ISTAT's CSV header column names differ, adjust the `idx` mapping in the script — the error message lists the actual header. Common variations: "Denominazione Regione" vs "Denominazione regione". Keep the comparison case-insensitive if needed.

- [ ] **Step 3: Sanity check the generated file**

Run:
```bash
head -3 src/lib/geo/italy-admin.ts
grep -c '"municipality"' src/lib/geo/italy-admin.ts
```

Expected: header comment + `> 7000` rows.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-italy-admin.ts src/lib/geo/italy-admin.ts
git commit -m "feat(geo): bundle ISTAT Italian admin dataset"
```

---

## Task 4: Location resolver

**Files:**
- Create: `src/lib/geo/resolve.ts`
- Test: `src/__tests__/lib/geo/resolve.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/lib/geo/resolve.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { resolveLocation, normalizePlace } from "@/lib/geo/resolve";

describe("normalizePlace", () => {
  it("lowercases, strips accents, collapses whitespace", () => {
    expect(normalizePlace("  Città di Castello ")).toBe("citta di castello");
    expect(normalizePlace("Sant'Angelo")).toBe("sant'angelo");
  });
});

describe("resolveLocation", () => {
  it("resolves a comune to full hierarchy", () => {
    const r = resolveLocation("Milano");
    expect(r.confidence).toBe("exact");
    expect(r.municipality).toBe("Milano");
    expect(r.province).toBe("Milano");
    expect(r.region).toBe("Lombardia");
  });

  it("resolves a province to province + region", () => {
    const r = resolveLocation("Torino");
    expect(r.confidence).toBe("exact");
    expect(r.province).toBe("Torino");
    expect(r.region).toBe("Piemonte");
  });

  it("resolves a region name to region only", () => {
    const r = resolveLocation("Lombardia");
    expect(r.confidence).toBe("exact");
    expect(r.region).toBe("Lombardia");
    expect(r.municipality).toBeUndefined();
    expect(r.province).toBeUndefined();
  });

  it("returns none for unknown input", () => {
    const r = resolveLocation("Atlantide");
    expect(r.confidence).toBe("none");
  });

  it("handles case and accents", () => {
    const r = resolveLocation("città di castello");
    expect(r.confidence).toBe("exact");
    expect(r.municipality).toBe("Città di Castello");
  });

  it("returns partial match within Levenshtein 2", () => {
    const r = resolveLocation("Milno");
    expect(r.confidence).toBe("partial");
    expect(r.municipality).toBe("Milano");
  });
});
```

- [ ] **Step 2: Run tests (expect failure)**

Run: `pnpm test -- src/__tests__/lib/geo/resolve.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the resolver**

Create `src/lib/geo/resolve.ts`:

```typescript
import { ITALY_ADMIN, type ItalyAdminRow } from "./italy-admin";

export function normalizePlace(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

interface Indices {
  byMunicipality: Map<string, ItalyAdminRow>;
  byProvince: Map<string, ItalyAdminRow>;
  byRegion: Map<string, string>;
  allMunicipalities: string[];
  allProvinces: string[];
  allRegions: string[];
}

let _indices: Indices | null = null;
function indices(): Indices {
  if (_indices) return _indices;
  const byMunicipality = new Map<string, ItalyAdminRow>();
  const byProvince = new Map<string, ItalyAdminRow>();
  const byRegion = new Map<string, string>();
  for (const row of ITALY_ADMIN) {
    byMunicipality.set(normalizePlace(row.municipality), row);
    byProvince.set(normalizePlace(row.province), row);
    byRegion.set(normalizePlace(row.region), row.region);
  }
  _indices = {
    byMunicipality,
    byProvince,
    byRegion,
    allMunicipalities: [...byMunicipality.keys()],
    allProvinces: [...byProvince.keys()],
    allRegions: [...byRegion.keys()],
  };
  return _indices;
}

export interface ResolvedLocation {
  municipality?: string;
  province?: string;
  region?: string;
  confidence: "exact" | "partial" | "none";
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const row = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = i;
    for (let j = 1; j <= n; j++) {
      const val = a[i - 1] === b[j - 1]
        ? row[j - 1]
        : 1 + Math.min(row[j - 1], row[j], prev);
      row[j - 1] = prev;
      prev = val;
    }
    row[n] = prev;
  }
  return row[n];
}

function fuzzyFind(query: string, candidates: string[], maxDistance: number): string | undefined {
  let best: { name: string; dist: number } | undefined;
  for (const c of candidates) {
    if (Math.abs(c.length - query.length) > maxDistance) continue;
    const d = levenshtein(query, c);
    if (d <= maxDistance && (!best || d < best.dist)) best = { name: c, dist: d };
  }
  return best?.name;
}

export function resolveLocation(input: string): ResolvedLocation {
  const key = normalizePlace(input);
  if (!key) return { confidence: "none" };
  const idx = indices();

  const m = idx.byMunicipality.get(key);
  if (m) return { municipality: m.municipality, province: m.province, region: m.region, confidence: "exact" };

  const p = idx.byProvince.get(key);
  if (p) return { province: p.province, region: p.region, confidence: "exact" };

  const r = idx.byRegion.get(key);
  if (r) return { region: r, confidence: "exact" };

  // Fuzzy, Levenshtein ≤ 2
  const fm = fuzzyFind(key, idx.allMunicipalities, 2);
  if (fm) {
    const row = idx.byMunicipality.get(fm)!;
    return { municipality: row.municipality, province: row.province, region: row.region, confidence: "partial" };
  }
  const fp = fuzzyFind(key, idx.allProvinces, 2);
  if (fp) {
    const row = idx.byProvince.get(fp)!;
    return { province: row.province, region: row.region, confidence: "partial" };
  }
  const fr = fuzzyFind(key, idx.allRegions, 2);
  if (fr) {
    return { region: idx.byRegion.get(fr)!, confidence: "partial" };
  }

  return { confidence: "none" };
}
```

- [ ] **Step 4: Run tests (expect pass)**

Run: `pnpm test -- src/__tests__/lib/geo/resolve.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/geo/resolve.ts src/__tests__/lib/geo/
git commit -m "feat(geo): Italian admin hierarchy resolver"
```

---

## Task 5: JD service layer

**Files:**
- Create: `src/lib/jobs/service.ts`
- Test: `src/__tests__/lib/jobs/service.test.ts`

Depends on Tasks 1, 2, 4.

- [ ] **Step 1: Write failing tests**

The service mocks are a thin wrapper over Prisma. We test the *logic*: org scoping, location resolution on create/update, uniqueness error mapping.

Create `src/__tests__/lib/jobs/service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createJobDescription, listJobDescriptions, getJobDescription, updateJobDescription, deleteJobDescription, JobNameAlreadyExistsError } from "@/lib/jobs/service";

const mockDb = {
  jobDescription: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({ db: mockDb }));

beforeEach(() => {
  vi.clearAllMocks();
});

const baseInput = {
  name: "Addetto pulizie",
  locationRaw: "Milano",
  description: "Cerchiamo personale per pulizie di uffici.",
  skills: ["pulizie"],
};

describe("createJobDescription", () => {
  it("resolves location and forwards to Prisma with org scoping", async () => {
    mockDb.jobDescription.create.mockResolvedValue({ id: "jd-1" });
    await createJobDescription({ input: baseInput, organizationId: "org-1", userId: "user-1" });
    expect(mockDb.jobDescription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-1",
          createdByUserId: "user-1",
          name: "Addetto pulizie",
          locationRaw: "Milano",
          locationMunicipality: "Milano",
          locationProvince: "Milano",
          locationRegion: "Lombardia",
        }),
      })
    );
  });

  it("maps Prisma P2002 unique error to JobNameAlreadyExistsError", async () => {
    mockDb.jobDescription.create.mockRejectedValue({ code: "P2002" });
    await expect(
      createJobDescription({ input: baseInput, organizationId: "org-1", userId: "user-1" })
    ).rejects.toBeInstanceOf(JobNameAlreadyExistsError);
  });
});

describe("listJobDescriptions", () => {
  it("filters by organizationId", async () => {
    mockDb.jobDescription.findMany.mockResolvedValue([]);
    await listJobDescriptions({ organizationId: "org-1" });
    expect(mockDb.jobDescription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-1" },
      })
    );
  });
});

describe("getJobDescription", () => {
  it("requires matching organizationId", async () => {
    mockDb.jobDescription.findFirst.mockResolvedValue(null);
    const r = await getJobDescription({ id: "jd-1", organizationId: "org-1" });
    expect(r).toBeNull();
    expect(mockDb.jobDescription.findFirst).toHaveBeenCalledWith({
      where: { id: "jd-1", organizationId: "org-1" },
    });
  });
});

describe("updateJobDescription", () => {
  it("re-resolves location on update", async () => {
    mockDb.jobDescription.update.mockResolvedValue({ id: "jd-1" });
    await updateJobDescription({
      id: "jd-1",
      organizationId: "org-1",
      input: { ...baseInput, locationRaw: "Lombardia" },
    });
    expect(mockDb.jobDescription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id_organizationId: { id: "jd-1", organizationId: "org-1" } },
        data: expect.objectContaining({
          locationRaw: "Lombardia",
          locationRegion: "Lombardia",
          locationProvince: null,
          locationMunicipality: null,
        }),
      })
    );
  });
});

describe("deleteJobDescription", () => {
  it("scopes delete by org", async () => {
    mockDb.jobDescription.delete.mockResolvedValue({ id: "jd-1" });
    await deleteJobDescription({ id: "jd-1", organizationId: "org-1" });
    expect(mockDb.jobDescription.delete).toHaveBeenCalledWith({
      where: { id_organizationId: { id: "jd-1", organizationId: "org-1" } },
    });
  });
});
```

Note on the compound where: Prisma generates `id_organizationId` when we define a compound unique on `[id, organizationId]`. We'll add that unique in a follow-up micro-step since our schema only has `@@unique([organizationId, name])`. Use `where: { id, organizationId }` via `updateMany`/`deleteMany` instead, so we avoid schema gymnastics.

- [ ] **Step 2: Adjust approach before running**

`update` and `delete` on Prisma require a unique `where`. Since we don't have a compound unique `[id, organizationId]`, use `updateMany` / `deleteMany` (which accept non-unique filters), asserting `count === 1`, and translate to a `NotFoundError`. Replace the `update` and `delete` test expectations accordingly:

```typescript
describe("updateJobDescription", () => {
  it("re-resolves location and scopes update by org", async () => {
    mockDb.jobDescription.updateMany = vi.fn().mockResolvedValue({ count: 1 });
    await updateJobDescription({
      id: "jd-1",
      organizationId: "org-1",
      input: { ...baseInput, locationRaw: "Lombardia" },
    });
    expect(mockDb.jobDescription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "jd-1", organizationId: "org-1" },
        data: expect.objectContaining({
          locationRaw: "Lombardia",
          locationRegion: "Lombardia",
          locationProvince: null,
          locationMunicipality: null,
        }),
      })
    );
  });
});

describe("deleteJobDescription", () => {
  it("scopes delete by org and throws NotFound on 0 count", async () => {
    mockDb.jobDescription.deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const { JobNotFoundError } = await import("@/lib/jobs/service");
    await expect(deleteJobDescription({ id: "jd-1", organizationId: "org-1" }))
      .rejects.toBeInstanceOf(JobNotFoundError);
  });
});
```

- [ ] **Step 3: Run tests (expect failure)**

Run: `pnpm test -- src/__tests__/lib/jobs/service.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement the service**

Create `src/lib/jobs/service.ts`:

```typescript
import { db } from "@/lib/db";
import { resolveLocation } from "@/lib/geo/resolve";
import type { JobDescriptionInput } from "@/lib/validations/job-description";

export class JobNameAlreadyExistsError extends Error {
  constructor() {
    super("Esiste già un'offerta di lavoro con questo nome");
    this.name = "JobNameAlreadyExistsError";
  }
}

export class JobNotFoundError extends Error {
  constructor() {
    super("Offerta di lavoro non trovata");
    this.name = "JobNotFoundError";
  }
}

function resolveAndSpread(locationRaw: string) {
  const r = resolveLocation(locationRaw);
  return {
    locationRaw,
    locationMunicipality: r.municipality ?? null,
    locationProvince: r.province ?? null,
    locationRegion: r.region ?? null,
  };
}

export async function createJobDescription(params: {
  input: JobDescriptionInput;
  organizationId: string;
  userId: string;
}) {
  const { input, organizationId, userId } = params;
  try {
    return await db.jobDescription.create({
      data: {
        organizationId,
        createdByUserId: userId,
        name: input.name,
        description: input.description,
        skills: input.skills,
        ...resolveAndSpread(input.locationRaw),
      },
    });
  } catch (e: unknown) {
    if (isPrismaCode(e, "P2002")) throw new JobNameAlreadyExistsError();
    throw e;
  }
}

export async function listJobDescriptions(params: { organizationId: string }) {
  return db.jobDescription.findMany({
    where: { organizationId: params.organizationId },
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { name: true } } },
  });
}

export async function getJobDescription(params: { id: string; organizationId: string }) {
  return db.jobDescription.findFirst({
    where: { id: params.id, organizationId: params.organizationId },
  });
}

export async function updateJobDescription(params: {
  id: string;
  organizationId: string;
  input: JobDescriptionInput;
}) {
  const { id, organizationId, input } = params;
  try {
    const result = await db.jobDescription.updateMany({
      where: { id, organizationId },
      data: {
        name: input.name,
        description: input.description,
        skills: input.skills,
        ...resolveAndSpread(input.locationRaw),
      },
    });
    if (result.count === 0) throw new JobNotFoundError();
    return result;
  } catch (e: unknown) {
    if (isPrismaCode(e, "P2002")) throw new JobNameAlreadyExistsError();
    throw e;
  }
}

export async function deleteJobDescription(params: { id: string; organizationId: string }) {
  const result = await db.jobDescription.deleteMany({
    where: { id: params.id, organizationId: params.organizationId },
  });
  if (result.count === 0) throw new JobNotFoundError();
  return result;
}

export async function listAllJobDescriptionsForAdmin() {
  return db.jobDescription.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      organization: { select: { name: true, slug: true } },
      createdBy: { select: { name: true } },
    },
  });
}

function isPrismaCode(e: unknown, code: string): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code: unknown }).code === code;
}
```

- [ ] **Step 5: Run tests (expect pass)**

Run: `pnpm test -- src/__tests__/lib/jobs/service.test.ts`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/jobs/service.ts src/__tests__/lib/jobs/service.test.ts
git commit -m "feat(jobs): JD service layer with org scoping and error mapping"
```

---

## Task 6: Install stemmer dep + token utilities

**Files:**
- Modify: `package.json`
- Create: `src/lib/jobs/matcher/tokens.ts`
- Test: `src/__tests__/lib/jobs/matcher/tokens.test.ts`

- [ ] **Step 1: Install dependency**

Run:
```bash
pnpm add snowball-stemmer
```

Expected: `package.json` and `pnpm-lock.yaml` updated.

- [ ] **Step 2: Write failing tests**

Create `src/__tests__/lib/jobs/matcher/tokens.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { normalize, tokenize, stem, tokenSet } from "@/lib/jobs/matcher/tokens";

describe("normalize", () => {
  it("lowercases and strips accents and punctuation", () => {
    expect(normalize("  Città! di Castello? ")).toBe("citta di castello");
  });
});

describe("tokenize", () => {
  it("splits on whitespace after normalize", () => {
    expect(tokenize("  Cameriere/Barista ")).toEqual(["cameriere", "barista"]);
  });

  it("removes Italian stopwords", () => {
    expect(tokenize("il lavoro di cameriere per una azienda")).not.toContain("il");
    expect(tokenize("il lavoro di cameriere per una azienda")).toContain("cameriere");
  });

  it("drops tokens shorter than 2 chars", () => {
    expect(tokenize("a lavoro")).toEqual(["lavoro"]);
  });
});

describe("stem", () => {
  it("stems Italian words to a common form", () => {
    const a = stem("pulizie");
    const b = stem("pulizia");
    const c = stem("pulire");
    expect(a).toBe(b);
    // At minimum a/b share the root; c may differ but should still be short.
    expect(c.length).toBeGreaterThan(0);
  });
});

describe("tokenSet", () => {
  it("produces a set of stemmed tokens", () => {
    const s = tokenSet("Pulizie di uffici, cameriere di sala");
    expect(s.has(stem("pulizie"))).toBe(true);
    expect(s.has(stem("cameriere"))).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests (expect failure)**

Run: `pnpm test -- src/__tests__/lib/jobs/matcher/tokens.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement tokens**

Create `src/lib/jobs/matcher/tokens.ts`:

```typescript
// @ts-expect-error — snowball-stemmer ships no types for the Italian stemmer
import { newStemmer } from "snowball-stemmer";

const italianStemmer = newStemmer("italian");

const STOPWORDS_IT = new Set([
  "il","lo","la","i","gli","le","un","uno","una","di","a","da","in","con","su","per","tra","fra",
  "e","o","ma","che","chi","cui","non","si","ne","ci","vi","ho","hai","ha","abbiamo","avete","hanno",
  "sono","sei","è","siamo","siete","essere","stato","stata","stati","state",
  "questo","questa","questi","queste","quel","quello","quella","quelli","quelle",
  "se","come","più","meno","molto","poco","anche","solo","già","ancora","mai","sempre","ogni",
  "altro","altra","altri","altre","stesso","stessa","stessi","stesse","tutto","tutta","tutti","tutte",
  "del","dello","della","dei","degli","delle","al","allo","alla","ai","agli","alle",
  "dal","dallo","dalla","dai","dagli","dalle","nel","nello","nella","nei","negli","nelle",
  "sul","sullo","sulla","sui","sugli","sulle","col","coi",
]);

export function normalize(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(input: string): string[] {
  const norm = normalize(input);
  if (!norm) return [];
  return norm
    .split(" ")
    .filter((t) => t.length >= 2)
    .filter((t) => !STOPWORDS_IT.has(t));
}

export function stem(word: string): string {
  return italianStemmer.stem(word);
}

export function tokenSet(input: string): Set<string> {
  return new Set(tokenize(input).map(stem));
}
```

- [ ] **Step 5: Run tests (expect pass)**

Run: `pnpm test -- src/__tests__/lib/jobs/matcher/tokens.test.ts`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/jobs/matcher/tokens.ts src/__tests__/lib/jobs/matcher/tokens.test.ts
git commit -m "feat(jobs): Italian tokenization + stemming utilities"
```

---

## Task 7: Synonym dictionary + expander

**Files:**
- Create: `src/lib/jobs/matcher/synonyms.ts`
- Test: `src/__tests__/lib/jobs/matcher/synonyms.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/lib/jobs/matcher/synonyms.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { expandTokens } from "@/lib/jobs/matcher/synonyms";
import { stem } from "@/lib/jobs/matcher/tokens";

describe("expandTokens", () => {
  it("expands a term to its synonyms (post-stem)", () => {
    const s = expandTokens(new Set([stem("cleaning")]));
    expect(s.has(stem("pulizie"))).toBe(true);
    expect(s.has(stem("addetto"))).toBe(true);
  });

  it("expands Italian to English equivalents", () => {
    const s = expandTokens(new Set([stem("cameriere")]));
    expect(s.has(stem("waiter"))).toBe(true);
  });

  it("returns the original set unchanged when no synonyms apply", () => {
    const s = expandTokens(new Set([stem("quantistica")]));
    expect(s.size).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests (expect failure)**

Run: `pnpm test -- src/__tests__/lib/jobs/matcher/synonyms.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement synonyms**

Create `src/lib/jobs/matcher/synonyms.ts`:

```typescript
import { stem } from "./tokens";

// Bilingual Italian ↔ English synonym groups. Each group is a cluster of
// stems that should be considered equivalent for matching purposes.
// Keep this conservative — false positives degrade match quality.
const RAW_GROUPS: string[][] = [
  ["cameriere", "cameriera", "waiter", "waitress", "server"],
  ["barista", "bartender", "barman", "barwoman"],
  ["cuoco", "cuoca", "chef", "cook", "kitchen"],
  ["lavapiatti", "dishwasher"],
  ["pulizie", "pulizia", "pulire", "cleaning", "cleaner", "addetto", "addetta"],
  ["magazziniere", "magazziniera", "warehouse", "magazzino", "stockroom"],
  ["mulettista", "forklift"],
  ["receptionist", "reception", "accoglienza"],
  ["autista", "driver", "conducente"],
  ["operatore", "operator", "staff", "personale"],
  ["vendita", "sales", "commesso", "commessa", "shop"],
  ["manutenzione", "maintenance"],
  ["edile", "edilizia", "construction", "muratore"],
  ["giardinaggio", "giardiniere", "gardening", "gardener"],
  ["badante", "caregiver"],
  ["infermiere", "infermiera", "nurse", "nursing"],
  ["sicurezza", "security", "vigilante", "guardia"],
  ["logistica", "logistics"],
  ["cucina", "cucinare", "cooking"],
];

const groups: Set<string>[] = RAW_GROUPS.map((g) => new Set(g.map(stem)));
const stemToGroup = new Map<string, Set<string>>();
for (const g of groups) {
  for (const s of g) stemToGroup.set(s, g);
}

export function expandTokens(stems: Set<string>): Set<string> {
  const out = new Set(stems);
  for (const s of stems) {
    const g = stemToGroup.get(s);
    if (g) for (const t of g) out.add(t);
  }
  return out;
}
```

- [ ] **Step 4: Run tests (expect pass)**

Run: `pnpm test -- src/__tests__/lib/jobs/matcher/synonyms.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/matcher/synonyms.ts src/__tests__/lib/jobs/matcher/synonyms.test.ts
git commit -m "feat(jobs): bilingual synonym dictionary for matcher"
```

---

## Task 8: Skills, description, location sub-scorers + composite

**Files:**
- Create: `src/lib/jobs/matcher/skills.ts`
- Create: `src/lib/jobs/matcher/description.ts`
- Create: `src/lib/jobs/matcher/location.ts`
- Create: `src/lib/jobs/matcher/config.ts`
- Create: `src/lib/jobs/matcher/index.ts`
- Test: `src/__tests__/lib/jobs/matcher/skills.test.ts`
- Test: `src/__tests__/lib/jobs/matcher/description.test.ts`
- Test: `src/__tests__/lib/jobs/matcher/location.test.ts`
- Test: `src/__tests__/lib/jobs/matcher/index.test.ts`

- [ ] **Step 1: Write failing tests — skills**

Create `src/__tests__/lib/jobs/matcher/skills.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { skillsScore } from "@/lib/jobs/matcher/skills";

describe("skillsScore", () => {
  it("returns 1.0 when all JD skills appear in candidate text", () => {
    const score = skillsScore({
      jdSkills: ["pulizie", "attenzione ai dettagli"],
      candidate: {
        skillsAndCompetences: ["pulizia", "attenzione al dettaglio"],
        workExperience: [],
        desiredJob: "",
      },
    });
    expect(score).toBeGreaterThan(0.8);
  });

  it("returns 0 when candidate has nothing in common", () => {
    const score = skillsScore({
      jdSkills: ["pulizie"],
      candidate: { skillsAndCompetences: ["finanza"], workExperience: [], desiredJob: "" },
    });
    expect(score).toBe(0);
  });

  it("uses synonym expansion (cleaning ↔ pulizie)", () => {
    const score = skillsScore({
      jdSkills: ["cleaning"],
      candidate: {
        skillsAndCompetences: [],
        workExperience: ["Operatore pulizie industriali"],
        desiredJob: "",
      },
    });
    expect(score).toBeGreaterThan(0.3);
  });

  it("matches the PRD example: 'Cleaning Staff' JD vs 'cleaning operator' candidate", () => {
    const score = skillsScore({
      jdSkills: [
        "conoscenza prodotti e tecniche di pulizia",
        "uso attrezzature",
        "precisione",
        "affidabilità",
      ],
      candidate: {
        skillsAndCompetences: ["pulizie", "precisione"],
        workExperience: ["Addetto pulizie in ambiente industriale"],
        desiredJob: "Cleaning operator",
      },
    });
    expect(score).toBeGreaterThan(0.3);
  });

  it("returns 0 when JD skills list is empty", () => {
    const score = skillsScore({
      jdSkills: [],
      candidate: { skillsAndCompetences: ["x"], workExperience: [], desiredJob: "" },
    });
    expect(score).toBe(0);
  });
});
```

- [ ] **Step 2: Write failing tests — description**

Create `src/__tests__/lib/jobs/matcher/description.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { descriptionScore } from "@/lib/jobs/matcher/description";

describe("descriptionScore", () => {
  it("matches when description keywords appear in candidate profile", () => {
    const score = descriptionScore({
      jdDescription: "Cerchiamo personale per pulizie e sanificazione di ambienti industriali.",
      candidate: {
        skillsAndCompetences: ["pulizie"],
        workExperience: ["Addetto alla sanificazione"],
        desiredJob: "operatore pulizie",
      },
    });
    expect(score).toBeGreaterThan(0.3);
  });

  it("returns 0 for totally unrelated descriptions", () => {
    const score = descriptionScore({
      jdDescription: "Sviluppatore React con esperienza backend.",
      candidate: {
        skillsAndCompetences: ["pulizie"],
        workExperience: ["Addetto pulizie"],
        desiredJob: "cameriere",
      },
    });
    expect(score).toBeLessThan(0.15);
  });

  it("returns 0 when JD description has no meaningful tokens", () => {
    const score = descriptionScore({
      jdDescription: "il la di",
      candidate: {
        skillsAndCompetences: ["pulizie"],
        workExperience: [],
        desiredJob: "",
      },
    });
    expect(score).toBe(0);
  });
});
```

- [ ] **Step 3: Write failing tests — location**

Create `src/__tests__/lib/jobs/matcher/location.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { locationScore } from "@/lib/jobs/matcher/location";

describe("locationScore", () => {
  it("1.0 for same municipality", () => {
    expect(locationScore({
      jd: { municipality: "Milano", province: "Milano", region: "Lombardia" },
      candidateLocation: "Milano",
    })).toBe(1.0);
  });

  it("0.8 when candidate city is in the same province", () => {
    expect(locationScore({
      jd: { municipality: "Milano", province: "Milano", region: "Lombardia" },
      candidateLocation: "Sesto San Giovanni",
    })).toBeCloseTo(0.8);
  });

  it("0.6 when candidate says the region only", () => {
    expect(locationScore({
      jd: { municipality: "Milano", province: "Milano", region: "Lombardia" },
      candidateLocation: "Lombardia",
    })).toBeCloseTo(0.6);
  });

  it("0.6 when JD is at region level and candidate is a city inside it", () => {
    expect(locationScore({
      jd: { region: "Lombardia" },
      candidateLocation: "Milano",
    })).toBeCloseTo(0.6);
  });

  it("0 when regions differ", () => {
    expect(locationScore({
      jd: { municipality: "Milano", province: "Milano", region: "Lombardia" },
      candidateLocation: "Napoli",
    })).toBe(0);
  });

  it("0.5 (neutral) when candidate location is unresolved", () => {
    expect(locationScore({
      jd: { municipality: "Milano", province: "Milano", region: "Lombardia" },
      candidateLocation: "Atlantide",
    })).toBe(0.5);
  });

  it("0.5 (neutral) when JD location is unresolved at every level", () => {
    expect(locationScore({
      jd: {},
      candidateLocation: "Milano",
    })).toBe(0.5);
  });
});
```

- [ ] **Step 4: Run all failing tests**

Run: `pnpm test -- src/__tests__/lib/jobs/matcher/`
Expected: all three new test files FAIL (module not found).

- [ ] **Step 5: Implement config**

Create `src/lib/jobs/matcher/config.ts`:

```typescript
export const MATCHER_CONFIG = {
  weights: {
    skills: 0.4,
    description: 0.3,
    location: 0.3,
  },
  displayThreshold: 30, // out of 100
  fallbackTopN: 10,
  maxResults: 50,
} as const;
```

- [ ] **Step 6: Implement skills sub-scorer**

Create `src/lib/jobs/matcher/skills.ts`:

```typescript
import { tokenSet } from "./tokens";
import { expandTokens } from "./synonyms";

interface CandidateSlice {
  skillsAndCompetences: string[];
  workExperience: string[];
  desiredJob: string;
}

export function skillsScore(params: {
  jdSkills: string[];
  candidate: CandidateSlice;
}): number {
  const { jdSkills, candidate } = params;
  if (jdSkills.length === 0) return 0;

  const jdStems = expandTokens(tokenSet(jdSkills.join(" ")));
  if (jdStems.size === 0) return 0;

  const candidateText = [
    ...candidate.skillsAndCompetences,
    ...candidate.workExperience,
    candidate.desiredJob,
  ].join(" ");
  const candStems = expandTokens(tokenSet(candidateText));
  if (candStems.size === 0) return 0;

  let hit = 0;
  for (const s of jdStems) if (candStems.has(s)) hit++;
  return hit / jdStems.size;
}
```

- [ ] **Step 7: Implement description sub-scorer**

Create `src/lib/jobs/matcher/description.ts`:

```typescript
import { tokenize, stem } from "./tokens";
import { expandTokens } from "./synonyms";

interface CandidateSlice {
  skillsAndCompetences: string[];
  workExperience: string[];
  desiredJob: string;
}

export function descriptionScore(params: {
  jdDescription: string;
  candidate: CandidateSlice;
}): number {
  const jdStems = new Set(tokenize(params.jdDescription).map(stem));
  if (jdStems.size === 0) return 0;

  const candText = [
    ...params.candidate.skillsAndCompetences,
    ...params.candidate.workExperience,
    params.candidate.desiredJob,
  ].join(" ");
  const candStems = expandTokens(new Set(tokenize(candText).map(stem)));
  if (candStems.size === 0) return 0;

  let hit = 0;
  for (const s of jdStems) if (candStems.has(s)) hit++;
  return hit / jdStems.size;
}
```

- [ ] **Step 8: Implement location sub-scorer**

Create `src/lib/jobs/matcher/location.ts`:

```typescript
import { resolveLocation } from "@/lib/geo/resolve";

interface JdLocation {
  municipality?: string | null;
  province?: string | null;
  region?: string | null;
}

export function locationScore(params: {
  jd: JdLocation;
  candidateLocation: string;
}): number {
  const { jd, candidateLocation } = params;
  const jdResolved: JdLocation = {
    municipality: jd.municipality ?? undefined,
    province: jd.province ?? undefined,
    region: jd.region ?? undefined,
  };
  if (!jdResolved.municipality && !jdResolved.province && !jdResolved.region) return 0.5;

  if (!candidateLocation?.trim()) return 0.5;
  const cand = resolveLocation(candidateLocation);
  if (cand.confidence === "none") return 0.5;

  if (jdResolved.municipality && cand.municipality && jdResolved.municipality === cand.municipality) return 1.0;
  if (jdResolved.province && cand.province && jdResolved.province === cand.province) return 0.8;
  if (jdResolved.region && cand.region && jdResolved.region === cand.region) return 0.6;
  return 0.0;
}
```

- [ ] **Step 9: Run sub-scorer tests**

Run: `pnpm test -- src/__tests__/lib/jobs/matcher/`
Expected: skills, description, and location tests pass.

- [ ] **Step 10: Write composite tests**

Create `src/__tests__/lib/jobs/matcher/index.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeMatch, rankCandidates } from "@/lib/jobs/matcher";
import type { Candidate } from "@/types";

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  const base: Candidate = {
    id: "1",
    firstName: "Test",
    lastName: "Candidate",
    dateOfBirth: "",
    countryOfOrigin: "",
    address: "",
    phone: "",
    legalStatus: "",
    workingPermit: "",
    meanOfTransport: "",
    educationAndTraining: [],
    workExperience: [],
    skillsAndCompetences: [],
    languages: { language: "", additionalLanguages: [] },
    drivingLicense: "",
    jobPreferences: {
      desiredJob: "",
      partTimePreference: false,
      preferredLocation: "",
      constraints: "",
      hasDesiredJobExperience: "",
    },
    centroPerImpiego: "",
    interviewLanguage: "",
    sourceOrganization: "",
    channel: "telegram",
    consent: false,
    cvPdfLink: "",
    cvDocLink: "",
    createdAt: new Date("2026-04-01"),
    updatedAt: new Date("2026-04-01"),
  };
  return { ...base, ...overrides };
}

const jd = {
  name: "Addetto pulizie",
  description: "Azienda di pulizie cerca personale per sanificare ambienti residenziali e industriali. Richiesta precisione e affidabilità.",
  skills: [
    "Conoscenza prodotti e tecniche di pulizia",
    "Precisione e attenzione ai dettagli",
    "Affidabilità e puntualità",
  ],
  locationMunicipality: "Milano",
  locationProvince: "Milano",
  locationRegion: "Lombardia",
};

describe("computeMatch", () => {
  it("returns high score for PRD example (cleaning operator in Lombardia)", () => {
    const cand = makeCandidate({
      skillsAndCompetences: ["pulizie", "precisione"],
      workExperience: ["Addetto pulizie in ambiente industriale"],
      jobPreferences: {
        desiredJob: "cleaning operator",
        partTimePreference: false,
        preferredLocation: "Lombardia",
        constraints: "",
        hasDesiredJobExperience: "",
      },
    });

    const result = computeMatch(jd, cand);
    expect(result.final).toBeGreaterThanOrEqual(55);
    expect(result.breakdown.skills).toBeGreaterThan(0);
    expect(result.breakdown.location).toBeCloseTo(0.6);
  });

  it("returns low score for unrelated candidate", () => {
    const cand = makeCandidate({
      skillsAndCompetences: ["finanza", "excel"],
      workExperience: ["Analista finanziario"],
      jobPreferences: {
        desiredJob: "controller",
        partTimePreference: false,
        preferredLocation: "Napoli",
        constraints: "",
        hasDesiredJobExperience: "",
      },
    });
    const result = computeMatch(jd, cand);
    expect(result.final).toBeLessThan(30);
  });
});

describe("rankCandidates", () => {
  it("returns sorted top N above threshold", () => {
    const candidates = [
      makeCandidate({ id: "good", skillsAndCompetences: ["pulizie", "precisione"], jobPreferences: { desiredJob: "addetto pulizie", partTimePreference: false, preferredLocation: "Milano", constraints: "", hasDesiredJobExperience: "" } }),
      makeCandidate({ id: "meh", skillsAndCompetences: ["magazziniere"] }),
      makeCandidate({ id: "bad", skillsAndCompetences: ["finanza"], jobPreferences: { desiredJob: "controller", partTimePreference: false, preferredLocation: "Napoli", constraints: "", hasDesiredJobExperience: "" } }),
    ];
    const ranked = rankCandidates(jd, candidates);
    expect(ranked[0].candidate.id).toBe("good");
    expect(ranked.map((r) => r.candidate.id)).not.toContain("bad");
  });

  it("falls back to top 10 when nothing clears threshold", () => {
    const candidates = Array.from({ length: 5 }, (_, i) =>
      makeCandidate({ id: String(i), skillsAndCompetences: ["finanza"] })
    );
    const ranked = rankCandidates(jd, candidates);
    expect(ranked.length).toBe(5);
    expect(ranked.every((r) => r.isFallback === true)).toBe(true);
  });
});
```

- [ ] **Step 11: Implement composite matcher**

Create `src/lib/jobs/matcher/index.ts`:

```typescript
import type { Candidate } from "@/types";
import { MATCHER_CONFIG } from "./config";
import { skillsScore } from "./skills";
import { descriptionScore } from "./description";
import { locationScore } from "./location";

export interface JdForMatching {
  description: string;
  skills: string[];
  locationMunicipality?: string | null;
  locationProvince?: string | null;
  locationRegion?: string | null;
}

export interface MatchResult {
  final: number;
  breakdown: {
    skills: number;
    description: number;
    location: number;
  };
}

export function computeMatch(jd: JdForMatching, c: Candidate): MatchResult {
  const slice = {
    skillsAndCompetences: c.skillsAndCompetences,
    workExperience: c.workExperience,
    desiredJob: c.jobPreferences.desiredJob,
  };
  const candidateLoc = c.jobPreferences.preferredLocation || c.address;
  const breakdown = {
    skills: skillsScore({ jdSkills: jd.skills, candidate: slice }),
    description: descriptionScore({ jdDescription: jd.description, candidate: slice }),
    location: locationScore({
      jd: {
        municipality: jd.locationMunicipality,
        province: jd.locationProvince,
        region: jd.locationRegion,
      },
      candidateLocation: candidateLoc,
    }),
  };
  const w = MATCHER_CONFIG.weights;
  const final = Math.round(
    100 * (w.skills * breakdown.skills + w.description * breakdown.description + w.location * breakdown.location)
  );
  return { final, breakdown };
}

export interface RankedCandidate {
  candidate: Candidate;
  match: MatchResult;
  isFallback: boolean;
}

export function rankCandidates(jd: JdForMatching, candidates: Candidate[]): RankedCandidate[] {
  const scored = candidates
    .map((c) => ({ candidate: c, match: computeMatch(jd, c) }))
    .sort((a, b) => b.match.final - a.match.final);

  const aboveThreshold = scored.filter((s) => s.match.final >= MATCHER_CONFIG.displayThreshold);
  if (aboveThreshold.length > 0) {
    return aboveThreshold
      .slice(0, MATCHER_CONFIG.maxResults)
      .map((s) => ({ ...s, isFallback: false }));
  }
  return scored
    .slice(0, MATCHER_CONFIG.fallbackTopN)
    .map((s) => ({ ...s, isFallback: true }));
}
```

- [ ] **Step 12: Run all matcher tests**

Run: `pnpm test -- src/__tests__/lib/jobs/matcher/`
Expected: all tests pass across all four files.

- [ ] **Step 13: Commit**

```bash
git add src/lib/jobs/matcher/ src/__tests__/lib/jobs/matcher/
git commit -m "feat(jobs): matching engine — skills, description, location, composite"
```

---

## Task 9: Italian UI copy

**Files:**
- Modify: `src/lib/i18n/strings.ts`

- [ ] **Step 1: Inspect the existing structure**

Run: `cat src/lib/i18n/strings.ts`. Confirm there's an existing `strings` object with `common`, `pages`, `nav` keys.

- [ ] **Step 2: Add the new entries**

Modify `src/lib/i18n/strings.ts` to add job-related copy. Append inside the existing exports:

```typescript
// Inside strings.nav (add key)
jobs: "Offerte di lavoro",

// Inside strings.pages (add key)
jobs: "Offerte di lavoro",
jobNew: "Nuova offerta di lavoro",
jobEdit: "Modifica offerta di lavoro",

// Add a new sub-object under strings
jobs: {
  listEmpty: "Nessuna offerta di lavoro",
  listEmptyHint: "Crea la tua prima offerta per iniziare a ricevere match con i candidati.",
  addButton: "+ Aggiungi offerta",
  fieldName: "Nome",
  fieldLocation: "Località",
  fieldDescription: "Descrizione",
  fieldSkills: "Competenze",
  skillPlaceholder: "Aggiungi una competenza e premi Invio",
  createButton: "Crea offerta",
  updateButton: "Salva modifiche",
  deleteButton: "Elimina",
  deleteConfirmTitle: "Eliminare l'offerta?",
  deleteConfirmBody: "Questa azione non può essere annullata.",
  matchHeading: "Candidati consigliati",
  matchEmpty: "Nessun candidato supera la soglia minima di corrispondenza.",
  matchFallback: "Nessun candidato ad alta corrispondenza. Mostriamo comunque i primi risultati.",
  refreshMatches: "Ricalcola",
  score: "Score",
  lowMatchTag: "Bassa corrispondenza",
  notFound: "Offerta non trovata",
  uniqueNameError: "Esiste già un'offerta con questo nome.",
},
```

Place them in the appropriate nested spots. Save.

- [ ] **Step 3: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no new errors related to `strings`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/i18n/strings.ts
git commit -m "chore(i18n): Italian copy for job descriptions"
```

---

## Task 10: `SkillsInput` component

**Files:**
- Create: `src/components/jobs/skills-input.tsx`

No unit tests — we'll rely on typecheck + manual QA in the form task.

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { strings } from "@/lib/i18n/strings";

interface SkillsInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  name?: string;
}

export function SkillsInput({ value, onChange, name }: SkillsInputProps) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (value.includes(trimmed)) {
      setDraft("");
      return;
    }
    onChange([...value, trimmed]);
    setDraft("");
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const remove = (skill: string) => onChange(value.filter((s) => s !== skill));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {value.map((skill) => (
          <Badge key={skill} variant="secondary" className="gap-1 pr-1">
            {skill}
            <button
              type="button"
              onClick={() => remove(skill)}
              className="rounded-full p-0.5 hover:bg-muted"
              aria-label={`Rimuovi ${skill}`}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={commit}
        placeholder={strings.jobs.skillPlaceholder}
      />
      {/* Hidden field for native form submission as JSON */}
      {name && <input type="hidden" name={name} value={JSON.stringify(value)} />}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/jobs/skills-input.tsx
git commit -m "feat(jobs): skills chip-input component"
```

---

## Task 11: `LocationCombobox` component

**Files:**
- Create: `src/components/jobs/location-combobox.tsx`

- [ ] **Step 1: Create a lightweight autocomplete (no shadcn Combobox dependency required)**

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { ITALY_ADMIN } from "@/lib/geo/italy-admin";
import { normalizePlace } from "@/lib/geo/resolve";

interface LocationComboboxProps {
  name: string;
  defaultValue?: string;
  placeholder?: string;
}

// Flatten dataset into unique searchable labels.
const ALL_LABELS: string[] = (() => {
  const set = new Set<string>();
  for (const row of ITALY_ADMIN) {
    set.add(row.municipality);
    set.add(row.province);
    set.add(row.region);
  }
  return [...set].sort();
})();

export function LocationCombobox({ name, defaultValue = "", placeholder }: LocationComboboxProps) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => {
    const q = normalizePlace(value);
    if (!q) return [];
    return ALL_LABELS.filter((l) => normalizePlace(l).startsWith(q)).slice(0, 8);
  }, [value]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={wrapRef} className="relative">
      <Input
        name={name}
        value={value}
        onChange={(e) => { setValue(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-md">
          {suggestions.map((s) => (
            <li key={s}>
              <button
                type="button"
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() => { setValue(s); setOpen(false); }}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/jobs/location-combobox.tsx
git commit -m "feat(jobs): location autocomplete over Italian admin dataset"
```

---

## Task 12: Shared `JobForm` component

**Files:**
- Create: `src/components/jobs/job-form.tsx`

- [ ] **Step 1: Create the form**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { strings } from "@/lib/i18n/strings";
import { SkillsInput } from "./skills-input";
import { LocationCombobox } from "./location-combobox";

type FormState =
  | { ok: true }
  | { ok: false; error: string }
  | null;

interface JobFormProps {
  mode: "create" | "edit";
  initial?: {
    name: string;
    locationRaw: string;
    description: string;
    skills: string[];
  };
  action: (formData: FormData) => Promise<FormState>;
}

export function JobForm({ mode, initial, action }: JobFormProps) {
  const [skills, setSkills] = useState<string[]>(initial?.skills ?? []);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    form.set("skills", JSON.stringify(skills));
    startTransition(async () => {
      const result = await action(form);
      if (result && result.ok === false) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6 max-w-2xl">
      <div className="space-y-2">
        <Label htmlFor="name">{strings.jobs.fieldName}</Label>
        <Input id="name" name="name" defaultValue={initial?.name} required maxLength={120} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="locationRaw">{strings.jobs.fieldLocation}</Label>
        <LocationCombobox
          name="locationRaw"
          defaultValue={initial?.locationRaw ?? ""}
          placeholder="es. Milano, Lombardia"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">{strings.jobs.fieldDescription}</Label>
        <Textarea
          id="description"
          name="description"
          defaultValue={initial?.description}
          rows={8}
          minLength={20}
          maxLength={5000}
          required
        />
      </div>

      <div className="space-y-2">
        <Label>{strings.jobs.fieldSkills}</Label>
        <SkillsInput value={skills} onChange={setSkills} />
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {mode === "create" ? strings.jobs.createButton : strings.jobs.updateButton}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Annulla
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Verify shadcn textarea/label components exist**

Run:
```bash
ls src/components/ui/textarea.tsx src/components/ui/label.tsx
```

If either is missing, add it from shadcn:
```bash
pnpm dlx shadcn@latest add textarea label
```

- [ ] **Step 3: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/jobs/job-form.tsx src/components/ui/
git commit -m "feat(jobs): shared create/edit form component"
```

---

## Task 13: Create page + server action

**Files:**
- Create: `src/app/(dashboard)/dashboard/jobs/actions.ts`
- Create: `src/app/(dashboard)/dashboard/jobs/new/page.tsx`

- [ ] **Step 1: Implement the create server action**

Create `src/app/(dashboard)/dashboard/jobs/actions.ts`:

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { jobDescriptionInputSchema } from "@/lib/validations/job-description";
import { createJobDescription, JobNameAlreadyExistsError } from "@/lib/jobs/service";

type ActionResult = { ok: true; id: string } | { ok: false; error: string };

export async function createJobAction(formData: FormData): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.organizationId || session.user.role !== "ORG_ADMIN") {
    return { ok: false, error: "Non autorizzato" };
  }

  const parsed = jobDescriptionInputSchema.safeParse({
    name: formData.get("name"),
    locationRaw: formData.get("locationRaw"),
    description: formData.get("description"),
    skills: JSON.parse((formData.get("skills") as string) || "[]"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dati non validi" };
  }

  try {
    const jd = await createJobDescription({
      input: parsed.data,
      organizationId: session.user.organizationId,
      userId: session.user.id,
    });
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        organizationId: session.user.organizationId,
        action: "create",
        resourceType: "JobDescription",
        resourceId: jd.id,
      },
    });
    revalidatePath("/dashboard/jobs");
    redirect(`/dashboard/jobs/${jd.id}`);
  } catch (e) {
    if (e instanceof JobNameAlreadyExistsError) return { ok: false, error: e.message };
    throw e;
  }
}
```

Note: `redirect()` throws; the function won't return to the caller. TypeScript is OK with this because `redirect` is typed as `never`.

- [ ] **Step 2: Implement the create page**

Create `src/app/(dashboard)/dashboard/jobs/new/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { strings } from "@/lib/i18n/strings";
import { JobForm } from "@/components/jobs/job-form";
import { createJobAction } from "../actions";

export default async function NewJobPage() {
  const session = await auth();
  if (!session?.user?.organizationId) redirect("/login");
  if (session.user.role !== "ORG_ADMIN") redirect("/dashboard/jobs");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl tracking-tight">{strings.pages.jobNew}</h1>
      <JobForm mode="create" action={createJobAction} />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no new errors (ignore existing test file errors from the earlier session).

- [ ] **Step 4: Manual verification**

Run: `pnpm dev` (if not already running). Log in as an ORG_ADMIN. Visit `/dashboard/jobs/new`. Fill the form. Verify you're redirected to `/dashboard/jobs/[id]`.

(The detail page doesn't exist yet — expect a 404 after create. That's OK; we'll build it next.)

- [ ] **Step 5: Commit**

```bash
git add src/app/\(dashboard\)/dashboard/jobs/
git commit -m "feat(jobs): create page with Zod-validated server action"
```

---

## Task 14: List page

**Files:**
- Create: `src/app/(dashboard)/dashboard/jobs/page.tsx`

- [ ] **Step 1: Implement the list page**

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { Briefcase, Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { strings } from "@/lib/i18n/strings";
import { listJobDescriptions } from "@/lib/jobs/service";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default async function JobsPage() {
  const session = await auth();
  if (!session?.user?.organizationId) redirect("/login");
  const isAdmin = session.user.role === "ORG_ADMIN";

  const jobs = await listJobDescriptions({ organizationId: session.user.organizationId });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl tracking-tight">{strings.pages.jobs}</h1>
      </div>

      {jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-12 text-center">
          <Briefcase className="h-12 w-12 text-muted-foreground/50" />
          <h2 className="mt-4 text-lg font-medium text-muted-foreground">
            {strings.jobs.listEmpty}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground/75">{strings.jobs.listEmptyHint}</p>
          {isAdmin && (
            <Link href="/dashboard/jobs/new" className="mt-4">
              <Button>
                <Plus className="mr-1 h-4 w-4" />
                {strings.jobs.addButton}
              </Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-border/60 bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{strings.jobs.fieldName}</TableHead>
                <TableHead>{strings.jobs.fieldLocation}</TableHead>
                <TableHead>{strings.jobs.fieldSkills}</TableHead>
                <TableHead>Creata il</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((j) => (
                <TableRow key={j.id} className="cursor-pointer hover:bg-muted/50">
                  <TableCell className="font-medium">
                    <Link href={`/dashboard/jobs/${j.id}`} className="block">
                      {j.name}
                    </Link>
                  </TableCell>
                  <TableCell>{j.locationRaw}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {j.skills.slice(0, 3).map((s) => (
                        <Badge key={s} variant="secondary" className="text-xs">
                          {s}
                        </Badge>
                      ))}
                      {j.skills.length > 3 && (
                        <Badge variant="outline" className="text-xs">
                          +{j.skills.length - 3}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {j.createdAt.toLocaleDateString("it-IT", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual verification**

Visit `/dashboard/jobs`. If you already created one in Task 13, it should appear. Otherwise the empty state renders with the "+ Aggiungi offerta" button (only for ORG_ADMIN).

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/dashboard/jobs/page.tsx
git commit -m "feat(jobs): list page"
```

---

## Task 15: `ScoreBadge` + `MatchTable` components

**Files:**
- Create: `src/components/jobs/score-badge.tsx`
- Create: `src/components/jobs/match-table.tsx`

- [ ] **Step 1: ScoreBadge**

```tsx
import { cn } from "@/lib/utils";

interface ScoreBadgeProps {
  value: number; // 0-100
  className?: string;
}

export function ScoreBadge({ value, className }: ScoreBadgeProps) {
  const color =
    value >= 70
      ? "bg-emerald-600 text-white"
      : value >= 40
        ? "bg-amber-500 text-white"
        : "bg-gray-400 text-white";
  return (
    <span
      className={cn(
        "inline-flex min-w-[3rem] items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        color,
        className,
      )}
    >
      {value}%
    </span>
  );
}
```

- [ ] **Step 2: MatchTable (client, for row-click nav)**

```tsx
"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScoreBadge } from "./score-badge";
import { strings } from "@/lib/i18n/strings";
import type { RankedCandidate } from "@/lib/jobs/matcher";

interface MatchTableProps {
  ranked: RankedCandidate[];
}

export function MatchTable({ ranked }: MatchTableProps) {
  if (ranked.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        {strings.jobs.matchEmpty}
      </div>
    );
  }

  const fallback = ranked.some((r) => r.isFallback);

  return (
    <div className="space-y-2">
      {fallback && (
        <p className="text-sm text-muted-foreground">{strings.jobs.matchFallback}</p>
      )}
      <div className="rounded-lg border border-border/60 bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Candidato</TableHead>
              <TableHead>Località preferita</TableHead>
              <TableHead>Competenze</TableHead>
              <TableHead>{strings.jobs.score}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ranked.map((r) => (
              <TableRow key={r.candidate.id} className="hover:bg-muted/50">
                <TableCell className="font-medium">
                  <Link
                    href={`/dashboard/candidates/${r.candidate.id}`}
                    className="block hover:underline"
                  >
                    {r.candidate.firstName} {r.candidate.lastName}
                  </Link>
                </TableCell>
                <TableCell>{r.candidate.jobPreferences.preferredLocation || "—"}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {r.candidate.skillsAndCompetences.slice(0, 3).map((s) => (
                      <Badge key={s} variant="secondary" className="text-xs">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <ScoreBadge value={r.match.final} />
                    {r.isFallback && (
                      <span className="text-xs text-muted-foreground">
                        {strings.jobs.lowMatchTag}
                      </span>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/jobs/score-badge.tsx src/components/jobs/match-table.tsx
git commit -m "feat(jobs): score badge and match results table"
```

---

## Task 16: Detail page + `[id]/actions.ts` (update, delete)

**Files:**
- Create: `src/app/(dashboard)/dashboard/jobs/[id]/page.tsx`
- Create: `src/app/(dashboard)/dashboard/jobs/[id]/actions.ts`

- [ ] **Step 1: Actions for edit and delete**

Create `src/app/(dashboard)/dashboard/jobs/[id]/actions.ts`:

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { jobDescriptionInputSchema } from "@/lib/validations/job-description";
import {
  updateJobDescription,
  deleteJobDescription,
  JobNameAlreadyExistsError,
  JobNotFoundError,
} from "@/lib/jobs/service";
import { invalidateOrgCache } from "@/lib/make/service";

type ActionResult = { ok: true } | { ok: false; error: string };

export async function updateJobAction(id: string, formData: FormData): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.organizationId || session.user.role !== "ORG_ADMIN") {
    return { ok: false, error: "Non autorizzato" };
  }

  const parsed = jobDescriptionInputSchema.safeParse({
    name: formData.get("name"),
    locationRaw: formData.get("locationRaw"),
    description: formData.get("description"),
    skills: JSON.parse((formData.get("skills") as string) || "[]"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dati non validi" };
  }

  try {
    await updateJobDescription({
      id,
      organizationId: session.user.organizationId,
      input: parsed.data,
    });
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        organizationId: session.user.organizationId,
        action: "update",
        resourceType: "JobDescription",
        resourceId: id,
      },
    });
    revalidatePath(`/dashboard/jobs/${id}`);
    revalidatePath("/dashboard/jobs");
    redirect(`/dashboard/jobs/${id}`);
  } catch (e) {
    if (e instanceof JobNameAlreadyExistsError) return { ok: false, error: e.message };
    if (e instanceof JobNotFoundError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function deleteJobAction(id: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.organizationId || session.user.role !== "ORG_ADMIN") {
    return { ok: false, error: "Non autorizzato" };
  }
  try {
    await deleteJobDescription({ id, organizationId: session.user.organizationId });
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        organizationId: session.user.organizationId,
        action: "delete",
        resourceType: "JobDescription",
        resourceId: id,
      },
    });
    revalidatePath("/dashboard/jobs");
    redirect("/dashboard/jobs");
  } catch (e) {
    if (e instanceof JobNotFoundError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function refreshCandidatesForJob(): Promise<void> {
  const session = await auth();
  if (!session?.user?.organizationId) return;
  await invalidateOrgCache(session.user.organizationId);
  revalidatePath(`/dashboard/jobs`, "layout");
}
```

- [ ] **Step 2: Detail page**

Create `src/app/(dashboard)/dashboard/jobs/[id]/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { RefreshCw, Pencil } from "lucide-react";
import { auth } from "@/lib/auth";
import { strings } from "@/lib/i18n/strings";
import { getJobDescription } from "@/lib/jobs/service";
import { getCandidatesForOrg } from "@/lib/make/service";
import { rankCandidates } from "@/lib/jobs/matcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MatchTable } from "@/components/jobs/match-table";
import { DeleteJobButton } from "@/components/jobs/delete-job-button";
import { refreshCandidatesForJob } from "./actions";

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.organizationId) redirect("/login");

  const jd = await getJobDescription({ id, organizationId: session.user.organizationId });
  if (!jd) notFound();
  const isAdmin = session.user.role === "ORG_ADMIN";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl tracking-tight">{jd.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {jd.locationRaw}
            {jd.locationRegion && jd.locationRaw !== jd.locationRegion && (
              <> · {jd.locationRegion}</>
            )}
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Link href={`/dashboard/jobs/${jd.id}/edit`}>
              <Button variant="outline" size="sm">
                <Pencil className="mr-1 h-4 w-4" />
                Modifica
              </Button>
            </Link>
            <DeleteJobButton id={jd.id} />
          </div>
        )}
      </div>

      <Card className="shadow-sm border-border/60">
        <CardHeader>
          <CardTitle>{strings.jobs.fieldDescription}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{jd.description}</p>
        </CardContent>
      </Card>

      {jd.skills.length > 0 && (
        <Card className="shadow-sm border-border/60">
          <CardHeader>
            <CardTitle>{strings.jobs.fieldSkills}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {jd.skills.map((s) => (
                <Badge key={s} variant="outline">
                  {s}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-lg ">{strings.jobs.matchHeading}</h2>
        <form action={refreshCandidatesForJob}>
          <Button variant="outline" size="sm" type="submit" className="gap-1">
            <RefreshCw className="h-4 w-4" />
            {strings.jobs.refreshMatches}
          </Button>
        </form>
      </div>

      <Suspense fallback={<MatchesLoading />}>
        <Matches jd={jd} orgId={session.user.organizationId} />
      </Suspense>
    </div>
  );
}

async function Matches({
  jd,
  orgId,
}: {
  jd: { description: string; skills: string[]; locationMunicipality: string | null; locationProvince: string | null; locationRegion: string | null };
  orgId: string;
}) {
  let candidates;
  try {
    candidates = await getCandidatesForOrg(orgId);
  } catch {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        Impossibile caricare i candidati. Riprova più tardi.
      </div>
    );
  }
  const ranked = rankCandidates(jd, candidates);
  return <MatchTable ranked={ranked} />;
}

function MatchesLoading() {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-8 text-center text-sm text-muted-foreground">
      Calcolo delle corrispondenze…
    </div>
  );
}
```

- [ ] **Step 3: Delete button (client component with confirm dialog)**

Create `src/components/jobs/delete-job-button.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { strings } from "@/lib/i18n/strings";
import { deleteJobAction } from "@/app/(dashboard)/dashboard/jobs/[id]/actions";

export function DeleteJobButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const onConfirm = () => {
    startTransition(async () => {
      await deleteJobAction(id);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
          <Trash2 className="mr-1 h-4 w-4" />
          {strings.jobs.deleteButton}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{strings.jobs.deleteConfirmTitle}</DialogTitle>
          <DialogDescription>{strings.jobs.deleteConfirmBody}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Annulla
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            {strings.jobs.deleteButton}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Verify shadcn dialog exists**

Run: `ls src/components/ui/dialog.tsx`. If missing: `pnpm dlx shadcn@latest add dialog`.

- [ ] **Step 5: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Manual verification**

- Create a JD (from Task 13 flow).
- Arrive at `/dashboard/jobs/[id]`. JD body renders. Matches Suspense boundary resolves.
- Hit "Ricalcola" — no visible change unless cache was stale, but no error.
- Hit "Elimina" — confirm → redirected to `/dashboard/jobs` with the JD gone.

- [ ] **Step 7: Commit**

```bash
git add src/app/\(dashboard\)/dashboard/jobs/\[id\]/ src/components/jobs/delete-job-button.tsx src/components/ui/
git commit -m "feat(jobs): detail page with live match + delete dialog"
```

---

## Task 17: Edit page

**Files:**
- Create: `src/app/(dashboard)/dashboard/jobs/[id]/edit/page.tsx`

- [ ] **Step 1: Create the edit page**

```tsx
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { strings } from "@/lib/i18n/strings";
import { getJobDescription } from "@/lib/jobs/service";
import { JobForm } from "@/components/jobs/job-form";
import { updateJobAction } from "../actions";

export default async function EditJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.organizationId) redirect("/login");
  if (session.user.role !== "ORG_ADMIN") redirect(`/dashboard/jobs/${id}`);

  const jd = await getJobDescription({ id, organizationId: session.user.organizationId });
  if (!jd) notFound();

  const boundAction = async (formData: FormData) => {
    "use server";
    return updateJobAction(id, formData);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl tracking-tight">{strings.pages.jobEdit}</h1>
      <JobForm
        mode="edit"
        initial={{
          name: jd.name,
          locationRaw: jd.locationRaw,
          description: jd.description,
          skills: jd.skills,
        }}
        action={boundAction}
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual verification**

Click "Modifica" on a JD detail page. Form pre-fills. Change the name. Save. Redirect back to detail page. Verify DB change via Prisma Studio (`pnpm prisma studio`).

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/dashboard/jobs/\[id\]/edit/
git commit -m "feat(jobs): edit page"
```

---

## Task 18: Admin cross-org view

**Files:**
- Create: `src/app/(admin)/admin/jobs/page.tsx`

- [ ] **Step 1: Create the admin page**

```tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { strings } from "@/lib/i18n/strings";
import { listAllJobDescriptionsForAdmin } from "@/lib/jobs/service";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default async function AdminJobsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN_KUBRI") redirect("/dashboard");

  const jobs = await listAllJobDescriptionsForAdmin();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl tracking-tight">{strings.pages.jobs}</h1>

      <div className="rounded-lg border border-border/60 bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Organizzazione</TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Località</TableHead>
              <TableHead>Competenze</TableHead>
              <TableHead>Creata il</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((j) => (
              <TableRow key={j.id}>
                <TableCell className="font-medium">{j.organization.name}</TableCell>
                <TableCell>
                  <Link
                    href={`/dashboard/jobs/${j.id}`}
                    className="text-kubri-600 hover:underline"
                  >
                    {j.name}
                  </Link>
                </TableCell>
                <TableCell>{j.locationRaw}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {j.skills.slice(0, 3).map((s) => (
                      <Badge key={s} variant="secondary" className="text-xs">
                        {s}
                      </Badge>
                    ))}
                    {j.skills.length > 3 && (
                      <Badge variant="outline" className="text-xs">
                        +{j.skills.length - 3}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {j.createdAt.toLocaleDateString("it-IT", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(admin\)/admin/jobs/
git commit -m "feat(jobs): ADMIN_KUBRI cross-org read-only list"
```

---

## Task 19: Sidebar nav entry

**Files:**
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Add nav item**

In `src/components/layout/sidebar.tsx`, update the imports to include `Briefcase` and add to `navItems`:

```typescript
import { Users, Settings, BarChart3, Shield, X, Briefcase } from "lucide-react";

// ...

const navItems = [
  {
    label: strings.nav.candidates,
    href: "/dashboard/candidates",
    icon: Users,
  },
  {
    label: strings.nav.jobs,
    href: "/dashboard/jobs",
    icon: Briefcase,
  },
  {
    label: strings.nav.settings,
    href: "/dashboard/settings",
    icon: Settings,
  },
  {
    label: strings.nav.stats,
    href: "/dashboard/stats",
    icon: BarChart3,
  },
];
```

- [ ] **Step 2: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual verification**

Refresh the dashboard. A new sidebar entry "Offerte di lavoro" appears, active on `/dashboard/jobs*`.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/sidebar.tsx
git commit -m "feat(jobs): sidebar entry"
```

---

## Task 20: Header CTA button

**Files:**
- Modify: `src/components/layout/header.tsx`

The existing button is commented out. Uncomment, wire to navigate, role-gate.

- [ ] **Step 1: Update the header**

Header needs user role. Two options:
  a) read session client-side via `useSession`,
  b) pass role from the server layout.

Option (b) is cleaner — the dashboard layout already knows the session. Update the interface first, then consumer. Start by reading the parent to see if the layout already passes props:

Run: `cat src/components/layout/dashboard-shell.tsx 2>/dev/null | head -80`

If dashboard-shell is a client component, pass `isAdmin` down. Then modify `src/components/layout/header.tsx`:

```tsx
"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { LogOut, Menu, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { strings } from "@/lib/i18n/strings";

interface HeaderProps {
  userName: string;
  isAdmin: boolean;
  onMenuToggle: () => void;
}

export function Header({ userName, isAdmin, onMenuToggle }: HeaderProps) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-card px-4 lg:px-6 shadow-sm">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onMenuToggle}
      >
        <Menu className="h-5 w-5" />
        <span className="sr-only">Apri menu</span>
      </Button>

      <div className="lg:hidden" />
      {isAdmin && (
        <Link href="/dashboard/jobs/new" className="hidden lg:block">
          <Button
            size="lg"
            className="text-kubri-800 bg-white border border-kubri-800 hover:bg-kubri-50"
          >
            <Plus className="mr-1 h-4 w-4" />
            Aggiungi Job description
          </Button>
        </Link>
      )}
      {/* Spacer for desktop — pushes user info to the right */}
      <div className="hidden lg:block" />

      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-kubri-100 text-kubri-800">
          <span className="text-xs font-semibold">
            {userName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
          </span>
        </div>
        <span className="text-sm font-medium text-foreground">{userName}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="text-muted-foreground hover:text-foreground"
        >
          <LogOut className="mr-1.5 h-4 w-4" />
          {strings.common.logout}
        </Button>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Pass `isAdmin` from the dashboard shell**

Open `src/components/layout/dashboard-shell.tsx`. Wherever it renders `<Header userName=...>`, add `isAdmin={isAdmin}`. The shell already receives `isAdmin` for sidebar (confirm by reading the file); forward it to header.

If `isAdmin` isn't on the shell, look up to the route-level `layout.tsx` (`src/app/(dashboard)/dashboard/layout.tsx` or `src/app/(dashboard)/layout.tsx`) — that's a Server Component that can `await auth()` and pass role down. Add `isAdmin={session.user.role === "ORG_ADMIN"}` to the shell.

- [ ] **Step 3: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual verification**

- Log in as ORG_ADMIN: the "+ Aggiungi Job description" button appears; clicking it goes to `/dashboard/jobs/new`.
- Log in as ORG_MEMBER: the button is not rendered.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/header.tsx src/components/layout/dashboard-shell.tsx src/app/\(dashboard\)/
git commit -m "feat(jobs): wire header CTA to create page, role-gated"
```

---

## Task 21: End-to-end manual smoke test + cleanup

- [ ] **Step 1: Smoke test as ORG_ADMIN**

1. `pnpm dev`.
2. Log in as an ORG_ADMIN user.
3. Sidebar shows "Offerte di lavoro".
4. Click header "+ Aggiungi Job description" → form opens.
5. Fill: name="Addetto pulizie", location="Milano", description=a paragraph, skills=["pulizie","precisione"]. Submit.
6. Redirected to detail page. Description + skills render. Matches load, showing candidates with non-zero skills or location in Lombardia.
7. Click "Ricalcola" — no errors.
8. Click "Modifica" — form pre-fills. Change location to "Lombardia". Save. Back on detail page; `locationRegion` now "Lombardia".
9. Click "Elimina" — dialog → confirm → back to list, item gone.

- [ ] **Step 2: Smoke test as ORG_MEMBER**

1. Log in as ORG_MEMBER.
2. Sidebar shows "Offerte di lavoro".
3. No "+ Aggiungi" button in header or on the list page.
4. Visiting `/dashboard/jobs/new` directly redirects away.
5. Open an existing JD — "Modifica" / "Elimina" buttons not rendered.

- [ ] **Step 3: Smoke test as ADMIN_KUBRI**

1. Log in as ADMIN_KUBRI.
2. Visit `/admin/jobs`. All JDs across orgs listed with organization name.
3. No edit/delete actions in this view.

- [ ] **Step 4: Run the full test suite + typecheck**

Run:
```bash
pnpm test
pnpm tsc --noEmit
```

Expected: all new tests pass; no new TS errors in application code (pre-existing stale test files may still error — unrelated).

- [ ] **Step 5: Commit any follow-ups from smoke testing**

If any issues surfaced, fix them with focused commits. If not, no commit needed.

---

## Appendix A: Post-launch follow-ups (out of scope)

- **Multi-location JDs** — extend `JobDescription.location*` to an array; rescore with `max` over locations.
- **Option B embeddings** — drop in `src/lib/jobs/matcher/embeddings.ts`, cache per candidate hash with Make TTL, A/B against Option A.
- **"Why this match?" explanations** — lazy LLM call when a user expands a match row.
- **Match history** — capture a snapshot of the top 10 per JD nightly for trend analysis without compromising the "live" primary view.
- **Bulk actions** — "Export matched candidates as CSV" from the detail page.
