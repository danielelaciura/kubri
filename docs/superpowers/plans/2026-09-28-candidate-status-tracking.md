# Candidate Status Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-organization hiring status for each candidate (NEW → … → HIRED / REJECTED / WITHDRAWN), editable via a dropdown in the table and detail page, filterable, and exported in CSV.

**Architecture:** New `CandidateStatus` table keyed by `(candidateId, organizationId)`; missing row = `NEW`. Pure, client-safe helpers in `src/lib/candidates/status.ts`; DB access in `src/lib/candidates/status-service.ts`; server action `setCandidateStatus` next to `addNote`; a `CandidateStatusSelect` client component mirroring `AddToListMenu` (base-ui `Popover`). Filtering happens in memory on the page, like `listId`.

**Tech Stack:** Next.js App Router, Prisma 7, Zod v4, base-ui Popover (shadcn wrapper), vitest.

Spec: `docs/superpowers/specs/2026-09-28-candidate-status-tracking-design.md`

> **Note (2026-10-01):** the status list was revised after implementation to `NEW, CONTACTED, SCREENING, INTERVIEW, OFFER, HIRED, NOT_SELECTED` (see spec). Code snippets below show the original list.

All commands run from `apps/dashboard`.

**Deviations from spec (decided while planning):**
- The dropdown uses the existing `Popover` (as `AddToListMenu` does) instead of `DropdownMenu`: same UX, proven click-isolation inside table rows.
- On the detail page the select lives in a "Status" card at the top of the sidebar (above Lists) instead of beside the name, which is rendered inside `CandidateProfile`.

---

## File map

| File | Action | Responsibility |
|------|--------|----------------|
| `prisma/schema.prisma` | modify | enum + `CandidateStatus` model + back-relations |
| `prisma/migrations/20260928120000_add_candidate_status/migration.sql` | create | additive DDL |
| `src/lib/candidates/status.ts` | create | enum list, type, `resolveStatus`, `filterByStatus`, `isCandidateStatus` (no imports → client-safe) |
| `src/lib/candidates/status-service.ts` | create | `getStatusByCandidateForOrg`, `getCandidateStatusForOrg`, `changeCandidateStatus` |
| `src/types/index.ts` | modify | `CandidateFilters.status` |
| `src/lib/validations/candidate-filters.ts` | modify | `status` param |
| `src/app/(dashboard)/dashboard/candidates/[id]/actions.ts` | modify | `setCandidateStatus` action |
| `src/lib/i18n/dictionaries/it.ts`, `en.ts` | modify | `candidateStatus` group + `csv.headerStatus` |
| `src/lib/export/csv.ts` | modify | Status column |
| `src/app/api/candidates/export/csv/route.ts` | modify | status filter + column |
| `src/app/api/candidates/lists/[listId]/export/csv/route.ts` | modify | status column |
| `src/components/candidates/candidate-status-select.tsx` | create | dropdown badge |
| `src/components/candidates/candidates-table.tsx` | modify | Status column |
| `src/components/candidates/candidate-filters.tsx` | modify | Status filter |
| `src/app/(dashboard)/dashboard/candidates/page.tsx` | modify | load map, filter, pass to table |
| `src/app/(dashboard)/dashboard/candidates/[id]/page.tsx` | modify | status card |
| tests under `src/__tests__/…` | create/modify | see tasks |

---

### Task 1: Schema + migration

**Files:** Modify `prisma/schema.prisma`; Create `prisma/migrations/20260928120000_add_candidate_status/migration.sql`

- [ ] **Step 1: Add to `schema.prisma`** (after `enum NotifyFrequency`):

```prisma
enum CandidateStatusValue {
  NEW
  SCREENING
  CONTACTED
  INTERVIEW
  OFFER
  HIRED
  REJECTED
  WITHDRAWN
}
```

Model (after `CandidateListMembership`):

