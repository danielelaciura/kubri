# Liste di candidati — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere liste di candidati org-scoped e condivise (creazione, membership, vista dedicata, filtro e export), sostituendo il sistema dei tag oggi inutilizzato.

**Architecture:** Due nuovi modelli Prisma (`CandidateList`, `CandidateListMembership`); un layer di servizio in `src/lib/lists/`; server action in `src/app/(dashboard)/dashboard/lists/actions.ts`; un componente client riusabile `AddToListMenu` (dropdown a checkbox con creazione al volo) montato in tre punti; una sezione "Liste" con pagina elenco e drill-down; filtro `listId` e colonna "Liste" nell'export CSV, più export CSV per singola lista.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Prisma 7, Supabase Postgres, shadcn/ui (`DropdownMenuCheckboxItem`), Vitest, Zod v4.

**Spec di riferimento:** `docs/superpowers/specs/2026-06-05-candidate-lists-design.md`

---

## Convenzioni di test in questo codebase (leggere prima di iniziare)

- I test su **funzioni pure** (es. `src/__tests__/lib/export/csv.test.ts`, `filter.test.ts`, `validations/*.test.ts`) girano realmente con `pnpm test`.
- I test che **toccano il DB** sono `describe.skip` perché usano `deleteMany({})` che cancellerebbe il DB dev (vedi `src/lib/pools/__tests__/actions.test.ts`). Per le server action di questa feature si segue lo stesso pattern: test di integrazione scritti ma `describe.skip`, da abilitare in futuro con un DB di test dedicato.
- Comando test mirato: `pnpm vitest run <path> -t "<nome>"`.
- Lint: `pnpm lint`. Type-check rapido: `pnpm exec tsc --noEmit`.

---

## File Structure

**Nuovi file:**
- `src/lib/lists/service.ts` — query org-scoped sulle liste e sulle membership.
- `src/lib/validations/list.ts` — schemi Zod per nome lista e param filtro.
- `src/app/(dashboard)/dashboard/lists/actions.ts` — server action (create/rename/delete/add/remove).
- `src/app/(dashboard)/dashboard/lists/page.tsx` — elenco liste dell'org.
- `src/app/(dashboard)/dashboard/lists/[id]/page.tsx` — drill-down lista.
- `src/components/lists/add-to-list-menu.tsx` — dropdown a checkbox riusabile.
- `src/components/lists/lists-manager.tsx` — UI client elenco/crea/rinomina/elimina liste.
- `src/app/api/candidates/lists/[listId]/export/csv/route.ts` — export CSV per lista.
- Test: `src/__tests__/lib/export/csv.test.ts` (estensione), `src/__tests__/lib/validations/list.test.ts`, `src/__tests__/lib/lists/service.test.ts`, `src/__tests__/app/dashboard/lists/actions.test.ts` (skip).

**File modificati:**
- `prisma/schema.prisma` — nuovi modelli, drop `CandidateTag`, relazioni.
- `src/lib/export/csv.ts` — colonna "Liste".
- `src/lib/validations/candidate-filters.ts` — param `listId`.
- `src/app/(dashboard)/dashboard/candidates/page.tsx` — filtro lista + dati per il menu.
- `src/components/candidates/candidate-filters.tsx` — selettore lista.
- `src/components/candidates/candidates-table.tsx` — colonna azione con `AddToListMenu`.
- `src/components/jobs/match-table.tsx` — `AddToListMenu` per riga.
- `src/app/(dashboard)/dashboard/jobs/[id]/page.tsx` — carica liste + membership e passa a `MatchTable`.
- `src/app/(dashboard)/dashboard/candidates/[id]/page.tsx` — sostituisce il riquadro Tag.
- `src/app/(dashboard)/dashboard/candidates/[id]/actions.ts` — rimuove `addTag`/`removeTag`.
- `src/app/api/candidates/export/csv/route.ts` — passa la mappa liste alla CSV.
- `src/components/layout/app-sidebar.tsx` — voce "Liste".
- `src/lib/i18n/strings.ts` — nuove stringhe.
- `src/components/candidates/candidate-tags.tsx` — eliminato.
- `src/lib/pools/__tests__/{actions,access,resolve}.test.ts` — rimuove `prisma.candidateTag.deleteMany({})`.

---

## Task 1: Schema Prisma + migrazione (nuovi modelli, drop tag)

**Files:**
- Modify: `prisma/schema.prisma`
- Create (generata): `prisma/migrations/<timestamp>_add_candidate_lists_drop_tags/migration.sql`

- [ ] **Step 1: Rimuovere il modello `CandidateTag` e le sue relazioni**

In `prisma/schema.prisma`:
- Elimina interamente il blocco `model CandidateTag { ... }`.
- In `model Organization`, rimuovi la riga `candidateTags   CandidateTag[]`.
- In `model Candidate`, rimuovi la riga `tags  CandidateTag[]`.

- [ ] **Step 2: Aggiungere i nuovi modelli**

Aggiungi in fondo a `prisma/schema.prisma`:

```prisma
model CandidateList {
  id              String   @id @default(uuid()) @db.Uuid
  organizationId  String   @db.Uuid
  name            String
  createdByUserId String?  @db.Uuid
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  organization Organization              @relation(fields: [organizationId], references: [id])
  createdBy    User?                     @relation(fields: [createdByUserId], references: [id], onDelete: SetNull)
  members      CandidateListMembership[]

  @@unique([organizationId, name])
  @@index([organizationId])
}

model CandidateListMembership {
  listId        String   @db.Uuid
  candidateId   String   @db.Uuid
  addedByUserId String?  @db.Uuid
  createdAt     DateTime @default(now())

  list      CandidateList @relation(fields: [listId], references: [id], onDelete: Cascade)
  candidate Candidate     @relation(fields: [candidateId], references: [id], onDelete: Cascade)
  addedBy   User?         @relation(fields: [addedByUserId], references: [id], onDelete: SetNull)

  @@id([listId, candidateId])
  @@index([candidateId])
}
```

- [ ] **Step 3: Aggiungere le relazioni inverse**