```prisma
// Per-organization hiring status of a candidate. No row = NEW.
// Candidates can be visible to several orgs, so status is keyed by the pair.
model CandidateStatus {
  candidateId     String               @db.Uuid
  organizationId  String               @db.Uuid
  status          CandidateStatusValue
  updatedByUserId String?              @db.Uuid
  updatedAt       DateTime             @updatedAt

  candidate    Candidate    @relation(fields: [candidateId], references: [id], onDelete: Cascade)
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  updatedBy    User?        @relation(fields: [updatedByUserId], references: [id], onDelete: SetNull)

  @@id([candidateId, organizationId])
  @@index([organizationId, status])
}
```

Back-relations: `Organization.candidateStatuses CandidateStatus[]`, `User.candidateStatusUpdates CandidateStatus[]`, `Candidate.statuses CandidateStatus[]`.

- [ ] **Step 2: Generate the SQL without a DB** (worktree has none):

```bash
git show HEAD:apps/dashboard/prisma/schema.prisma > /tmp/old-schema.prisma
pnpm exec prisma migrate diff --from-schema /tmp/old-schema.prisma --to-schema prisma/schema.prisma --script
```

Save output to the migration file. It must contain only CREATE TYPE / CREATE TABLE / CREATE INDEX / ADD CONSTRAINT for the new objects — **no `DROP INDEX`** (pgvector HNSW drift). Expected content:

```sql
-- CreateEnum
CREATE TYPE "CandidateStatusValue" AS ENUM ('NEW', 'SCREENING', 'CONTACTED', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "CandidateStatus" (
    "candidateId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "status" "CandidateStatusValue" NOT NULL,
    "updatedByUserId" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateStatus_pkey" PRIMARY KEY ("candidateId","organizationId")
);

-- CreateIndex
CREATE INDEX "CandidateStatus_organizationId_status_idx" ON "CandidateStatus"("organizationId", "status");

-- AddForeignKey (x3: candidate CASCADE, organization CASCADE, user SET NULL)
```

- [ ] **Step 3:** `pnpm exec prisma generate` → succeeds.
- [ ] **Step 4: Commit** `feat(db): add per-organization CandidateStatus model`

---

### Task 2: Pure status helpers

**Files:** Create `src/lib/candidates/status.ts`; Test `src/__tests__/lib/candidates/status.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  CANDIDATE_STATUSES,
  DEFAULT_CANDIDATE_STATUS,
  filterByStatus,
  isCandidateStatus,
  resolveStatus,
} from "@/lib/candidates/status";

describe("candidate status helpers", () => {
  it("lists the statuses in journey order, starting from NEW", () => {
    expect(CANDIDATE_STATUSES).toEqual([
      "NEW", "SCREENING", "CONTACTED", "INTERVIEW", "OFFER", "HIRED", "REJECTED", "WITHDRAWN",
    ]);
    expect(DEFAULT_CANDIDATE_STATUS).toBe("NEW");
  });

  it("resolveStatus defaults to NEW when the org has no row", () => {
    expect(resolveStatus({ c1: "HIRED" }, "c1")).toBe("HIRED");
    expect(resolveStatus({ c1: "HIRED" }, "c2")).toBe("NEW");
  });

  it("isCandidateStatus accepts only known values", () => {
    expect(isCandidateStatus("OFFER")).toBe(true);
    expect(isCandidateStatus("offer")).toBe(false);
    expect(isCandidateStatus(undefined)).toBe(false);
  });

  describe("filterByStatus", () => {
    const candidates = [{ id: "c1" }, { id: "c2" }, { id: "c3" }];
    const map = { c1: "INTERVIEW", c2: "NEW" } as const;

    it("returns everything when no status is requested", () => {
      expect(filterByStatus(candidates, map, undefined)).toEqual(candidates);
    });
    it("NEW includes candidates with no row", () => {
      expect(filterByStatus(candidates, map, "NEW").map((c) => c.id)).toEqual(["c2", "c3"]);
    });
    it("other statuses match exactly", () => {
      expect(filterByStatus(candidates, map, "INTERVIEW").map((c) => c.id)).toEqual(["c1"]);
      expect(filterByStatus(candidates, map, "HIRED")).toEqual([]);
    });
  });
});
```

- [ ] **Step 2:** `pnpm exec vitest run src/__tests__/lib/candidates/status.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement**

```ts
// Client-safe (no imports): used by server code and client components alike.