- In `model Candidate`, aggiungi: `listMemberships CandidateListMembership[]`
- In `model Organization`, aggiungi: `candidateLists CandidateList[]`
- In `model User`, aggiungi:
  ```prisma
  candidateLists       CandidateList[]
  listMembershipsAdded CandidateListMembership[]
  ```

- [ ] **Step 4: Generare la migrazione (dev)**

Run: `pnpm prisma migrate dev --name add_candidate_lists_drop_tags`
Expected: crea le due tabelle e droppa `CandidateTag`. La migrazione fallisce/avvisa solo se ci sono dati FK; va bene.

- [ ] **Step 5: Ripulire il `DROP INDEX` spurio HNSW**

Apri il file `migration.sql` appena generato. Se contiene istruzioni `DROP INDEX ...` relative agli indici HNSW/pgvector su `Candidate`/`JobDescription` (drift noto), **eliminale** dal file prima di committare. La migrazione deve contenere solo: create delle due nuove tabelle, relativi indici/constraint, e `DROP TABLE "CandidateTag"`.

- [ ] **Step 6: Rigenerare il client e verificare i tipi**

Run: `pnpm prisma generate`
Run: `pnpm exec tsc --noEmit`
Expected: errori SOLO nei file che ancora referenziano `prisma.candidateTag` / il modello tag (verranno sistemati nel Task 2). Nessun errore relativo ai nuovi modelli.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(lists): add CandidateList schema, drop CandidateTag"
```

---

## Task 2: Rimuovere il codice dei tag

**Files:**
- Delete: `src/components/candidates/candidate-tags.tsx`
- Modify: `src/app/(dashboard)/dashboard/candidates/[id]/actions.ts`
- Modify: `src/app/(dashboard)/dashboard/candidates/[id]/page.tsx`
- Modify: `src/lib/pools/__tests__/actions.test.ts:31`
- Modify: `src/lib/pools/__tests__/access.test.ts:16`
- Modify: `src/lib/pools/__tests__/resolve.test.ts:10`

- [ ] **Step 1: Eliminare il componente tag**

```bash
git rm src/components/candidates/candidate-tags.tsx
```

- [ ] **Step 2: Rimuovere `addTag`/`removeTag` e lo schema tag**

In `src/app/(dashboard)/dashboard/candidates/[id]/actions.ts`:
- Elimina la costante `tagSchema`.
- Elimina interamente le funzioni `export async function addTag(...)` e `export async function removeTag(...)`.
- Lascia invariate `addNote` e `requireCandidateAccess` (quest'ultima sarà riusata dalle action liste tramite import).

- [ ] **Step 3: Rimuovere il riquadro Tag dalla scheda candidato**

In `src/app/(dashboard)/dashboard/candidates/[id]/page.tsx`:
- Rimuovi `import { CandidateTags } ...` (riga ~10).
- Rimuovi il blocco `prisma.candidateTag.findMany({ where: tagsWhere })` dalla `Promise.all` e la variabile `tags` correlata; rimuovi `tagsWhere` e `formattedTags`.
- Rimuovi `<CandidateTags tags={formattedTags} candidateId={id} />` (riga ~132).
- Lascia un segnaposto per il futuro montaggio del menu liste (Task 7) — per ora rimuovi solo il riferimento ai tag, senza aggiungere altro.

- [ ] **Step 4: Rimuovere i riferimenti tag nei test pool**

In ciascuno di questi file, elimina la riga `await prisma.candidateTag.deleteMany({});`:
- `src/lib/pools/__tests__/actions.test.ts`
- `src/lib/pools/__tests__/access.test.ts`
- `src/lib/pools/__tests__/resolve.test.ts`

- [ ] **Step 5: Verificare assenza di riferimenti residui**

Run: `grep -rn "candidateTag\|CandidateTag\|candidate-tags\|addTag\|removeTag" src`
Expected: nessun risultato.

- [ ] **Step 6: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: PASS (nessun errore).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(lists): remove unused candidate tag code"
```

---

## Task 3: Validazioni liste (TDD)

**Files:**
- Create: `src/lib/validations/list.ts`
- Test: `src/__tests__/lib/validations/list.test.ts`
- Modify: `src/lib/validations/candidate-filters.ts`

- [ ] **Step 1: Scrivere il test che fallisce**

Create `src/__tests__/lib/validations/list.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { listNameSchema } from "@/lib/validations/list";

describe("listNameSchema", () => {
  it("trims and accepts a valid name", () => {
    const r = listNameSchema.parse("  Camerieri  ");
    expect(r).toBe("Camerieri");
  });

  it("rejects an empty name", () => {
    const r = listNameSchema.safeParse("   ");
    expect(r.success).toBe(false);
  });

  it("rejects a name longer than 80 chars", () => {
    const r = listNameSchema.safeParse("a".repeat(81));
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Eseguire il test (deve fallire)**

Run: `pnpm vitest run src/__tests__/lib/validations/list.test.ts`
Expected: FAIL — `Cannot find module '@/lib/validations/list'`.

- [ ] **Step 3: Implementare lo schema**

Create `src/lib/validations/list.ts`:

```typescript
import { z } from "zod/v4";

export const listNameSchema = z
  .string()
  .transform((v) => v.trim())
  .pipe(
    z
      .string()
      .min(1, "Il nome della lista non può essere vuoto")
      .max(80, "Il nome della lista è troppo lungo"),
  );

export const createListSchema = z.object({
  name: listNameSchema,
});

export const renameListSchema = z.object({
  listId: z.string().uuid(),
  name: listNameSchema,
});

export const listMembershipSchema = z.object({
  listId: z.string().uuid(),
  candidateId: z.string().uuid(),
});
```

- [ ] **Step 4: Eseguire il test (deve passare)**

Run: `pnpm vitest run src/__tests__/lib/validations/list.test.ts`
Expected: PASS (3 test).

- [ ] **Step 5: Aggiungere il param `listId` ai filtri candidati**

In `src/lib/validations/candidate-filters.ts`:
- Nello `candidateFiltersSchema`, aggiungi dopo `radiusKm`: `listId: z.string().uuid().optional(),`
- In `CandidateFilters` (in `src/types/index.ts`) aggiungi `listId?: string;`
- In `toFiltersAndSort`, aggiungi: `if (params.listId) filters.listId = params.listId;`

- [ ] **Step 6: Type-check + commit**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

```bash
git add src/lib/validations/list.ts src/__tests__/lib/validations/list.test.ts src/lib/validations/candidate-filters.ts src/types/index.ts
git commit -m "feat(lists): add list validation schemas and listId filter param"
```

---

## Task 4: Service liste (TDD per gli helper puri)

**Files:**
- Create: `src/lib/lists/service.ts`
- Test: `src/__tests__/lib/lists/service.test.ts`

- [ ] **Step 1: Scrivere il test della funzione pura**

`service.ts` conterrà anche un helper puro `buildListNamesByCandidate` facilmente testabile senza DB.

Create `src/__tests__/lib/lists/service.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildListNamesByCandidate } from "@/lib/lists/service";

describe("buildListNamesByCandidate", () => {
  it("maps each candidate to the names of its lists", () => {
    const lists = [
      { id: "l1", name: "Camerieri" },
      { id: "l2", name: "Palermo" },
    ];
    const memberships = [
      { listId: "l1", candidateId: "c1" },
      { listId: "l2", candidateId: "c1" },
      { listId: "l1", candidateId: "c2" },
    ];
    const map = buildListNamesByCandidate(lists, memberships);
    expect(map["c1"]).toEqual(["Camerieri", "Palermo"]);
    expect(map["c2"]).toEqual(["Camerieri"]);
    expect(map["c3"]).toBeUndefined();
  });

  it("returns an empty object when there are no memberships", () => {
    expect(buildListNamesByCandidate([{ id: "l1", name: "X" }], [])).toEqual({});
  });
});
```

- [ ] **Step 2: Eseguire il test (deve fallire)**

Run: `pnpm vitest run src/__tests__/lib/lists/service.test.ts`
Expected: FAIL — modulo non trovato.

- [ ] **Step 3: Implementare il service**

Create `src/lib/lists/service.ts`:

```typescript
import { prisma } from "@/lib/db";
import { getOrgAccessiblePoolIds } from "@/lib/pools/access";

export interface ListSummary {
  id: string;
  name: string;
  memberCount: number;
}

/** Helper puro: candidateId -> nomi delle liste a cui appartiene. */
export function buildListNamesByCandidate(
  lists: { id: string; name: string }[],
  memberships: { listId: string; candidateId: string }[],
): Record<string, string[]> {
  const nameById = new Map(lists.map((l) => [l.id, l.name]));
  const out: Record<string, string[]> = {};
  for (const m of memberships) {
    const name = nameById.get(m.listId);
    if (!name) continue;
    (out[m.candidateId] ??= []).push(name);
  }
  return out;
}

/** Liste dell'org con conteggio membri, ordinate per nome. */
export async function getListsForOrg(
  organizationId: string,
): Promise<ListSummary[]> {
  const rows = await prisma.candidateList.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, _count: { select: { members: true } } },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, memberCount: r._count.members }));
}

/** Liste dell'org (solo id+name) per popolare i menu. */
export async function getListOptionsForOrg(
  organizationId: string,
): Promise<{ id: string; name: string }[]> {
  return prisma.candidateList.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

/** Mappa candidateId -> listIds[] per le liste dell'org (stato dei menu). */
export async function getListIdsByCandidateForOrg(
  organizationId: string,
): Promise<Record<string, string[]>> {
  const rows = await prisma.candidateListMembership.findMany({
    where: { list: { organizationId } },
    select: { listId: true, candidateId: true },
  });
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[r.candidateId] ??= []).push(r.listId);
  return out;
}

/** Mappa candidateId -> nomi liste (per l'export CSV). */
export async function getListNamesByCandidateForOrg(
  organizationId: string,
): Promise<Record<string, string[]>> {
  const [lists, memberships] = await Promise.all([
    getListOptionsForOrg(organizationId),
    prisma.candidateListMembership.findMany({
      where: { list: { organizationId } },
      select: { listId: true, candidateId: true },
    }),
  ]);
  return buildListNamesByCandidate(lists, memberships);
}

/** Una lista dell'org con i candidateId dei membri (accesso scoping a valle). */
export async function getListWithMemberIds(
  organizationId: string,
  listId: string,
): Promise<{ id: string; name: string; candidateIds: string[] } | null> {
  const list = await prisma.candidateList.findFirst({
    where: { id: listId, organizationId },
    select: { id: true, name: true, members: { select: { candidateId: true } } },
  });
  if (!list) return null;
  return {
    id: list.id,
    name: list.name,
    candidateIds: list.members.map((m) => m.candidateId),
  };
}

/** Restringe un set di candidati a quelli presenti nella lista. */
export async function getMemberCandidateIdSet(
  organizationId: string,
  listId: string,
): Promise<Set<string> | null> {
  const list = await getListWithMemberIds(organizationId, listId);
  if (!list) return null;
  return new Set(list.candidateIds);
}

// `getOrgAccessiblePoolIds` è già usata altrove per lo scoping dei candidati;
// l'export per lista la riutilizza per non leakare candidati di pool non accessibili.
export { getOrgAccessiblePoolIds };
```

- [ ] **Step 4: Eseguire il test (deve passare)**

Run: `pnpm vitest run src/__tests__/lib/lists/service.test.ts`
Expected: PASS (2 test).

- [ ] **Step 5: Type-check + commit**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

```bash
git add src/lib/lists/service.ts src/__tests__/lib/lists/service.test.ts
git commit -m "feat(lists): add list service with pure name-mapping helper"
```

---

## Task 5: Server action liste

**Files:**
- Create: `src/app/(dashboard)/dashboard/lists/actions.ts`
- Test: `src/__tests__/app/dashboard/lists/actions.test.ts` (describe.skip, segue il pattern pool)

- [ ] **Step 1: Implementare le server action**

Create `src/app/(dashboard)/dashboard/lists/actions.ts`:

```typescript
"use server";