/** Journey order: used for the dropdown, the filter and validation. */
export const CANDIDATE_STATUSES = [
  "NEW",
  "SCREENING",
  "CONTACTED",
  "INTERVIEW",
  "OFFER",
  "HIRED",
  "REJECTED",
  "WITHDRAWN",
] as const;

export type CandidateStatusValue = (typeof CANDIDATE_STATUSES)[number];

/** An org that never touched a candidate sees it as NEW (no row stored). */
export const DEFAULT_CANDIDATE_STATUS: CandidateStatusValue = "NEW";

export type StatusByCandidate = Partial<Record<string, CandidateStatusValue>>;

export function isCandidateStatus(value: unknown): value is CandidateStatusValue {
  return (
    typeof value === "string" &&
    (CANDIDATE_STATUSES as readonly string[]).includes(value)
  );
}

export function resolveStatus(
  statusByCandidate: StatusByCandidate,
  candidateId: string,
): CandidateStatusValue {
  return statusByCandidate[candidateId] ?? DEFAULT_CANDIDATE_STATUS;
}

export function filterByStatus<T extends { id: string }>(
  candidates: T[],
  statusByCandidate: StatusByCandidate,
  status: CandidateStatusValue | undefined,
): T[] {
  if (!status) return candidates;
  return candidates.filter((c) => resolveStatus(statusByCandidate, c.id) === status);
}
```

- [ ] **Step 4:** run test → PASS. **Step 5: Commit** `feat(candidates): add status helpers`

---

### Task 3: Status service (DB)

**Files:** Create `src/lib/candidates/status-service.ts`; Test `src/__tests__/lib/candidates/status-service.test.ts`

- [ ] **Step 1: Failing test** (Prisma mocked; `$transaction` runs the callback with a fake tx)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const tx = {
  candidateStatus: { findUnique: vi.fn(), upsert: vi.fn() },
  auditLog: { create: vi.fn() },
};
vi.mock("@/lib/db", () => ({
  prisma: {
    candidateStatus: { findMany: vi.fn(), findUnique: vi.fn() },
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  },
}));

import { prisma } from "@/lib/db";
import {
  changeCandidateStatus,
  getCandidateStatusForOrg,
  getStatusByCandidateForOrg,
} from "@/lib/candidates/status-service";

const ORG = "00000000-0000-0000-0000-0000000000b1";
const USER = "00000000-0000-0000-0000-0000000000a1";
const CAND = "00000000-0000-0000-0000-0000000000c1";

beforeEach(() => vi.clearAllMocks());

describe("status-service", () => {
  it("getStatusByCandidateForOrg scopes by org and builds a map", async () => {
    vi.mocked(prisma.candidateStatus.findMany).mockResolvedValue([
      { candidateId: "c1", status: "OFFER" },
    ] as never);
    await expect(getStatusByCandidateForOrg(ORG)).resolves.toEqual({ c1: "OFFER" });
    expect(prisma.candidateStatus.findMany).toHaveBeenCalledWith({
      where: { organizationId: ORG },
      select: { candidateId: true, status: true },
    });
  });

  it("getCandidateStatusForOrg defaults to NEW", async () => {
    vi.mocked(prisma.candidateStatus.findUnique).mockResolvedValue(null);
    await expect(getCandidateStatusForOrg(ORG, CAND)).resolves.toBe("NEW");
  });

  it("changeCandidateStatus upserts and audits a real change", async () => {
    tx.candidateStatus.findUnique.mockResolvedValue(null);
    const res = await changeCandidateStatus({
      candidateId: CAND, organizationId: ORG, userId: USER, status: "SCREENING",
    });
    expect(res).toEqual({ changed: true, from: "NEW", to: "SCREENING" });
    expect(tx.candidateStatus.upsert).toHaveBeenCalledWith({
      where: { candidateId_organizationId: { candidateId: CAND, organizationId: ORG } },
      create: { candidateId: CAND, organizationId: ORG, status: "SCREENING", updatedByUserId: USER },
      update: { status: "SCREENING", updatedByUserId: USER },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: USER,
        organizationId: ORG,
        action: "candidate.status.change",
        resourceType: "candidate",
        resourceId: CAND,
        metadata: { from: "NEW", to: "SCREENING" },
      },
    });
  });

  it("changeCandidateStatus is a no-op when the status is unchanged", async () => {
    tx.candidateStatus.findUnique.mockResolvedValue({ status: "OFFER" });
    const res = await changeCandidateStatus({
      candidateId: CAND, organizationId: ORG, userId: USER, status: "OFFER",
    });
    expect(res).toEqual({ changed: false, from: "OFFER", to: "OFFER" });
    expect(tx.candidateStatus.upsert).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement**

```ts
import { prisma } from "@/lib/db";
import {
  DEFAULT_CANDIDATE_STATUS,
  type CandidateStatusValue,
  type StatusByCandidate,
} from "@/lib/candidates/status";

/** Mappa candidateId -> status per l'org (assenza = NEW). */
export async function getStatusByCandidateForOrg(
  organizationId: string,
): Promise<StatusByCandidate> {
  const rows = await prisma.candidateStatus.findMany({
    where: { organizationId },
    select: { candidateId: true, status: true },
  });
  const out: StatusByCandidate = {};
  for (const r of rows) out[r.candidateId] = r.status;
  return out;
}

export async function getCandidateStatusForOrg(
  organizationId: string,
  candidateId: string,
): Promise<CandidateStatusValue> {
  const row = await prisma.candidateStatus.findUnique({
    where: { candidateId_organizationId: { candidateId, organizationId } },
    select: { status: true },
  });
  return row?.status ?? DEFAULT_CANDIDATE_STATUS;
}

interface ChangeCandidateStatusParams {
  candidateId: string;
  organizationId: string;
  userId: string;
  status: CandidateStatusValue;
}

/**
 * Sets the org's status for a candidate and audits the transition.
 * Caller is responsible for checking the org can see the candidate.
 */
export async function changeCandidateStatus({
  candidateId,
  organizationId,
  userId,
  status,
}: ChangeCandidateStatusParams): Promise<{
  changed: boolean;
  from: CandidateStatusValue;
  to: CandidateStatusValue;
}> {
  return prisma.$transaction(async (tx) => {
    const key = { candidateId_organizationId: { candidateId, organizationId } };
    const existing = await tx.candidateStatus.findUnique({
      where: key,
      select: { status: true },
    });
    const from = existing?.status ?? DEFAULT_CANDIDATE_STATUS;
    if (from === status) return { changed: false, from, to: status };

    await tx.candidateStatus.upsert({
      where: key,
      create: { candidateId, organizationId, status, updatedByUserId: userId },
      update: { status, updatedByUserId: userId },
    });
    await tx.auditLog.create({
      data: {
        userId,
        organizationId,
        action: "candidate.status.change",
        resourceType: "candidate",
        resourceId: candidateId,
        metadata: { from, to: status },
      },
    });
    return { changed: true, from, to: status };
  });
}
```

- [ ] **Step 4:** run → PASS. **Step 5: Commit** `feat(candidates): add status service`

---

### Task 4: Filter param

**Files:** Modify `src/types/index.ts`, `src/lib/validations/candidate-filters.ts`; Test `src/__tests__/lib/validations/candidate-filters.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { candidateFiltersSchema, toFiltersAndSort } from "@/lib/validations/candidate-filters";

describe("candidateFiltersSchema status", () => {
  it("maps a valid status into filters", () => {
    const parsed = candidateFiltersSchema.parse({ status: "INTERVIEW" });
    expect(toFiltersAndSort(parsed).filters.status).toBe("INTERVIEW");
  });
  it("rejects unknown statuses", () => {
    expect(candidateFiltersSchema.safeParse({ status: "MAYBE" }).success).toBe(false);
  });
  it("omits status when not given", () => {
    const parsed = candidateFiltersSchema.parse({});
    expect(toFiltersAndSort(parsed).filters.status).toBeUndefined();
  });
});
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** `src/types/index.ts`: `import type { CandidateStatusValue } from "@/lib/candidates/status";` and add `status?: CandidateStatusValue;` to `CandidateFilters`. In the schema: import `CANDIDATE_STATUSES`, add `status: z.enum(CANDIDATE_STATUSES).optional(),` and in `toFiltersAndSort`: `if (params.status) filters.status = params.status;`.
- [ ] **Step 4:** run → PASS. **Step 5: Commit** `feat(candidates): accept status filter param`