import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getOrgAccessiblePoolIds } from "@/lib/pools/access";
import {
  createListSchema,
  renameListSchema,
  listMembershipSchema,
} from "@/lib/validations/list";
import { revalidatePath } from "next/cache";

async function requireSession() {
  const session = await getCurrentUser();
  if (!session.organizationId) throw new Error("Non autenticato");
  return session as typeof session & { organizationId: string };
}

async function requireCandidateAccessibleToOrg(
  organizationId: string,
  candidateId: string,
  role: string,
): Promise<void> {
  if (role === "ADMIN_KUBRI") {
    const exists = await prisma.candidate.findUnique({
      where: { id: candidateId },
      select: { id: true },
    });
    if (!exists) throw new Error("Candidato non accessibile");
    return;
  }
  const poolIds = await getOrgAccessiblePoolIds(organizationId);
  if (poolIds.length === 0) throw new Error("Candidato non accessibile");
  const exists = await prisma.candidate.findFirst({
    where: { id: candidateId, poolId: { in: poolIds } },
    select: { id: true },
  });
  if (!exists) throw new Error("Candidato non accessibile");
}

async function requireListInOrg(organizationId: string, listId: string) {
  const list = await prisma.candidateList.findFirst({
    where: { id: listId, organizationId },
    select: { id: true },
  });
  if (!list) throw new Error("Lista non trovata");
  return list;
}

export async function createList(formData: FormData) {
  const session = await requireSession();
  const parsed = createListSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Dati non validi");
  }
  const { name } = parsed.data;
  const { id: userId, organizationId } = session;

  const dup = await prisma.candidateList.findFirst({
    where: { organizationId, name },
    select: { id: true },
  });
  if (dup) throw new Error("Esiste già una lista con questo nome");

  const list = await prisma.candidateList.create({
    data: { organizationId, name, createdByUserId: userId },
  });
  await logAudit({
    userId,
    organizationId,
    action: "list.create",
    resourceType: "candidate_list",
    resourceId: list.id,
    metadata: { name },
  });
  revalidatePath("/dashboard/lists");
  return { id: list.id, name: list.name };
}

export async function renameList(formData: FormData) {
  const session = await requireSession();
  const parsed = renameListSchema.safeParse({
    listId: formData.get("listId"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Dati non validi");
  }
  const { listId, name } = parsed.data;
  const { id: userId, organizationId } = session;
  await requireListInOrg(organizationId, listId);

  const dup = await prisma.candidateList.findFirst({
    where: { organizationId, name, id: { not: listId } },
    select: { id: true },
  });
  if (dup) throw new Error("Esiste già una lista con questo nome");

  await prisma.candidateList.update({ where: { id: listId }, data: { name } });
  await logAudit({
    userId,
    organizationId,
    action: "list.rename",
    resourceType: "candidate_list",
    resourceId: listId,
    metadata: { name },
  });
  revalidatePath("/dashboard/lists");
  revalidatePath(`/dashboard/lists/${listId}`);
}

export async function deleteList(listId: string) {
  const session = await requireSession();
  const { id: userId, organizationId } = session;
  await requireListInOrg(organizationId, listId);

  await prisma.candidateList.delete({ where: { id: listId } });
  await logAudit({
    userId,
    organizationId,
    action: "list.delete",
    resourceType: "candidate_list",
    resourceId: listId,
  });
  revalidatePath("/dashboard/lists");
}

export async function addCandidateToList(listId: string, candidateId: string) {
  const session = await requireSession();
  const parsed = listMembershipSchema.safeParse({ listId, candidateId });
  if (!parsed.success) throw new Error("Dati non validi");
  const { id: userId, organizationId, role } = session;

  await requireListInOrg(organizationId, listId);
  await requireCandidateAccessibleToOrg(organizationId, candidateId, role);

  await prisma.candidateListMembership.upsert({
    where: { listId_candidateId: { listId, candidateId } },
    create: { listId, candidateId, addedByUserId: userId },
    update: {},
  });
  await logAudit({
    userId,
    organizationId,
    action: "list.member.add",
    resourceType: "candidate_list",
    resourceId: listId,
    metadata: { candidateId },
  });
  revalidatePath("/dashboard/candidates");
  revalidatePath(`/dashboard/lists/${listId}`);
}

export async function removeCandidateFromList(listId: string, candidateId: string) {
  const session = await requireSession();
  const parsed = listMembershipSchema.safeParse({ listId, candidateId });
  if (!parsed.success) throw new Error("Dati non validi");
  const { id: userId, organizationId } = session;

  await requireListInOrg(organizationId, listId);
  await prisma.candidateListMembership.deleteMany({ where: { listId, candidateId } });
  await logAudit({
    userId,
    organizationId,
    action: "list.member.remove",
    resourceType: "candidate_list",
    resourceId: listId,
    metadata: { candidateId },
  });
  revalidatePath("/dashboard/candidates");
  revalidatePath(`/dashboard/lists/${listId}`);
}
```

- [ ] **Step 2: Scrivere il test di integrazione (skip, pattern pool)**

Create `src/__tests__/app/dashboard/lists/actions.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

const member = {
  id: "00000000-0000-0000-0000-0000000000a1",
  email: "member@kubri.test",
  name: "Test Member",
  role: "ORG_MEMBER" as const,
  organizationId: "00000000-0000-0000-0000-0000000000b1",
};

vi.mock("@/lib/auth-utils", () => ({
  getCurrentUser: vi.fn(async () => member),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// SKIPPED: come i test pool, le mutazioni toccano il DB dev.
// Abilitare con un DB di test dedicato.
describe.skip("list actions", () => {
  it("createList rejects a duplicate name in the same org", async () => {
    const { createList } = await import(
      "@/app/(dashboard)/dashboard/lists/actions"
    );
    const fd = new FormData();
    fd.set("name", "Camerieri");
    await createList(fd);
    const fd2 = new FormData();
    fd2.set("name", "Camerieri");
    await expect(createList(fd2)).rejects.toThrow(/già una lista/);
  });
});
```

- [ ] **Step 3: Verificare che la suite non rompa (i test skip non girano)**

Run: `pnpm vitest run src/__tests__/app/dashboard/lists/actions.test.ts`
Expected: PASS (0 test eseguiti, 1 skipped).

- [ ] **Step 4: Type-check + commit**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

```bash
git add "src/app/(dashboard)/dashboard/lists/actions.ts" src/__tests__/app/dashboard/lists/actions.test.ts
git commit -m "feat(lists): add list server actions (create/rename/delete/membership)"
```

---

## Task 6: Componente `AddToListMenu`

**Files:**
- Create: `src/components/lists/add-to-list-menu.tsx`

- [ ] **Step 1: Implementare il componente**

Create `src/components/lists/add-to-list-menu.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { ListPlus, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import {
  addCandidateToList,
  removeCandidateFromList,
  createList,
} from "@/app/(dashboard)/dashboard/lists/actions";

interface ListOption {
  id: string;
  name: string;
}

interface AddToListMenuProps {
  candidateId: string;
  lists: ListOption[];
  /** id delle liste a cui il candidato già appartiene */
  memberOf: string[];
  /** variante visiva: icona (tabelle) o bottone con testo (scheda) */
  variant?: "icon" | "button";
}

export function AddToListMenu({
  candidateId,
  lists,
  memberOf,
  variant = "icon",
}: AddToListMenuProps) {
  const [members, setMembers] = useState<Set<string>>(new Set(memberOf));
  const [options, setOptions] = useState<ListOption[]>(lists);
  const [newName, setNewName] = useState("");
  const [isPending, startTransition] = useTransition();

  const toggle = (listId: string, checked: boolean) => {
    setMembers((prev) => {
      const next = new Set(prev);
      if (checked) next.add(listId);
      else next.delete(listId);
      return next;
    });
    startTransition(async () => {
      try {
        if (checked) await addCandidateToList(listId, candidateId);
        else await removeCandidateFromList(listId, candidateId);
      } catch {
        // rollback ottimistico in caso di errore
        setMembers((prev) => {
          const next = new Set(prev);
          if (checked) next.delete(listId);
          else next.add(listId);
          return next;
        });
      }
    });
  };

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("name", name);
        const created = await createList(fd);
        setOptions((prev) =>
          [...prev, created].sort((a, b) => a.name.localeCompare(b.name)),
        );
        setNewName("");
        await addCandidateToList(created.id, candidateId);
        setMembers((prev) => new Set(prev).add(created.id));
      } catch {
        // no-op: l'utente può riprovare
      }
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          variant === "button" ? (
            <Button variant="outline" size="sm" className="gap-2">
              <ListPlus className="h-4 w-4" />
              Aggiungi a lista
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Aggiungi a lista"
              onClick={(e) => e.stopPropagation()}
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ListPlus className="h-4 w-4" />
              )}
            </Button>
          )
        }
      />
      <DropdownMenuContent
        align="end"
        className="w-60"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenuLabel>Liste</DropdownMenuLabel>
        {options.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">
            Nessuna lista. Creane una qui sotto.
          </p>
        ) : (
          options.map((l) => (
            <DropdownMenuCheckboxItem
              key={l.id}
              checked={members.has(l.id)}
              onCheckedChange={(c) => toggle(l.id, c === true)}
              onSelect={(e) => e.preventDefault()}
            >
              {l.name}
            </DropdownMenuCheckboxItem>
          ))
        )}
        <DropdownMenuSeparator />
        <div className="flex items-center gap-1 p-1">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCreate();
              }
            }}
            placeholder="Nuova lista..."
            className="h-8 flex-1"
          />
          <Button
            size="icon"
            className="h-8 w-8 shrink-0"
            disabled={isPending || !newName.trim()}
            onClick={handleCreate}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2: Type-check + commit**

Run: `pnpm exec tsc --noEmit`
Expected: PASS. (Se l'API `render`/`onCheckedChange` del wrapper `dropdown-menu.tsx` differisce, adattare ai prop esposti in `src/components/ui/dropdown-menu.tsx` — è basato su Base UI come gli altri componenti, vedi l'uso di `render` in `app-sidebar.tsx`.)

```bash
git add src/components/lists/add-to-list-menu.tsx
git commit -m "feat(lists): add reusable AddToListMenu component"
```

---

## Task 7: Montare `AddToListMenu` nei tre punti

**Files:**
- Modify: `src/components/candidates/candidates-table.tsx`
- Modify: `src/app/(dashboard)/dashboard/candidates/page.tsx`
- Modify: `src/components/jobs/match-table.tsx`
- Modify: `src/app/(dashboard)/dashboard/jobs/[id]/page.tsx`
- Modify: `src/app/(dashboard)/dashboard/candidates/[id]/page.tsx`

- [ ] **Step 1: Estendere `CandidatesTable` con i dati liste**

In `src/components/candidates/candidates-table.tsx`:
- Aggiungi import: `import { AddToListMenu } from "@/components/lists/add-to-list-menu";`
- Estendi le props:
  ```typescript
  interface CandidatesTableProps {
    result: PaginatedResult<Candidate>;
    sort: SortConfig;
    lists: { id: string; name: string }[];
    membershipByCandidate: Record<string, string[]>;
  }
  ```
  e nella firma: `export function CandidatesTable({ result, sort, lists, membershipByCandidate }: CandidatesTableProps)`.
- Aggiungi una colonna header in coda: `<TableHead className="w-12" />`.
- Aggiungi una cella in coda a ogni riga, fermando la propagazione del click (la riga è cliccabile):
  ```tsx
  <TableCell className="w-12" onClick={(e) => e.stopPropagation()}>
    <AddToListMenu
      candidateId={candidate.id}
      lists={lists}
      memberOf={membershipByCandidate[candidate.id] ?? []}
    />
  </TableCell>
  ```

- [ ] **Step 2: Passare i dati dalla pagina candidati**