---

### Task 5: Dictionaries

**Files:** Modify `src/lib/i18n/dictionaries/it.ts`, `en.ts`

- [ ] **Step 1:** Add a top-level group after `candidates` in both files:

it:
```ts
  candidateStatus: {
    label: "Stato",
    filterAll: "Tutti",
    updateError: "Impossibile aggiornare lo stato. Riprova.",
    values: {
      NEW: "Nuovo",
      SCREENING: "In valutazione",
      CONTACTED: "Contattato",
      INTERVIEW: "Colloquio",
      OFFER: "Proposta",
      HIRED: "Assunto",
      REJECTED: "Scartato",
      WITHDRAWN: "Ritirato",
    },
  },
```
en:
```ts
  candidateStatus: {
    label: "Status",
    filterAll: "All",
    updateError: "Could not update the status. Please try again.",
    values: {
      NEW: "New",
      SCREENING: "Screening",
      CONTACTED: "Contacted",
      INTERVIEW: "Interview",
      OFFER: "Offer",
      HIRED: "Hired",
      REJECTED: "Rejected",
      WITHDRAWN: "Withdrawn",
    },
  },
```
And `csv.headerStatus`: it `"Stato"`, en `"Status"` (after `headerLists`).

- [ ] **Step 2:** `pnpm exec vitest run src/__tests__ -t "dictionar"` (parity) and `pnpm exec tsc --noEmit` → pass.
- [ ] **Step 3: Commit** `feat(i18n): add candidate status strings`

---

### Task 6: Server action `setCandidateStatus`

**Files:** Modify `src/app/(dashboard)/dashboard/candidates/[id]/actions.ts`; Test `src/__tests__/app/dashboard/candidates/status-action.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const member = {
  id: "00000000-0000-0000-0000-0000000000a1",
  role: "ORG_MEMBER" as const,
  organizationId: "00000000-0000-0000-0000-0000000000b1",
};
const CAND = "00000000-0000-0000-0000-0000000000c1";

vi.mock("@/lib/auth-utils", () => ({ getCurrentUser: vi.fn(async () => member) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/i18n/locale", () => ({ getServerLocale: vi.fn(async () => "it") }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/pools/access", () => ({ getOrgAccessiblePoolIds: vi.fn(async () => ["p1"]) }));
vi.mock("@/lib/db", () => ({ prisma: { candidate: { findFirst: vi.fn() } } }));
vi.mock("@/lib/candidates/status-service", () => ({
  changeCandidateStatus: vi.fn(async () => ({ changed: true, from: "NEW", to: "OFFER" })),
}));

import { prisma } from "@/lib/db";
import { changeCandidateStatus } from "@/lib/candidates/status-service";
import { revalidatePath } from "next/cache";
import { setCandidateStatus } from "@/app/(dashboard)/dashboard/candidates/[id]/actions";

beforeEach(() => vi.clearAllMocks());

describe("setCandidateStatus", () => {
  it("rejects an unknown status", async () => {
    await expect(setCandidateStatus(CAND, "MAYBE")).rejects.toThrow();
    expect(changeCandidateStatus).not.toHaveBeenCalled();
  });

  it("rejects a candidate the org cannot see", async () => {
    vi.mocked(prisma.candidate.findFirst).mockResolvedValue(null);
    await expect(setCandidateStatus(CAND, "OFFER")).rejects.toThrow();
    expect(changeCandidateStatus).not.toHaveBeenCalled();
  });

  it("changes status for the user's own org and revalidates", async () => {
    vi.mocked(prisma.candidate.findFirst).mockResolvedValue({ id: CAND } as never);
    await setCandidateStatus(CAND, "OFFER");
    expect(changeCandidateStatus).toHaveBeenCalledWith({
      candidateId: CAND,
      organizationId: member.organizationId,
      userId: member.id,
      status: "OFFER",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/candidates");
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/candidates/${CAND}`);
  });
});
```

- [ ] **Step 2:** run → FAIL (export missing).
- [ ] **Step 3: Implement** (append to `actions.ts`; add imports `CANDIDATE_STATUSES` and `changeCandidateStatus`):

```ts
const statusSchema = z.object({
  candidateId: z.string().uuid(),
  status: z.enum(CANDIDATE_STATUSES),
});

export async function setCandidateStatus(candidateId: string, status: string) {
  const session = await getCurrentUser();
  if (!session.organizationId) {
    throw new Error("Non autenticato");
  }

  const t = getDictionary(await getServerLocale());

  const parsed = statusSchema.safeParse({ candidateId, status });
  if (!parsed.success) {
    throw new Error(t.common.invalidData);
  }

  const { id: userId, organizationId } = session;
  await requireCandidateAccess(organizationId, parsed.data.candidateId, session.role);

  // Status is per organization: ADMIN_KUBRI too writes its own org's status.
  await changeCandidateStatus({
    candidateId: parsed.data.candidateId,
    organizationId,
    userId,
    status: parsed.data.status,
  });

  revalidatePath("/dashboard/candidates");
  revalidatePath(`/dashboard/candidates/${parsed.data.candidateId}`);
}
```

- [ ] **Step 4:** run → PASS. **Step 5: Commit** `feat(candidates): add setCandidateStatus server action`

---

### Task 7: CSV export

**Files:** Modify `src/lib/export/csv.ts`, both CSV routes; Test `src/__tests__/lib/export/csv.test.ts`

- [ ] **Step 1: Update tests.** Header expectation becomes `…,Lavoro desiderato,Liste,Stato,Data,Canale`. Add:

```ts
  it("includes the org's status label, defaulting to Nuovo", () => {
    const csv = candidatesToCsv(
      [makeCandidate({ id: "c1" }), makeCandidate({ id: "c2" })],
      {},
      dict,
      DEFAULT_LOCALE,
      { c1: "HIRED" },
    );
    const [, row1, row2] = csv.replace("﻿", "").split("\n");
    expect(row1).toContain(",Assunto,");
    expect(row2).toContain(",Nuovo,");
  });
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** Add 5th param `statusByCandidateId: StatusByCandidate = {}`, header `csv.headerStatus` after `csv.headerLists`, cell `dictionary.candidateStatus.values[resolveStatus(statusByCandidateId, c.id)]` after the lists cell.
  - `export/csv/route.ts`: `const statusByCandidate = await getStatusByCandidateForOrg(organizationId);` before filtering; `candidates = filterByStatus(candidates, statusByCandidate, filters.status);` after the list filter; pass `statusByCandidate` to `candidatesToCsv`.
  - `lists/[listId]/export/csv/route.ts`: load the map and pass it as 5th arg.
- [ ] **Step 4:** run → PASS. **Step 5: Commit** `feat(export): include candidate status in CSV`

---

### Task 8: `CandidateStatusSelect` component