In `src/app/(dashboard)/dashboard/candidates/page.tsx`:
- Import: `import { getListOptionsForOrg, getListIdsByCandidateForOrg } from "@/lib/lists/service";`
- Dopo aver risolto l'org dell'utente, carica (per utenti org; per ADMIN_KUBRI usa l'org dell'utente se presente, altrimenti `[]`/`{}`):
  ```typescript
  const lists = user.organizationId
    ? await getListOptionsForOrg(user.organizationId)
    : [];
  const membershipByCandidate = user.organizationId
    ? await getListIdsByCandidateForOrg(user.organizationId)
    : {};
  ```
- Passa le props: `<CandidatesTable result={result} sort={sort} lists={lists} membershipByCandidate={membershipByCandidate} />`.

- [ ] **Step 3: `AddToListMenu` nella match table**

In `src/components/jobs/match-table.tsx`:
- Aggiungi import `AddToListMenu`.
- Estendi `MatchTableProps` con `lists: { id: string; name: string }[]` e `membershipByCandidate: Record<string, string[]>`.
- Propaga a `CandidateRow` come props.
- Nella griglia header aggiungi una colonna vuota finale e nella `CandidateRow` aggiungi una cella in coda:
  ```tsx
  <div className="flex items-start justify-end">
    <AddToListMenu
      candidateId={candidate.id}
      lists={lists}
      memberOf={membershipByCandidate[candidate.id] ?? []}
    />
  </div>
  ```
  Aggiorna le classi `grid-cols-...` (header e riga) aggiungendo una traccia finale `auto`, es. da `...minmax(0,2.4fr)]` a `...minmax(0,2.4fr)_auto]`.

- [ ] **Step 4: Passare i dati dalla pagina job**

In `src/app/(dashboard)/dashboard/jobs/[id]/page.tsx`:
- Import: `import { getListOptionsForOrg, getListIdsByCandidateForOrg } from "@/lib/lists/service";`
- Nel componente `Matches` (che ha `orgId`), carica `lists` e `membershipByCandidate` con le funzioni sopra e passali a `<MatchTable ranked={...} lists={lists} membershipByCandidate={membershipByCandidate} />`.

- [ ] **Step 5: `AddToListMenu` nella scheda candidato**

In `src/app/(dashboard)/dashboard/candidates/[id]/page.tsx`:
- Import: `AddToListMenu`, `getListOptionsForOrg`, `getListIdsByCandidateForOrg`.
- Carica per l'org dell'utente: `lists` e l'array `memberOf` per QUESTO candidato (`(await getListIdsByCandidateForOrg(orgId))[id] ?? []`).
- Nella colonna sidebar (dove prima c'era `<CandidateTags />`), monta:
  ```tsx
  <div className="rounded-lg border border-border/60 bg-card p-4 shadow-sm">
    <div className="mb-3 flex items-center justify-between">
      <span className="text-sm font-medium">Liste</span>
      <AddToListMenu
        candidateId={id}
        lists={lists}
        memberOf={memberOf}
        variant="button"
      />
    </div>
    {memberOf.length === 0 ? (
      <p className="text-sm text-muted-foreground">
        Non in nessuna lista
      </p>
    ) : (
      <div className="flex flex-wrap gap-1">
        {lists
          .filter((l) => memberOf.includes(l.id))
          .map((l) => (
            <span
              key={l.id}
              className="rounded-full bg-muted px-2 py-0.5 text-xs"
            >
              {l.name}
            </span>
          ))}
      </div>
    )}
  </div>
  ```

- [ ] **Step 6: Type-check + commit**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

```bash
git add -A
git commit -m "feat(lists): mount AddToListMenu in candidates table, match table, detail"
```

---

## Task 8: Filtro per lista nella pagina candidati

**Files:**
- Modify: `src/components/candidates/candidate-filters.tsx`
- Modify: `src/app/(dashboard)/dashboard/candidates/page.tsx`

- [ ] **Step 1: Applicare il filtro lista lato server**

In `src/app/(dashboard)/dashboard/candidates/page.tsx`:
- Import: `import { getMemberCandidateIdSet } from "@/lib/lists/service";`
- Dopo aver ottenuto `candidates` (e prima di `filterCandidates`), se è presente `filters.listId` e l'utente ha un'org:
  ```typescript
  if (filters.listId && user.organizationId) {
    const memberSet = await getMemberCandidateIdSet(
      user.organizationId,
      filters.listId,
    );
    candidates = memberSet
      ? candidates.filter((c) => memberSet.has(c.id))
      : [];
  }
  ```
  (Dichiara `candidates` con `let` se necessario.)

- [ ] **Step 2: Selettore lista nei filtri**

In `src/components/candidates/candidate-filters.tsx`:
- Estendi le props con `lists: { id: string; name: string }[]` e in `initialFilters` aggiungi `listId?: string`.
- Aggiungi uno stato `const [listId, setListId] = useState(initialFilters.listId ?? "");`.
- Aggiungi un campo `<select>` (stesso stile del select pageSize in `candidates-table.tsx`) nella griglia dei filtri:
  ```tsx
  <div>
    <label className="mb-2 block text-sm font-medium">Lista</label>
    <select
      value={listId}
      onChange={(e) => setListId(e.target.value)}
      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
    >
      <option value="">Tutte</option>
      {lists.map((l) => (
        <option key={l.id} value={l.id}>{l.name}</option>
      ))}
    </select>
  </div>
  ```
- In `applyFilters`, aggiungi `setOrDelete("listId", listId);`.
- In `resetFilters`, aggiungi `setListId("");`.
- In `candidates/page.tsx`, passa `lists` a `<CandidateFilters initialFilters={flatParams} lists={lists} />`.

- [ ] **Step 3: Type-check + commit**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

```bash
git add -A
git commit -m "feat(lists): filter candidates by list"
```

---

## Task 9: Export CSV — colonna "Liste" (TDD) e route per lista

**Files:**
- Modify: `src/lib/export/csv.ts`
- Modify: `src/__tests__/lib/export/csv.test.ts`
- Modify: `src/app/api/candidates/export/csv/route.ts`
- Create: `src/app/api/candidates/lists/[listId]/export/csv/route.ts`

- [ ] **Step 1: Aggiornare il test della CSV (header + colonna Liste)**

In `src/__tests__/lib/export/csv.test.ts`:
- Aggiorna il test sugli header: la stringa attesa ora termina con `...,Lavoro desiderato,Liste,Data,Canale`.
- Aggiungi un nuovo test:
  ```typescript
  it("includes the candidate's list names in the Liste column", () => {
    const c = makeCandidate({ id: "c1" });
    const csv = candidatesToCsv([c], { c1: ["Camerieri", "Palermo"] });
    expect(csv).toContain("Camerieri; Palermo");
  });

  it("leaves the Liste column empty when the candidate has no lists", () => {
    const c = makeCandidate({ id: "c1" });
    const csv = candidatesToCsv([c]);
    const dataLine = csv.replace("﻿", "").split("\n")[1];
    // colonna Liste presente ma vuota tra "Lavoro desiderato" e "Data"
    expect(dataLine).toContain("Cameriere,,");
  });
  ```

- [ ] **Step 2: Eseguire i test (devono fallire)**

Run: `pnpm vitest run src/__tests__/lib/export/csv.test.ts`
Expected: FAIL (header diverso, arg non gestito).

- [ ] **Step 3: Implementare la colonna Liste**

In `src/lib/export/csv.ts`:
- In `HEADERS`, inserisci `"Liste"` tra `"Lavoro desiderato"` e `"Data"`.
- Cambia la firma:
  ```typescript
  export function candidatesToCsv(
    candidates: Candidate[],
    listsByCandidateId: Record<string, string[]> = {},
  ): string {
  ```
- Nella riga mappata, inserisci tra `c.jobPreferences.desiredJob` e `c.createdAt...`:
  ```typescript
  (listsByCandidateId[c.id] ?? []).join("; "),
  ```

- [ ] **Step 4: Eseguire i test (devono passare)**

Run: `pnpm vitest run src/__tests__/lib/export/csv.test.ts`
Expected: PASS.

- [ ] **Step 5: Passare la mappa nell'export org esistente**

In `src/app/api/candidates/export/csv/route.ts`:
- Import: `import { getListNamesByCandidateForOrg } from "@/lib/lists/service";`
- Dopo `const sorted = sortCandidates(...)`:
  ```typescript
  const listNames = await getListNamesByCandidateForOrg(organizationId);
  const csv = candidatesToCsv(sorted, listNames);
  ```
  (sostituisce `const csv = candidatesToCsv(sorted);`)

- [ ] **Step 6: Creare la route export per lista**

Create `src/app/api/candidates/lists/[listId]/export/csv/route.ts`:

```typescript
import { requireOrganization } from "@/lib/auth-utils";
import { getCandidatesForOrg } from "@/lib/candidates/service";
import {
  getListWithMemberIds,
  getListNamesByCandidateForOrg,
} from "@/lib/lists/service";
import { candidatesToCsv } from "@/lib/export/csv";
import { logAudit } from "@/lib/audit";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ listId: string }> },
) {
  let session;
  try {
    session = await requireOrganization();
  } catch {
    return new Response("Non autorizzato", { status: 401 });
  }
  const { organizationId } = session;
  const { listId } = await params;

  try {
    const list = await getListWithMemberIds(organizationId, listId);
    if (!list) return new Response("Lista non trovata", { status: 404 });

    // candidati accessibili all'org, ristretti ai membri della lista
    const memberSet = new Set(list.candidateIds);
    const all = await getCandidatesForOrg(organizationId);
    const candidates = all.filter((c) => memberSet.has(c.id));

    const listNames = await getListNamesByCandidateForOrg(organizationId);
    const csv = candidatesToCsv(candidates, listNames);

    const slug = list.name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const today = new Date().toISOString().slice(0, 10);

    await logAudit({
      userId: session.id,
      organizationId,
      action: "export.csv",
      resourceType: "candidate_list",
      resourceId: listId,
      metadata: { count: candidates.length },
    });

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="lista-${slug || "candidati"}-${today}.csv"`,
      },
    });
  } catch {
    return new Response("Errore durante l'esportazione", { status: 500 });
  }
}
```

- [ ] **Step 7: Type-check + commit**

Run: `pnpm exec tsc --noEmit`
Run: `pnpm vitest run src/__tests__/lib/export/csv.test.ts`
Expected: entrambi PASS.

```bash
git add -A
git commit -m "feat(lists): add Liste column and per-list CSV export"
```

---

## Task 10: Sezione "Liste" (pagina elenco + drill-down) e navigazione

**Files:**
- Create: `src/components/lists/lists-manager.tsx`
- Create: `src/app/(dashboard)/dashboard/lists/page.tsx`
- Create: `src/app/(dashboard)/dashboard/lists/[id]/page.tsx`
- Modify: `src/lib/i18n/strings.ts`
- Modify: `src/components/layout/app-sidebar.tsx`

- [ ] **Step 1: Stringhe i18n**

In `src/lib/i18n/strings.ts`, in `nav` aggiungi `lists: "Liste",` e in `pages` aggiungi `lists: "Liste",`.

- [ ] **Step 2: Voce sidebar**

In `src/components/layout/app-sidebar.tsx`:
- Aggiungi `ListChecks` agli import da `lucide-react`.
- In `mainItems`, aggiungi dopo `candidates`:
  ```typescript
  { label: strings.nav.lists, href: "/dashboard/lists", icon: ListChecks },
  ```

- [ ] **Step 3: Componente client di gestione liste**

Create `src/components/lists/lists-manager.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, Plus, Trash2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  createList,
  deleteList,
} from "@/app/(dashboard)/dashboard/lists/actions";

interface ListRow {
  id: string;
  name: string;
  memberCount: number;
}