**Files:** Create `src/components/candidates/candidate-status-select.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useState, useTransition } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  CANDIDATE_STATUSES,
  type CandidateStatusValue,
} from "@/lib/candidates/status";
import { setCandidateStatus } from "@/app/(dashboard)/dashboard/candidates/[id]/actions";

const STATUS_STYLES: Record<CandidateStatusValue, string> = {
  NEW: "border-border bg-muted text-foreground",
  SCREENING: "border-sky-200 bg-sky-50 text-sky-700",
  CONTACTED: "border-sky-200 bg-sky-50 text-sky-700",
  INTERVIEW: "border-blue-200 bg-blue-50 text-blue-700",
  OFFER: "border-indigo-200 bg-indigo-50 text-indigo-700",
  HIRED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  REJECTED: "border-red-200 bg-red-50 text-red-700",
  WITHDRAWN: "border-border bg-transparent text-muted-foreground",
};

interface CandidateStatusSelectProps {
  candidateId: string;
  status: CandidateStatusValue;
}

export function CandidateStatusSelect({ candidateId, status }: CandidateStatusSelectProps) {
  const t = useT();
  const [current, setCurrent] = useState<CandidateStatusValue>(status);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const select = (next: CandidateStatusValue) => {
    setOpen(false);
    if (next === current) return;
    const previous = current;
    setCurrent(next);
    setError(null);
    startTransition(async () => {
      try {
        await setCandidateStatus(candidateId, next);
      } catch {
        // Rollback optimistic update on error
        setCurrent(previous);
        setError(t.candidateStatus.updateError);
      }
    });
  };

  return (
    // Stop clicks (including from the portalled popup) reaching the table row.
    <div className="inline-flex flex-col items-start" onClick={(e) => e.stopPropagation()}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label={t.candidateStatus.label}
              disabled={isPending}
              className={cn(
                "inline-flex h-6 items-center gap-1 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap transition-colors hover:opacity-80 disabled:opacity-60",
                STATUS_STYLES[current],
              )}
            >
              {t.candidateStatus.values[current]}
              {isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>
          }
        />
        <PopoverContent align="start" className="w-48 p-1">
          {CANDIDATE_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => select(s)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            >
              <span className={cn("h-2 w-2 shrink-0 rounded-full border", STATUS_STYLES[s])} />
              <span className="flex-1 text-left">{t.candidateStatus.values[s]}</span>
              {s === current && <Check className="h-4 w-4 text-muted-foreground" />}
            </button>
          ))}
        </PopoverContent>
      </Popover>
      {error && <p className="pt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2:** `pnpm exec tsc --noEmit` → pass. **Step 3: Commit** `feat(candidates): add status dropdown component`

---

### Task 9: Wire table, filters, list page, detail page

**Files:** Modify `candidates-table.tsx`, `candidate-filters.tsx`, `candidates/page.tsx`, `candidates/[id]/page.tsx`

- [ ] **Step 1: Table.** Add prop `statusByCandidate: StatusByCandidate`; `const t = useT();`; header `<TableHead className="w-36">{t.candidateStatus.label}</TableHead>` after "Nome"; cell:

```tsx
<TableCell onClick={(e) => e.stopPropagation()}>
  <CandidateStatusSelect
    candidateId={candidate.id}
    status={resolveStatus(statusByCandidate, candidate.id)}
  />
</TableCell>
```

- [ ] **Step 2: Filters.** Add `status?: string` to `initialFilters`; state `const [status, setStatus] = useState(initialFilters.status ?? "");`; `setOrDelete("status", status);` + dependency; reset `setStatus("")`. Replace the `lists.length > 0 &&` block with an always-rendered grid whose first cell is:

```tsx
<div>
  <label className="mb-2 block text-sm font-medium">{t.candidateStatus.label}</label>
  <select
    value={status}
    onChange={(e) => setStatus(e.target.value)}
    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
  >
    <option value="">{t.candidateStatus.filterAll}</option>
    {CANDIDATE_STATUSES.map((s) => (
      <option key={s} value={s}>{t.candidateStatus.values[s]}</option>
    ))}
  </select>
</div>
```
followed by the list select only when `lists.length > 0`.

- [ ] **Step 3: List page.** After the list-membership filter:

```ts
const statusByCandidate = await getStatusByCandidateForOrg(user.organizationId);
candidates = filterByStatus(candidates, statusByCandidate, filters.status);
```
Pass `statusByCandidate={statusByCandidate}` to `CandidatesTable`.

- [ ] **Step 4: Detail page.** Add `getCandidateStatusForOrg(organizationId, id)` to the `Promise.all` (→ `status`). At the top of the sidebar:

```tsx
<div className="rounded-lg border border-border/60 bg-card p-4 shadow-sm">
  <div className="flex items-center justify-between">
    <span className="text-sm font-medium">{t.candidateStatus.label}</span>
    <CandidateStatusSelect candidateId={id} status={status} />
  </div>
</div>
```

- [ ] **Step 5:** `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test` → pass (DB-backed tests failing for missing `DATABASE_URL` are pre-existing, not regressions).
- [ ] **Step 6: Commit** `feat(candidates): status column, filter and detail dropdown`

---

### Task 10: Verify & ship

- [ ] `pnpm --filter kubri-dashboard build` passes.
- [ ] Push branch, open PR to `main`; PR body reminds: apply migration to prod with `migrate deploy` **before** merging.