export function ListsManager({ lists }: { lists: ListRow[] }) {
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("name", trimmed);
        await createList(fd);
        setName("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Errore nella creazione");
      }
    });
  };

  const handleDelete = (id: string) => {
    startTransition(async () => {
      try {
        await deleteList(id);
      } catch {
        // revalidate gestisce lo stato
      }
    });
  };

  return (
    <div className="space-y-6">
      <Card className="flex items-center gap-2 p-4">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          placeholder="Nome nuova lista..."
          className="max-w-sm"
        />
        <Button onClick={handleCreate} disabled={isPending || !name.trim()} className="gap-1">
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Crea lista
        </Button>
        {error && <span className="text-sm text-destructive">{error}</span>}
      </Card>

      {lists.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nessuna lista creata.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lists.map((l) => (
            <Card key={l.id} className="flex items-center justify-between p-4">
              <Link href={`/dashboard/lists/${l.id}`} className="min-w-0">
                <p className="truncate font-medium hover:underline">{l.name}</p>
                <p className="text-sm text-muted-foreground">
                  {l.memberCount} candidati
                </p>
              </Link>
              <div className="flex items-center gap-1">
                <a
                  href={`/api/candidates/lists/${l.id}/export/csv`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button variant="ghost" size="icon" aria-label="Esporta CSV">
                    <Download className="h-4 w-4" />
                  </Button>
                </a>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Elimina lista"
                  disabled={isPending}
                  onClick={() => handleDelete(l.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Pagina elenco liste**

Create `src/app/(dashboard)/dashboard/lists/page.tsx`:

```tsx
import { requireOrganization } from "@/lib/auth-utils";
import { redirect } from "next/navigation";
import { getListsForOrg } from "@/lib/lists/service";
import { ListsManager } from "@/components/lists/lists-manager";
import { strings } from "@/lib/i18n/strings";

export default async function ListsPage() {
  let user;
  try {
    user = await requireOrganization();
  } catch {
    redirect("/login");
  }

  const lists = user.organizationId
    ? await getListsForOrg(user.organizationId)
    : [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl tracking-tight">{strings.pages.lists}</h1>
      <ListsManager lists={lists} />
    </div>
  );
}
```

- [ ] **Step 5: Pagina drill-down lista**

Create `src/app/(dashboard)/dashboard/lists/[id]/page.tsx`:

```tsx
import { requireOrganization } from "@/lib/auth-utils";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Download } from "lucide-react";
import { getCandidatesForOrg } from "@/lib/candidates/service";
import {
  getListWithMemberIds,
  getListOptionsForOrg,
  getListIdsByCandidateForOrg,
} from "@/lib/lists/service";
import { sortCandidates, paginateCandidates } from "@/lib/candidates/filter";
import { CandidatesTable } from "@/components/candidates/candidates-table";
import { Button } from "@/components/ui/button";

export default async function ListDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  let user;
  try {
    user = await requireOrganization();
  } catch {
    redirect("/login");
  }
  const { id } = await params;
  if (!user.organizationId) redirect("/login");

  const list = await getListWithMemberIds(user.organizationId, id);
  if (!list) notFound();

  const memberSet = new Set(list.candidateIds);
  const all = await getCandidatesForOrg(user.organizationId);
  const members = all.filter((c) => memberSet.has(c.id));

  const sort = { field: "createdAt" as const, direction: "desc" as const };
  const result = paginateCandidates(sortCandidates(members, sort), 1, 50);

  const lists = await getListOptionsForOrg(user.organizationId);
  const membershipByCandidate = await getListIdsByCandidateForOrg(
    user.organizationId,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/dashboard/lists"
            className="text-sm text-muted-foreground hover:underline"
          >
            ← Liste
          </Link>
          <h1 className="text-2xl tracking-tight">{list.name}</h1>
        </div>
        <a
          href={`/api/candidates/lists/${list.id}/export/csv`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button variant="outline" size="sm" className="gap-2">
            <Download className="h-4 w-4" />
            Esporta CSV
          </Button>
        </a>
      </div>

      {result.total === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nessun candidato in questa lista.
        </p>
      ) : (
        <CandidatesTable
          result={result}
          sort={sort}
          lists={lists}
          membershipByCandidate={membershipByCandidate}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Type-check + lint**

Run: `pnpm exec tsc --noEmit`
Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(lists): add Liste section pages and sidebar nav"
```

---

## Task 11: Verifica finale

- [ ] **Step 1: Suite completa**

Run: `pnpm test`
Expected: PASS (i test DB restano skipped).

- [ ] **Step 2: Type-check + lint + build**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm build`
Expected: tutto PASS.

- [ ] **Step 3: Verifica manuale (dev server)**

Run: `pnpm dev` e verifica:
- Crea una lista dalla sezione "Liste".
- Aggiungi un candidato dal menu nella tabella candidati; ricompare spuntato.
- Aggiungi/rimuovi dalla scheda candidato e dai risultati di un job.
- Filtra la tabella candidati per lista.
- Esporta CSV dell'org (colonna "Liste" valorizzata) e CSV di una lista.
- Elimina una lista e verifica che sparisca dai filtri/menu.

- [ ] **Step 4: Migrazione prod (PRIMA del merge — da CLAUDE.md)**

```bash
pg_dump "$DIRECT_URL" > /tmp/kubri-prod-pre-candidate-lists-$(date +%Y%m%d-%H%M%S).sql
set -a && source .env.prod && set +a && pnpm prisma migrate deploy
set -a && source .env.prod && set +a && pnpm prisma migrate status
```
Expected: la migrazione `add_candidate_lists_drop_tags` risulta applicata; status pulito.

---

## Self-review (note per l'esecutore)

- **Copertura spec:** modello dati (Task 1), drop tag (Task 1-2), permessi ogni membro (Task 5: usa `getCurrentUser` senza `requireRole`), cross-pool scoping (Task 4-5 via `getOrgAccessiblePoolIds`), menu a checkbox con creazione al volo (Task 6), tre punti di montaggio (Task 7), filtro lista (Task 8), colonna Liste + export per lista CSV-only (Task 9), sezione Liste + nav (Task 10).
- **`paginateCandidates`/`sortCandidates`** sono già esportati da `src/lib/candidates/filter.ts` (verificare la firma esatta lì se il type-check segnala差).
- **Wrapper `dropdown-menu.tsx`**: i prop esatti (`render` vs `asChild`, `onCheckedChange`) seguono Base UI come gli altri componenti UI del progetto; adattare in Task 6 se il type-check lo richiede.
- **ADMIN_KUBRI senza org:** le pagine liste mostrano stato vuoto (liste org-scoped); è accettabile per V1.
