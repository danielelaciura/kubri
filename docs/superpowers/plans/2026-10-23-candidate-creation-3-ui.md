# Candidate creation — PR 3: create-candidate UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let operators create candidates from the dashboard. They can upload a CV and review the pre-filled form side by side with the document, or fill in an empty form by hand.

**Architecture:**
- **Server actions** in `app/(dashboard)/dashboard/candidates/new/actions.ts` wrap the PR 2 services with auth, pool checks, Zod validation and audit logging. They return typed `ActionResult`s, never throw for expected errors.
- **`CandidateForm`** is one Client Component used by both modes. Its pure state logic sits in a separate, unit-tested module.
- **Upload**: the browser sends the file straight to Supabase Storage with a signed upload token.
- **Review page**: keyed by import id; what it renders depends on the import's status, and it triggers extraction itself.
- **Files**: two session-authenticated API routes redirect to short-lived signed URLs, one for the preview and one for the download.

**Tech Stack:** Next.js 16 App Router (Server Components + server actions), React 19, Tailwind, shadcn/ui on Base UI, `@supabase/ssr` browser client, Zod v4, vitest.

**Spec:** `docs/superpowers/specs/2026-10-23-candidate-creation-cv-import-design.md` (UI section; Rollout → PR 3)

**Depends on:** PR 1 and PR 2 merged into `main`, migration applied, bucket `candidate-documents` created in dev.

---

## Conventions for every task

- Paths are relative to `apps/dashboard/` unless they start with `docs/` or the repo root (`CLAUDE.md`).
- Tests: `cd apps/dashboard && pnpm exec vitest run <path>` (prefix `DATABASE_URL= DIRECT_URL=` if the remote-DB guard fires; all tests here mock the DB).
- Every user-visible string goes through the dictionary: `useT()` in Client Components, `getDictionary(await getServerLocale())` in Server Components. Add every key to BOTH `it.ts` and `en.ts`.
- Branch: `feat/create-candidate-ui` off `main`.

## Decisions refined from the spec while planning

- **Entry point is one "Nuovo candidato" button**, not a menu. It links to `/dashboard/candidates/new`, which already offers both modes. A menu would duplicate that choice, and the project's `DropdownMenu` is unused so far.
- **No toast after saving.** The project has no toast library, so the redirect to the new candidate's page is the confirmation. This avoids adding a dependency.
- **Duplicate warning only on the CV review page.** The draft's phone/email are known server-side when the page renders. On the manual form the check would need an extra round trip while typing (YAGNI).
- **Audit action names follow the codebase's dotted style**: `candidate.create` (metadata `mode`), `candidate_import.create`, `candidate_document.download`.
- **Document links go through API routes** that check access, write the audit log and redirect to a 60 s signed URL. This avoids embedding signed URLs in the page, where they would expire while it is open.

- **Re-check the pool when confirming.** `confirmCandidateImportAction` verifies again that the import's pool is still writable by the org (it may have been unlinked since the upload). If it isn't, return `INVALID_POOL`. *(From the plan-2 code review.)*
- **Extraction that looks stuck.** If an import has been `EXTRACTING` for more than 2 minutes when the review page renders, the page shows the failed-state UI with "Riprova". `runExtraction` can re-claim it. *(From the plan-2 code review.)*

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/i18n/dictionaries/it.ts`, `en.ts` | Modify | `candidateCreate` group |
| `src/lib/candidates/duplicates.ts` | Create | Possible duplicates in a pool by phone/email |
| `src/app/(dashboard)/dashboard/candidates/new/actions.ts` | Create | Server actions |
| `src/__tests__/app/dashboard/candidates/new-actions.test.ts` | Create | Action tests |
| `src/components/candidates/create/form-state.ts` | Create | Pure form-state ↔ submission logic |
| `src/__tests__/components/candidates/form-state.test.ts` | Create | |
| `src/components/candidates/create/candidate-form.tsx` | Create | Shared form |
| `src/components/candidates/create/cv-upload.tsx` | Create | Dropzone + upload flow |
| `src/components/candidates/create/new-candidate-modes.tsx` | Create | Upload / manual switch |
| `src/app/(dashboard)/dashboard/candidates/new/page.tsx` | Create | |
| `src/components/candidates/create/extraction-runner.tsx` | Create | Triggers extraction, shows progress |
| `src/components/candidates/create/import-review.tsx` | Create | Preview + form + actions |
| `src/components/candidates/create/retry-extraction-button.tsx` | Create | "Riprova" on failed imports |
| `src/__tests__/app/api/candidate-documents.test.ts` | Create | File route tests |
| `src/__tests__/lib/candidates/duplicates.test.ts` | Create | |
| `src/app/(dashboard)/dashboard/candidates/imports/[importId]/page.tsx` | Create | Status-driven review page |
| `src/app/api/candidate-imports/[importId]/file/route.ts` | Create | Preview redirect |
| `src/app/api/candidates/[id]/documents/[documentId]/route.ts` | Create | Download redirect + audit |
| `src/components/candidates/candidate-documents.tsx` | Create | "Documenti" card |
| `src/types/index.ts`, `src/lib/candidates/service.ts` | Modify | `createdVia` on `Candidate` |
| `src/app/(dashboard)/dashboard/candidates/[id]/page.tsx` | Modify | Documents card + origin badge |
| `src/app/(dashboard)/dashboard/candidates/page.tsx` | Modify | "Nuovo candidato" button |
| `CLAUDE.md` | Modify | Write-path rule |

---

### Task 1: Branch and dictionary keys

**Files:**
- Modify: `src/lib/i18n/dictionaries/it.ts`
- Modify: `src/lib/i18n/dictionaries/en.ts`

- [ ] **Step 1: Branch**

```bash
git checkout main && git pull && git checkout -b feat/create-candidate-ui
```

- [ ] **Step 2: Add the Italian group**

In `it.ts`, add this group right after the `candidateStatus: { … },` block:

```ts
  candidateCreate: {
    newCandidate: "Nuovo candidato",
    pageDescription: "Carica un CV per compilare il profilo in automatico, oppure inseriscilo a mano.",
    modeUpload: "Carica CV",
    modeManual: "Compila manualmente",
    noWritablePools: "La tua organizzazione non ha pool in cui creare candidati. Contatta l'amministratore Kubri.",
    pool: "Pool",
    dropzoneTitle: "Trascina qui il CV o selezionalo",
    dropzoneHint: "PDF, DOCX, JPG o PNG · massimo 10 MB",
    chooseFile: "Scegli file",
    uploading: "Caricamento…",
    reviewTitle: "Revisione",
    extractingTitle: "Sto leggendo il CV…",
    extractingStepRead: "Lettura del documento",
    extractingStepExtract: "Estrazione dei dati",
    extractedBanner: "Dati estratti automaticamente dal CV. Controllali prima di salvare.",
    notCvWarning: "Questo documento non sembra un curriculum. Puoi continuare comunque o scartarlo.",
    duplicateWarning: "Nel pool esiste già un candidato con lo stesso telefono o email:",
    toVerify: "da verificare",
    notStated: "Non indicato",
    yes: "Sì",
    no: "No",
    addItem: "Aggiungi",
    removeItem: "Rimuovi",
    create: "Crea candidato",
    creating: "Creazione…",
    discard: "Scarta",
    retry: "Riprova",
    fillManually: "Compila manualmente",
    failedTitle: "Non è stato possibile leggere il CV",
    previewUnavailable: "Anteprima non disponibile per questo formato. Testo estratto:",
    sectionPersonal: "Anagrafica",
    sectionJob: "Lavoro desiderato",
    sectionExperience: "Esperienze e formazione",
    sectionLanguages: "Lingue",
    sectionRequirements: "Requisiti",
    fieldRequired: "Campo obbligatorio",
    fieldInvalid: "Valore non valido",
    originForm: "Inserito manualmente",
    originCv: "Da CV",
    documents: "Documenti",
    documentUploaded: "Caricato da {name} il {date}",
    download: "Scarica",
    fields: {
      firstName: "Nome",
      lastName: "Cognome",
      birthday: "Data di nascita",
      countryOfOrigin: "Paese di origine",
      address: "Indirizzo",
      location: "Comune di residenza",
      phone: "Telefono",
      email: "Email",
      workingPermit: "Permesso di lavoro",
      meanOfTransport: "Mezzo di trasporto",
      drivingLicense: "Patente",
      educationAndTraining: "Formazione",
      workExperience: "Esperienze lavorative",
      skillsAndCompetences: "Competenze",
      language: "Lingua madre",
      additionalLanguages: "Altre lingue",
      italianLevel: "Livello di italiano",
      desiredJob: "Lavoro desiderato",
      partTimePreference: "Part-time",
      preferredLocation: "Zona preferita",
      jobConstraints: "Vincoli e disponibilità",
    },
    errors: {
      FILE_TOO_LARGE: "Il file supera i 10 MB.",
      UNSUPPORTED_TYPE: "Formato non supportato. Carica un PDF, DOCX, JPG o PNG.",
      STORAGE_ERROR: "Caricamento non riuscito. Riprova.",
      FILE_UNREADABLE: "Il file è protetto da password o danneggiato e non si può leggere.",
      NO_TEXT: "Nel documento non c'è testo leggibile.",
      NOT_A_CV: "Il documento non sembra un curriculum.",
      LLM_TIMEOUT: "La lettura del CV ha richiesto troppo tempo. Riprova.",
      LLM_ERROR: "Il servizio di lettura dei CV non ha risposto correttamente. Riprova.",
      INTERNAL_ERROR: "Si è verificato un errore. Riprova.",
      INVALID_POOL: "Il pool selezionato non è disponibile.",
      VALIDATION: "Controlla i campi evidenziati.",
      NOT_FOUND: "Import non trovato.",
    },
  },
```

- [ ] **Step 3: Add the English group**

In `en.ts`, same position, same keys:

```ts
  candidateCreate: {
    newCandidate: "New candidate",
    pageDescription: "Upload a CV to fill in the profile automatically, or enter it by hand.",
    modeUpload: "Upload CV",
    modeManual: "Fill in manually",
    noWritablePools: "Your organization has no pool to create candidates in. Contact the Kubri administrator.",
    pool: "Pool",
    dropzoneTitle: "Drop the CV here or select it",
    dropzoneHint: "PDF, DOCX, JPG or PNG · up to 10 MB",
    chooseFile: "Choose file",
    uploading: "Uploading…",
    reviewTitle: "Review",
    extractingTitle: "Reading the CV…",
    extractingStepRead: "Reading the document",
    extractingStepExtract: "Extracting the data",
    extractedBanner: "Data extracted automatically from the CV. Check it before saving.",
    notCvWarning: "This document doesn't look like a CV. You can continue anyway or discard it.",
    duplicateWarning: "A candidate with the same phone or email already exists in this pool:",
    toVerify: "check this",
    notStated: "Not stated",
    yes: "Yes",
    no: "No",
    addItem: "Add",
    removeItem: "Remove",
    create: "Create candidate",
    creating: "Creating…",
    discard: "Discard",
    retry: "Retry",
    fillManually: "Fill in manually",
    failedTitle: "The CV couldn't be read",
    previewUnavailable: "No preview for this format. Extracted text:",
    sectionPersonal: "Personal details",
    sectionJob: "Desired job",
    sectionExperience: "Experience and education",
    sectionLanguages: "Languages",
    sectionRequirements: "Requirements",
    fieldRequired: "Required field",
    fieldInvalid: "Invalid value",
    originForm: "Added manually",
    originCv: "From CV",
    documents: "Documents",
    documentUploaded: "Uploaded by {name} on {date}",
    download: "Download",
    fields: {
      firstName: "First name",
      lastName: "Last name",
      birthday: "Date of birth",
      countryOfOrigin: "Country of origin",
      address: "Address",
      location: "Town of residence",
      phone: "Phone",
      email: "Email",
      workingPermit: "Work permit",
      meanOfTransport: "Means of transport",
      drivingLicense: "Driving licence",
      educationAndTraining: "Education",
      workExperience: "Work experience",
      skillsAndCompetences: "Skills",
      language: "Mother tongue",
      additionalLanguages: "Other languages",
      italianLevel: "Italian level",
      desiredJob: "Desired job",
      partTimePreference: "Part-time",
      preferredLocation: "Preferred area",
      jobConstraints: "Constraints and availability",
    },
    errors: {
      FILE_TOO_LARGE: "The file is larger than 10 MB.",
      UNSUPPORTED_TYPE: "Unsupported format. Upload a PDF, DOCX, JPG or PNG.",
      STORAGE_ERROR: "Upload failed. Try again.",
      FILE_UNREADABLE: "The file is password-protected or damaged and can't be read.",
      NO_TEXT: "The document has no readable text.",
      NOT_A_CV: "The document doesn't look like a CV.",
      LLM_TIMEOUT: "Reading the CV took too long. Try again.",
      LLM_ERROR: "The CV reading service didn't respond correctly. Try again.",
      INTERNAL_ERROR: "Something went wrong. Try again.",
      INVALID_POOL: "The selected pool isn't available.",
      VALIDATION: "Check the highlighted fields.",
      NOT_FOUND: "Import not found.",
    },
  },
```

- [ ] **Step 4: Parity test + typecheck**

Run: `pnpm exec vitest run src/lib/i18n && pnpm exec tsc --noEmit`
Expected: PASS (deep-parity test), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/i18n/dictionaries
git commit -m "feat(i18n): strings for dashboard candidate creation"
```

---

### Task 2: Duplicate lookup

**Files:**
- Create: `src/lib/candidates/duplicates.ts`
- Create: `src/__tests__/lib/candidates/duplicates.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { candidate: { findMany: vi.fn() } } }));

import { prisma } from "@/lib/db";
import { findPossibleDuplicates, phoneSuffix } from "@/lib/candidates/duplicates";

const findMany = prisma.candidate.findMany as unknown as ReturnType<typeof vi.fn>;

describe("phoneSuffix", () => {
  it("keeps the last 8 digits", () => {
    expect(phoneSuffix("+39 345 123 4567")).toBe("51234567");
  });
  it("returns null for short or missing numbers", () => {
    expect(phoneSuffix("12345")).toBeNull();
    expect(phoneSuffix(null)).toBeNull();
  });
});

describe("findPossibleDuplicates", () => {
  beforeEach(() => vi.resetAllMocks());

  it("skips the query when there is nothing to match", async () => {
    await expect(findPossibleDuplicates("p", { phone: null, email: null })).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("matches by phone suffix or email inside the pool", async () => {
    findMany.mockResolvedValueOnce([{ id: "c1", firstName: "A", lastName: "B" }]);
    const r = await findPossibleDuplicates("p", { phone: "+39 345 1234567", email: "a@b.it" });
    expect(r).toEqual([{ id: "c1", firstName: "A", lastName: "B" }]);
    expect(findMany.mock.calls[0]![0].where).toEqual({
      poolId: "p",
      OR: [
        { phone: { endsWith: "51234567" } },
        { email: { equals: "a@b.it", mode: "insensitive" } },
      ],
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/__tests__/lib/candidates/duplicates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/lib/candidates/duplicates.ts`:

```ts
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

/** Last 8 digits of a phone number: robust to prefixes, spaces and dashes. */
export function phoneSuffix(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(-8) : null;
}

/**
 * Candidates in the same pool that may be the same person (same phone
 * suffix or same email). Advisory only — never blocks creation. Stored
 * phones with separators inside the last 8 digits won't match; acceptable
 * for a warning.
 */
export async function findPossibleDuplicates(
  poolId: string,
  probe: { phone: string | null; email: string | null },
): Promise<{ id: string; firstName: string | null; lastName: string | null }[]> {
  const or: Prisma.CandidateWhereInput[] = [];
  const suffix = phoneSuffix(probe.phone);
  if (suffix) or.push({ phone: { endsWith: suffix } });
  if (probe.email) or.push({ email: { equals: probe.email, mode: "insensitive" } });
  if (or.length === 0) return [];

  return prisma.candidate.findMany({
    where: { poolId, OR: or },
    select: { id: true, firstName: true, lastName: true },
    take: 5,
  });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run src/__tests__/lib/candidates/duplicates.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/candidates/duplicates.ts src/__tests__/lib/candidates/duplicates.test.ts
git commit -m "feat(candidates): advisory duplicate lookup by phone/email"
```

---

### Task 3: Server actions

**Files:**
- Create: `src/app/(dashboard)/dashboard/candidates/new/actions.ts`
- Create: `src/__tests__/app/dashboard/candidates/new-actions.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth-utils", () => ({ requireOrganization: vi.fn() }));
vi.mock("@/lib/pools/access", () => ({ getOrgWritablePools: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/candidates/dashboard-create", () => ({ createCandidateManually: vi.fn() }));
vi.mock("@/lib/candidate-imports/service", () => ({
  createUploadTicket: vi.fn(),
  registerUpload: vi.fn(),
  runExtraction: vi.fn(),
  confirmImport: vi.fn(),
  discardImport: vi.fn(),
  getImportForOrg: vi.fn(),
}));

import { requireOrganization } from "@/lib/auth-utils";
import { getOrgWritablePools } from "@/lib/pools/access";
import { logAudit } from "@/lib/audit";
import { createCandidateManually } from "@/lib/candidates/dashboard-create";
import {
  confirmImport,
  createUploadTicket,
  getImportForOrg,
  registerUpload,
  runExtraction,
} from "@/lib/candidate-imports/service";
import { ImportError, ImportStateError } from "@/lib/candidate-imports/errors";
import {
  confirmCandidateImportAction,
  createCandidateManuallyAction,
  registerCandidateUploadAction,
  requestCandidateUploadAction,
  runCandidateImportExtractionAction,
} from "@/app/(dashboard)/dashboard/candidates/new/actions";

const m = <T>(f: T) => f as unknown as ReturnType<typeof vi.fn>;
const USER = { id: "u-1", organizationId: "org-1", role: "ORG_MEMBER" };
const POOL = { id: "pool-1", name: "Coop", isGlobal: false, globalSharing: "WEBHOOK" };
const VALUES = {
  firstName: "Ahmed", lastName: "Benali", birthday: null, countryOfOrigin: null, address: null,
  location: null, phone: null, email: null, workingPermit: null, meanOfTransport: null,
  drivingLicense: null, educationAndTraining: [], workExperience: [], skillsAndCompetences: [],
  language: null, additionalLanguages: [], italianLevel: null, desiredJob: null,
  partTimePreference: null, preferredLocation: null, jobConstraints: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  m(requireOrganization).mockResolvedValue(USER);
  m(getOrgWritablePools).mockResolvedValue([POOL]);
});

describe("requestCandidateUploadAction", () => {
  it("rejects a pool the org cannot write to", async () => {
    const r = await requestCandidateUploadAction({ poolId: "other", fileName: "cv.pdf", fileSize: 10 });
    expect(r).toEqual({ ok: false, error: "INVALID_POOL" });
    expect(m(createUploadTicket)).not.toHaveBeenCalled();
  });

  it("returns the upload ticket", async () => {
    m(createUploadTicket).mockResolvedValueOnce({ importId: "i", storagePath: "p", token: "t" });
    const r = await requestCandidateUploadAction({ poolId: "pool-1", fileName: "cv.pdf", fileSize: 10 });
    expect(r).toEqual({ ok: true, data: { importId: "i", storagePath: "p", token: "t" } });
  });

  it("maps ImportError codes", async () => {
    m(createUploadTicket).mockRejectedValueOnce(new ImportError("FILE_TOO_LARGE"));
    const r = await requestCandidateUploadAction({ poolId: "pool-1", fileName: "cv.pdf", fileSize: 1e9 });
    expect(r).toEqual({ ok: false, error: "FILE_TOO_LARGE" });
  });
});

describe("registerCandidateUploadAction", () => {
  it("registers with the user's org and logs the audit event", async () => {
    m(registerUpload).mockResolvedValueOnce({ importId: "i" });
    const r = await registerCandidateUploadAction({
      importId: "11111111-1111-1111-1111-111111111111", poolId: "pool-1", fileName: "cv.pdf",
    });
    expect(r).toEqual({ ok: true, data: { importId: "i" } });
    expect(m(registerUpload).mock.calls[0]![0]).toMatchObject({
      organizationId: "org-1", createdById: "u-1", origin: "OPERATOR",
    });
    expect(m(logAudit).mock.calls[0]![0]).toMatchObject({
      action: "candidate_import.create", resourceType: "candidate_import", resourceId: "i",
    });
  });
});

describe("runCandidateImportExtractionAction", () => {
  it("refuses an import of another org", async () => {
    m(getImportForOrg).mockResolvedValueOnce(null);
    const r = await runCandidateImportExtractionAction("imp-x");
    expect(r).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(m(runExtraction)).not.toHaveBeenCalled();
  });

  it("runs the extraction for an own import", async () => {
    m(getImportForOrg).mockResolvedValueOnce({ id: "imp-1" });
    await expect(runCandidateImportExtractionAction("imp-1")).resolves.toEqual({ ok: true, data: null });
    expect(m(runExtraction)).toHaveBeenCalledWith("imp-1");
  });
});

describe("confirmCandidateImportAction", () => {
  it("returns field errors without calling the service", async () => {
    const r = await confirmCandidateImportAction("imp-1", { ...VALUES, lastName: "" });
    expect(r).toEqual({ ok: false, error: "VALIDATION", fieldErrors: { lastName: "required" } });
    expect(m(confirmImport)).not.toHaveBeenCalled();
  });

  it("confirms and logs candidate.create with mode cv", async () => {
    m(confirmImport).mockResolvedValueOnce({ candidateId: "c-1" });
    const r = await confirmCandidateImportAction("imp-1", VALUES);
    expect(r).toEqual({ ok: true, data: { candidateId: "c-1" } });
    expect(m(confirmImport).mock.calls[0]![0]).toMatchObject({ importId: "imp-1", organizationId: "org-1", userId: "u-1" });
    expect(m(logAudit).mock.calls[0]![0]).toMatchObject({
      action: "candidate.create", resourceId: "c-1", metadata: { mode: "cv", importId: "imp-1" },
    });
  });

  it("returns the existing candidate when a concurrent confirm won", async () => {
    m(confirmImport).mockRejectedValueOnce(new ImportStateError("COMPLETED"));
    m(getImportForOrg).mockResolvedValueOnce({ id: "imp-1", status: "COMPLETED", candidateId: "c-9" });
    const r = await confirmCandidateImportAction("imp-1", VALUES);
    expect(r).toEqual({ ok: true, data: { candidateId: "c-9" } });
  });
});

describe("createCandidateManuallyAction", () => {
  it("rejects an invalid pool", async () => {
    const r = await createCandidateManuallyAction("other", VALUES);
    expect(r).toEqual({ ok: false, error: "INVALID_POOL" });
  });

  it("creates and logs candidate.create with mode form", async () => {
    m(createCandidateManually).mockResolvedValueOnce({ candidateId: "c-2" });
    const r = await createCandidateManuallyAction("pool-1", VALUES);
    expect(r).toEqual({ ok: true, data: { candidateId: "c-2" } });
    expect(m(createCandidateManually).mock.calls[0]![0]).toMatchObject({ pool: POOL, userId: "u-1" });
    expect(m(logAudit).mock.calls[0]![0]).toMatchObject({ action: "candidate.create", metadata: { mode: "form" } });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/__tests__/app/dashboard/candidates/new-actions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/app/(dashboard)/dashboard/candidates/new/actions.ts`:

```ts
"use server";

import { z } from "zod/v4";
import { revalidatePath } from "next/cache";
import { candidateFieldsSchema, type CandidateFieldKey } from "@kubri/contracts";
import { requireOrganization } from "@/lib/auth-utils";
import { getOrgWritablePools } from "@/lib/pools/access";
import { logAudit } from "@/lib/audit";
import { createCandidateManually } from "@/lib/candidates/dashboard-create";
import {
  confirmImport,
  createUploadTicket,
  discardImport,
  getImportForOrg,
  registerUpload,
  runExtraction,
  type UploadTicket,
} from "@/lib/candidate-imports/service";
import {
  ImportError,
  ImportNotFoundError,
  ImportStateError,
  type ImportErrorCode,
} from "@/lib/candidate-imports/errors";

export type CreateCandidateErrorCode =
  | ImportErrorCode
  | "INVALID_POOL"
  | "VALIDATION"
  | "NOT_FOUND";

export type FieldErrors = Partial<Record<CandidateFieldKey, "required" | "invalid">>;

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: CreateCandidateErrorCode; fieldErrors?: FieldErrors };

// All three roles may create candidates; every user reaching the dashboard
// has an organization, so requireOrganization is the role check.
async function session() {
  return requireOrganization();
}

async function writablePool(organizationId: string, poolId: string) {
  const pools = await getOrgWritablePools(organizationId);
  return pools.find((p) => p.id === poolId) ?? null;
}

function fail(e: unknown): { ok: false; error: CreateCandidateErrorCode } {
  if (e instanceof ImportError) return { ok: false, error: e.code };
  if (e instanceof ImportNotFoundError) return { ok: false, error: "NOT_FOUND" };
  console.error("[create candidate] unexpected error", e);
  return { ok: false, error: "INTERNAL_ERROR" };
}

function parseFields(values: unknown) {
  const parsed = candidateFieldsSchema.safeParse(values);
  if (parsed.success) return { ok: true as const, fields: parsed.data };
  const fieldErrors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as CandidateFieldKey | undefined;
    if (!key || fieldErrors[key]) continue;
    fieldErrors[key] = issue.code === "too_small" ? "required" : "invalid";
  }
  return { ok: false as const, fieldErrors };
}

const uploadRequestSchema = z.object({
  poolId: z.string().min(1),
  fileName: z.string().min(1).max(255),
  fileSize: z.number().int().positive(),
});

export async function requestCandidateUploadAction(
  input: z.input<typeof uploadRequestSchema>,
): Promise<ActionResult<UploadTicket>> {
  const user = await session();
  const parsed = uploadRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  if (!(await writablePool(user.organizationId, parsed.data.poolId))) {
    return { ok: false, error: "INVALID_POOL" };
  }
  try {
    return { ok: true, data: await createUploadTicket(parsed.data) };
  } catch (e) {
    return fail(e);
  }
}

const registerSchema = z.object({
  importId: z.string().uuid(),
  poolId: z.string().min(1),
  fileName: z.string().min(1).max(255),
});

export async function registerCandidateUploadAction(
  input: z.input<typeof registerSchema>,
): Promise<ActionResult<{ importId: string }>> {
  const user = await session();
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  if (!(await writablePool(user.organizationId, parsed.data.poolId))) {
    return { ok: false, error: "INVALID_POOL" };
  }
  try {
    const { importId } = await registerUpload({
      ...parsed.data,
      organizationId: user.organizationId,
      origin: "OPERATOR",
      createdById: user.id,
    });
    await logAudit({
      userId: user.id,
      organizationId: user.organizationId,
      action: "candidate_import.create",
      resourceType: "candidate_import",
      resourceId: importId,
      metadata: { poolId: parsed.data.poolId },
    });
    return { ok: true, data: { importId } };
  } catch (e) {
    return fail(e);
  }
}

export async function runCandidateImportExtractionAction(
  importId: string,
): Promise<ActionResult<null>> {
  const user = await session();
  const imp = await getImportForOrg(importId, user.organizationId);
  if (!imp) return { ok: false, error: "NOT_FOUND" };
  await runExtraction(importId);
  return { ok: true, data: null };
}

export async function confirmCandidateImportAction(
  importId: string,
  values: unknown,
): Promise<ActionResult<{ candidateId: string }>> {
  const user = await session();
  const parsed = parseFields(values);
  if (!parsed.ok) return { ok: false, error: "VALIDATION", fieldErrors: parsed.fieldErrors };

  try {
    const { candidateId } = await confirmImport({
      importId,
      organizationId: user.organizationId,
      userId: user.id,
      fields: parsed.fields,
    });
    await logAudit({
      userId: user.id,
      organizationId: user.organizationId,
      action: "candidate.create",
      resourceType: "candidate",
      resourceId: candidateId,
      metadata: { mode: "cv", importId },
    });
    revalidatePath("/dashboard/candidates");
    return { ok: true, data: { candidateId } };
  } catch (e) {
    if (e instanceof ImportStateError) {
      // A concurrent confirm (double click, second tab) won the race.
      const imp = await getImportForOrg(importId, user.organizationId);
      if (imp?.status === "COMPLETED" && imp.candidateId) {
        return { ok: true, data: { candidateId: imp.candidateId } };
      }
      return { ok: false, error: "NOT_FOUND" };
    }
    return fail(e);
  }
}

export async function createCandidateManuallyAction(
  poolId: string,
  values: unknown,
): Promise<ActionResult<{ candidateId: string }>> {
  const user = await session();
  const pool = await writablePool(user.organizationId, poolId);
  if (!pool) return { ok: false, error: "INVALID_POOL" };
  const parsed = parseFields(values);
  if (!parsed.ok) return { ok: false, error: "VALIDATION", fieldErrors: parsed.fieldErrors };

  try {
    const { candidateId } = await createCandidateManually({
      pool,
      fields: parsed.fields,
      userId: user.id,
    });
    await logAudit({
      userId: user.id,
      organizationId: user.organizationId,
      action: "candidate.create",
      resourceType: "candidate",
      resourceId: candidateId,
      metadata: { mode: "form", poolId },
    });
    revalidatePath("/dashboard/candidates");
    return { ok: true, data: { candidateId } };
  } catch (e) {
    return fail(e);
  }
}

export async function discardCandidateImportAction(importId: string): Promise<ActionResult<null>> {
  const user = await session();
  const done = await discardImport(importId, user.organizationId);
  return done ? { ok: true, data: null } : { ok: false, error: "NOT_FOUND" };
}
```

Note: in Zod v4 a `min(1)` failure on a string has `issue.code === "too_small"`, which maps to `"required"`; every other issue maps to `"invalid"`.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run src/__tests__/app/dashboard/candidates/new-actions.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/dashboard/candidates/new/actions.ts" src/__tests__/app/dashboard/candidates/new-actions.test.ts
git commit -m "feat(candidates): server actions for dashboard candidate creation"
```

---

### Task 4: Form state logic (pure, tested)

**Files:**
- Create: `src/components/candidates/create/form-state.ts`
- Create: `src/__tests__/components/candidates/form-state.test.ts`

The form edits everything as strings (inputs) and string lists; booleans are a tri-state select (`""` / `"true"` / `"false"`). This module converts both ways.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { emptyCandidateDraftFields } from "@kubri/contracts";
import { toFormState, toSubmission, validateFormState } from "@/components/candidates/create/form-state";

describe("form-state", () => {
  it("round-trips draft fields", () => {
    const draft = {
      ...emptyCandidateDraftFields(),
      firstName: "Ahmed",
      drivingLicense: true,
      partTimePreference: false,
      workExperience: ["Magazziniere"],
    };
    const state = toFormState(draft);
    expect(state.firstName).toBe("Ahmed");
    expect(state.birthday).toBe("");
    expect(state.drivingLicense).toBe("true");
    expect(state.partTimePreference).toBe("false");
    expect(state.workingPermit).toBe("");
    expect(state.workExperience).toEqual(["Magazziniere"]);

    const out = toSubmission(state);
    expect(out.firstName).toBe("Ahmed");
    expect(out.birthday).toBeNull();
    expect(out.drivingLicense).toBe(true);
    expect(out.partTimePreference).toBe(false);
    expect(out.workingPermit).toBeNull();
  });

  it("reports required names and invalid email", () => {
    const state = toFormState(emptyCandidateDraftFields());
    state.email = "nope";
    const errors = validateFormState(state);
    expect(errors).toEqual({ firstName: "required", lastName: "required", email: "invalid" });
  });

  it("returns no errors for a valid state", () => {
    const state = toFormState({ ...emptyCandidateDraftFields(), firstName: "A", lastName: "B" });
    expect(validateFormState(state)).toEqual({});
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/__tests__/components/candidates/form-state.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/components/candidates/create/form-state.ts`:

```ts
import {
  CANDIDATE_BOOLEAN_FIELD_KEYS,
  CANDIDATE_FIELD_KEYS,
  candidateFieldsSchema,
  isArrayFieldKey,
  type CandidateDraftFields,
  type CandidateFieldKey,
  type CandidateFieldsInput,
} from "@kubri/contracts";
import type { FieldErrors } from "@/app/(dashboard)/dashboard/candidates/new/actions";

export type TriState = "" | "true" | "false";

type BooleanKey = (typeof CANDIDATE_BOOLEAN_FIELD_KEYS)[number];

export type FormState = {
  [K in CandidateFieldKey]: K extends BooleanKey
    ? TriState
    : CandidateDraftFields[K] extends string[]
      ? string[]
      : string;
};

function isBooleanKey(key: CandidateFieldKey): key is BooleanKey {
  return (CANDIDATE_BOOLEAN_FIELD_KEYS as readonly string[]).includes(key);
}

export function toFormState(draft: CandidateDraftFields): FormState {
  const out: Record<string, unknown> = {};
  for (const key of CANDIDATE_FIELD_KEYS) {
    const v = draft[key];
    if (isArrayFieldKey(key)) out[key] = [...((v as string[] | null) ?? [])];
    else if (isBooleanKey(key)) out[key] = v === true ? "true" : v === false ? "false" : "";
    else out[key] = (v as string | null) ?? "";
  }
  return out as FormState;
}

/** Form state → the shape `candidateFieldsSchema` parses (server re-validates). */
export function toSubmission(state: FormState): CandidateFieldsInput {
  const out: Record<string, unknown> = {};
  for (const key of CANDIDATE_FIELD_KEYS) {
    const v = state[key];
    if (isArrayFieldKey(key)) out[key] = v as string[];
    else if (isBooleanKey(key)) out[key] = v === "true" ? true : v === "false" ? false : null;
    else out[key] = (v as string).trim() === "" && key !== "firstName" && key !== "lastName" ? null : v;
  }
  return out as CandidateFieldsInput;
}

export function validateFormState(state: FormState): FieldErrors {
  const parsed = candidateFieldsSchema.safeParse(toSubmission(state));
  if (parsed.success) return {};
  const errors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as CandidateFieldKey | undefined;
    if (!key || errors[key]) continue;
    errors[key] = issue.code === "too_small" ? "required" : "invalid";
  }
  return errors;
}
```

`FieldErrors` is a type-only import from the `"use server"` module, which is allowed (erased at compile time).

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run src/__tests__/components/candidates/form-state.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/candidates/create/form-state.ts src/__tests__/components/candidates/form-state.test.ts
git commit -m "feat(candidates): candidate form state conversion and validation"
```

---

### Task 5: `CandidateForm` component

**Files:**
- Create: `src/components/candidates/create/candidate-form.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import type { CandidateDraftFields, CandidateFieldKey, CandidateFieldsInput } from "@kubri/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LoadingButton } from "@/components/shared/loading-button";
import { useProgressTransition } from "@/components/layout/route-progress";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { ActionResult, FieldErrors } from "@/app/(dashboard)/dashboard/candidates/new/actions";
import { toFormState, toSubmission, validateFormState, type FormState, type TriState } from "./form-state";

export interface PoolOption {
  id: string;
  name: string;
}

interface CandidateFormProps {
  initialValues: CandidateDraftFields;
  /** Fields the extraction marked as uncertain (amber + "da verificare"). */
  uncertain?: CandidateFieldKey[];
  /** Shown as a select only when there is more than one pool. */
  pools: PoolOption[];
  onSubmit: (poolId: string, values: CandidateFieldsInput) => Promise<ActionResult<{ candidateId: string }>>;
  onSuccess: (candidateId: string) => void;
  /** Extra header actions (e.g. "Scarta" on the review page). */
  secondaryActions?: ReactNode;
}

type TextKey = Exclude<
  CandidateFieldKey,
  "workingPermit" | "drivingLicense" | "partTimePreference" |
  "educationAndTraining" | "workExperience" | "skillsAndCompetences" | "additionalLanguages"
>;
type ListKey = "educationAndTraining" | "workExperience" | "skillsAndCompetences" | "additionalLanguages";
type BoolKey = "workingPermit" | "drivingLicense" | "partTimePreference";

export function CandidateForm({
  initialValues,
  uncertain = [],
  pools,
  onSubmit,
  onSuccess,
  secondaryActions,
}: CandidateFormProps) {
  const t = useT();
  const tc = t.candidateCreate;
  const [state, setState] = useState<FormState>(() => toFormState(initialValues));
  const [poolId, setPoolId] = useState(pools[0]?.id ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useProgressTransition();

  const set = <K extends CandidateFieldKey>(key: K, value: FormState[K]) => {
    setState((s) => ({ ...s, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const fieldClass = (key: CandidateFieldKey) =>
    cn(
      errors[key] && "border-destructive",
      !errors[key] && uncertain.includes(key) && "border-amber-400 bg-amber-50/40",
    );

  const FieldLabel = ({ k, required }: { k: CandidateFieldKey; required?: boolean }) => (
    <Label htmlFor={`cf-${k}`} className="flex items-center gap-1 text-sm">
      {tc.fields[k]}
      {required && <span aria-hidden="true">*</span>}
      {uncertain.includes(k) && (
        <span className="text-xs font-normal text-amber-700">· {tc.toVerify}</span>
      )}
    </Label>
  );

  const FieldError = ({ k }: { k: CandidateFieldKey }) =>
    errors[k] ? (
      <p className="text-xs text-destructive">
        {errors[k] === "required" ? tc.fieldRequired : tc.fieldInvalid}
      </p>
    ) : null;

  const text = (k: TextKey, opts: { required?: boolean; multiline?: boolean; type?: string } = {}) => (
    <div className="space-y-1.5">
      <FieldLabel k={k} required={opts.required} />
      {opts.multiline ? (
        <Textarea id={`cf-${k}`} value={state[k]} onChange={(e) => set(k, e.target.value)} className={fieldClass(k)} rows={2} />
      ) : (
        <Input id={`cf-${k}`} type={opts.type ?? "text"} value={state[k]} onChange={(e) => set(k, e.target.value)} className={fieldClass(k)} />
      )}
      <FieldError k={k} />
    </div>
  );

  const bool = (k: BoolKey) => (
    <div className="space-y-1.5">
      <FieldLabel k={k} />
      <select
        id={`cf-${k}`}
        value={state[k]}
        onChange={(e) => set(k, e.target.value as TriState)}
        className={cn("h-9 w-full rounded-md border border-input bg-white px-2 text-sm", fieldClass(k))}
      >
        <option value="">{tc.notStated}</option>
        <option value="true">{tc.yes}</option>
        <option value="false">{tc.no}</option>
      </select>
    </div>
  );

  const list = (k: ListKey) => (
    <div className="space-y-1.5">
      <FieldLabel k={k} />
      <div className={cn("space-y-2 rounded-md", uncertain.includes(k) && "ring-1 ring-amber-400 p-2")}>
        {state[k].map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              aria-label={`${tc.fields[k]} ${i + 1}`}
              value={item}
              onChange={(e) => set(k, state[k].map((v, j) => (j === i ? e.target.value : v)))}
            />
            <Button
              type="button" variant="ghost" size="icon" aria-label={tc.removeItem}
              onClick={() => set(k, state[k].filter((_, j) => j !== i))}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={() => set(k, [...state[k], ""])}>
          <Plus className="h-4 w-4" />
          {tc.addItem}
        </Button>
      </div>
    </div>
  );

  const section = (title: string, children: ReactNode) => (
    <fieldset className="space-y-4">
      <legend className="mb-2 text-sm font-medium text-muted-foreground">{title}</legend>
      {children}
    </fieldset>
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const clientErrors = validateFormState(state);
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      setFormError(tc.errors.VALIDATION);
      return;
    }
    setFormError(null);
    startTransition(async () => {
      const res = await onSubmit(poolId, toSubmission(state));
      if (res.ok) {
        onSuccess(res.data.candidateId);
        return;
      }
      setErrors(res.fieldErrors ?? {});
      setFormError(tc.errors[res.error]);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-8" noValidate>
      {pools.length > 1 && (
        <div className="space-y-1.5">
          <Label htmlFor="cf-pool">{tc.pool}</Label>
          <select
            id="cf-pool" value={poolId} onChange={(e) => setPoolId(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-white px-2 text-sm"
          >
            {pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      )}

      {section(tc.sectionPersonal, (
        <div className="grid gap-4 sm:grid-cols-2">
          {text("firstName", { required: true })}
          {text("lastName", { required: true })}
          {text("birthday")}
          {text("countryOfOrigin")}
          {text("phone", { type: "tel" })}
          {text("email", { type: "email" })}
          {text("location")}
          {text("address")}
        </div>
      ))}

      {section(tc.sectionJob, (
        <div className="grid gap-4 sm:grid-cols-2">
          {text("desiredJob")}
          {text("preferredLocation")}
          {bool("partTimePreference")}
          <div className="sm:col-span-2">{text("jobConstraints", { multiline: true })}</div>
        </div>
      ))}

      {section(tc.sectionExperience, (
        <div className="space-y-4">
          {list("workExperience")}
          {list("educationAndTraining")}
          {list("skillsAndCompetences")}
        </div>
      ))}

      {section(tc.sectionLanguages, (
        <div className="grid gap-4 sm:grid-cols-2">
          {text("language")}
          {text("italianLevel")}
          <div className="sm:col-span-2">{list("additionalLanguages")}</div>
        </div>
      ))}

      {section(tc.sectionRequirements, (
        <div className="grid gap-4 sm:grid-cols-3">
          {bool("workingPermit")}
          {bool("drivingLicense")}
          {text("meanOfTransport")}
        </div>
      ))}

      {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}

      <div className="flex justify-end gap-2">
        {secondaryActions}
        <LoadingButton type="submit" loading={pending} loadingText={tc.creating}>
          {tc.create}
        </LoadingButton>
      </div>
    </form>
  );
}
```

`FieldLabel` and `FieldError` are declared inside the component for brevity; they are tiny and stateless. If ESLint's `react/no-unstable-nested-components` complains, move them above the component and pass `tc`, `uncertain` and `errors` as props.

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: no errors. If `useProgressTransition`'s `startTransition` rejects an async callback in the installed React types, wrap the body as `startTransition(() => { void (async () => { … })(); })`.

- [ ] **Step 3: Commit**

```bash
git add src/components/candidates/create/candidate-form.tsx
git commit -m "feat(candidates): shared CandidateForm component"
```

---

### Task 6: CV upload component and `/dashboard/candidates/new`

**Files:**
- Create: `src/components/candidates/create/cv-upload.tsx`
- Create: `src/components/candidates/create/new-candidate-modes.tsx`
- Create: `src/app/(dashboard)/dashboard/candidates/new/page.tsx`

- [ ] **Step 1: Upload component**

`src/components/candidates/create/cv-upload.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { usePendingProgress } from "@/components/layout/route-progress";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import {
  registerCandidateUploadAction,
  requestCandidateUploadAction,
} from "@/app/(dashboard)/dashboard/candidates/new/actions";
import type { PoolOption } from "./candidate-form";

const ACCEPT = ".pdf,.docx,.jpg,.jpeg,.png,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png";
const MAX_BYTES = 10 * 1024 * 1024;
const BUCKET = "candidate-documents";

export function CvUpload({ pools }: { pools: PoolOption[] }) {
  const t = useT();
  const tc = t.candidateCreate;
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [poolId, setPoolId] = useState(pools[0]?.id ?? "");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  usePendingProgress(busy);

  async function upload(file: File) {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError(tc.errors.FILE_TOO_LARGE);
      return;
    }
    setBusy(true);
    try {
      const ticket = await requestCandidateUploadAction({ poolId, fileName: file.name, fileSize: file.size });
      if (!ticket.ok) {
        setError(tc.errors[ticket.error]);
        return;
      }
      // Straight to Storage: Vercel caps request bodies at 4.5 MB.
      const { error: upErr } = await createSupabaseBrowserClient()
        .storage.from(BUCKET)
        .uploadToSignedUrl(ticket.data.storagePath, ticket.data.token, file, {
          contentType: file.type || undefined,
        });
      if (upErr) {
        setError(tc.errors.STORAGE_ERROR);
        return;
      }
      const reg = await registerCandidateUploadAction({
        importId: ticket.data.importId,
        poolId,
        fileName: file.name,
      });
      if (!reg.ok) {
        setError(tc.errors[reg.error]);
        return;
      }
      router.push(`/dashboard/candidates/imports/${reg.data.importId}`);
    } catch {
      setError(tc.errors.INTERNAL_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {pools.length > 1 && (
        <div className="space-y-1.5">
          <Label htmlFor="cv-pool">{tc.pool}</Label>
          <select
            id="cv-pool" value={poolId} onChange={(e) => setPoolId(e.target.value)}
            className="h-9 w-full max-w-sm rounded-md border border-input bg-white px-2 text-sm"
          >
            {pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file && !busy) void upload(file);
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-12 text-center transition-colors",
          dragging ? "border-kubri-500 bg-kubri-50" : "border-border",
        )}
      >
        {busy ? <Spinner aria-label={tc.uploading} /> : <FileUp className="h-10 w-10 text-muted-foreground/60" aria-hidden="true" />}
        <p className="font-medium">{busy ? tc.uploading : tc.dropzoneTitle}</p>
        <p className="text-sm text-muted-foreground">{tc.dropzoneHint}</p>
        <input
          ref={inputRef} type="file" accept={ACCEPT} className="sr-only"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }}
        />
        <Button type="button" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
          {tc.chooseFile}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
  );
}
```

`kubri-50` … `kubri-900` are defined as theme colors in `src/app/globals.css`.

- [ ] **Step 2: Mode switch**

`src/components/candidates/create/new-candidate-modes.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { emptyCandidateDraftFields } from "@kubri/contracts";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/provider";
import { createCandidateManuallyAction } from "@/app/(dashboard)/dashboard/candidates/new/actions";
import { CandidateForm, type PoolOption } from "./candidate-form";
import { CvUpload } from "./cv-upload";

export function NewCandidateModes({ mode, pools }: { mode: "upload" | "manual"; pools: PoolOption[] }) {
  const t = useT();
  const tc = t.candidateCreate;
  const router = useRouter();

  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-md border border-border p-1" role="tablist">
        <Link href="/dashboard/candidates/new" role="tab" aria-selected={mode === "upload"}>
          <Button type="button" size="sm" variant={mode === "upload" ? "default" : "ghost"}>{tc.modeUpload}</Button>
        </Link>
        <Link href="/dashboard/candidates/new?mode=manual" role="tab" aria-selected={mode === "manual"}>
          <Button type="button" size="sm" variant={mode === "manual" ? "default" : "ghost"}>{tc.modeManual}</Button>
        </Link>
      </div>

      {mode === "upload" ? (
        <CvUpload pools={pools} />
      ) : (
        <CandidateForm
          initialValues={emptyCandidateDraftFields()}
          pools={pools}
          onSubmit={(poolId, values) => createCandidateManuallyAction(poolId, values)}
          onSuccess={(id) => router.push(`/dashboard/candidates/${id}`)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Page**

`src/app/(dashboard)/dashboard/candidates/new/page.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireOrganization } from "@/lib/auth-utils";
import { getOrgWritablePools } from "@/lib/pools/access";
import { getDictionary } from "@/lib/i18n";
import { getServerLocale } from "@/lib/i18n/locale";
import { Button } from "@/components/ui/button";
import { NewCandidateModes } from "@/components/candidates/create/new-candidate-modes";

interface NewCandidatePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function NewCandidatePage({ searchParams }: NewCandidatePageProps) {
  let user;
  try {
    user = await requireOrganization();
  } catch {
    redirect("/login");
  }
  const t = getDictionary(await getServerLocale());
  const mode = (await searchParams)["mode"] === "manual" ? "manual" : "upload";
  const pools = (await getOrgWritablePools(user.organizationId)).map((p) => ({ id: p.id, name: p.name }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/dashboard/candidates">
        <Button variant="ghost" size="sm" className="gap-1">
          <ArrowLeft className="h-4 w-4" />
          {t.candidates.backToList}
        </Button>
      </Link>
      <div>
        <h1 className="text-2xl tracking-tight">{t.candidateCreate.newCandidate}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.candidateCreate.pageDescription}</p>
      </div>
      {pools.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t.candidateCreate.noWritablePools}
        </p>
      ) : (
        <NewCandidateModes mode={mode} pools={pools} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck and lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/candidates/create "src/app/(dashboard)/dashboard/candidates/new/page.tsx"
git commit -m "feat(candidates): new candidate page with CV upload and manual form"
```

---

### Task 7: File routes (preview + download)

**Files:**
- Create: `src/app/api/candidate-imports/[importId]/file/route.ts`
- Create: `src/app/api/candidates/[id]/documents/[documentId]/route.ts`
- Create: `src/__tests__/app/api/candidate-documents.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth-utils", () => ({ requireOrganization: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/pools/access", () => ({ getOrgCandidateVisibility: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/candidate-imports/service", () => ({ getImportForOrg: vi.fn() }));
vi.mock("@/lib/storage/candidate-documents", () => ({ createDocumentSignedUrl: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: { candidateDocument: { findFirst: vi.fn() } },
}));

import { requireOrganization } from "@/lib/auth-utils";
import { logAudit } from "@/lib/audit";
import { getImportForOrg } from "@/lib/candidate-imports/service";
import { createDocumentSignedUrl } from "@/lib/storage/candidate-documents";
import { prisma } from "@/lib/db";
import { GET as previewGET } from "@/app/api/candidate-imports/[importId]/file/route";
import { GET as downloadGET } from "@/app/api/candidates/[id]/documents/[documentId]/route";

const m = <T>(f: T) => f as unknown as ReturnType<typeof vi.fn>;
const req = new Request("http://localhost/x");

beforeEach(() => {
  vi.clearAllMocks();
  m(requireOrganization).mockResolvedValue({ id: "u", organizationId: "o", role: "ORG_MEMBER" });
  m(createDocumentSignedUrl).mockResolvedValue("https://signed");
});

describe("GET /api/candidate-imports/[importId]/file", () => {
  it("404s for another org's import", async () => {
    m(getImportForOrg).mockResolvedValueOnce(null);
    const res = await previewGET(req, { params: Promise.resolve({ importId: "i" }) });
    expect(res.status).toBe(404);
  });

  it("redirects to an inline signed URL", async () => {
    m(getImportForOrg).mockResolvedValueOnce({ storagePath: "p/i/cv.pdf", status: "READY" });
    const res = await previewGET(req, { params: Promise.resolve({ importId: "i" }) });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://signed");
    expect(m(createDocumentSignedUrl)).toHaveBeenCalledWith("p/i/cv.pdf");
  });
});

describe("GET /api/candidates/[id]/documents/[documentId]", () => {
  it("404s when the document is not visible", async () => {
    m(prisma.candidateDocument.findFirst).mockResolvedValueOnce(null);
    const res = await downloadGET(req, { params: Promise.resolve({ id: "c", documentId: "d" }) });
    expect(res.status).toBe(404);
    expect(m(logAudit)).not.toHaveBeenCalled();
  });

  it("logs the download and redirects with a download file name", async () => {
    m(prisma.candidateDocument.findFirst).mockResolvedValueOnce({ id: "d", storagePath: "p/i/cv.pdf", fileName: "cv.pdf" });
    const res = await downloadGET(req, { params: Promise.resolve({ id: "c", documentId: "d" }) });
    expect(res.status).toBe(307);
    expect(m(createDocumentSignedUrl)).toHaveBeenCalledWith("p/i/cv.pdf", { downloadAs: "cv.pdf" });
    expect(m(logAudit).mock.calls[0]![0]).toMatchObject({
      action: "candidate_document.download", resourceId: "d", metadata: { candidateId: "c" },
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/__tests__/app/api/candidate-documents.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the preview route**

`src/app/api/candidate-imports/[importId]/file/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireOrganization } from "@/lib/auth-utils";
import { getImportForOrg } from "@/lib/candidate-imports/service";
import { createDocumentSignedUrl } from "@/lib/storage/candidate-documents";

/** Inline preview of an import's file for the review page (org-scoped). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ importId: string }> },
) {
  let user;
  try {
    user = await requireOrganization();
  } catch {
    return new Response(null, { status: 401 });
  }
  const { importId } = await params;
  const imp = await getImportForOrg(importId, user.organizationId);
  if (!imp || imp.status === "DISCARDED") return new Response(null, { status: 404 });

  const url = await createDocumentSignedUrl(imp.storagePath);
  return NextResponse.redirect(url, 307);
}
```

- [ ] **Step 4: Implement the download route**

`src/app/api/candidates/[id]/documents/[documentId]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireOrganization } from "@/lib/auth-utils";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getOrgCandidateVisibility } from "@/lib/pools/access";
import { createDocumentSignedUrl } from "@/lib/storage/candidate-documents";

/** Download a candidate's document. Access-checked and audit-logged (GDPR). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; documentId: string }> },
) {
  let user;
  try {
    user = await requireOrganization();
  } catch {
    return new Response(null, { status: 401 });
  }
  const { id, documentId } = await params;

  const candidateWhere =
    user.role === "ADMIN_KUBRI"
      ? { id }
      : { id, ...(await getOrgCandidateVisibility(user.organizationId)) };

  const doc = await prisma.candidateDocument.findFirst({
    where: { id: documentId, candidateId: id, candidate: candidateWhere },
    select: { id: true, storagePath: true, fileName: true },
  });
  if (!doc) return new Response(null, { status: 404 });

  await logAudit({
    userId: user.id,
    organizationId: user.organizationId,
    action: "candidate_document.download",
    resourceType: "candidate_document",
    resourceId: doc.id,
    metadata: { candidateId: id },
  });

  const url = await createDocumentSignedUrl(doc.storagePath, { downloadAs: doc.fileName });
  return NextResponse.redirect(url, 307);
}
```

These routes are session-authenticated, so they do NOT go in `PUBLIC_PREFIXES` in `middleware.ts`.

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run src/__tests__/app/api/candidate-documents.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/candidate-imports "src/app/api/candidates/[id]/documents" src/__tests__/app/api/candidate-documents.test.ts
git commit -m "feat(candidates): access-checked preview and download routes for CVs"
```

---

### Task 8: Review page

**Files:**
- Create: `src/components/candidates/create/extraction-runner.tsx`
- Create: `src/components/candidates/create/import-review.tsx`
- Create: `src/app/(dashboard)/dashboard/candidates/imports/[importId]/page.tsx`

- [ ] **Step 1: Extraction runner**

`src/components/candidates/create/extraction-runner.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { usePendingProgress } from "@/components/layout/route-progress";
import { useT } from "@/lib/i18n/provider";
import { runCandidateImportExtractionAction } from "@/app/(dashboard)/dashboard/candidates/new/actions";

/**
 * Kicks off extraction for an UPLOADED/EXTRACTING import and refreshes the
 * page when it settles. This is a mutation trigger, not data fetching: the
 * page itself reads the result server-side after router.refresh().
 * The server claims the import atomically, so StrictMode's double effect or a
 * second tab cannot run two extractions.
 */
export function ExtractionRunner({ importId }: { importId: string }) {
  const t = useT();
  const tc = t.candidateCreate;
  const router = useRouter();
  const started = useRef(false);
  usePendingProgress(true);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void runCandidateImportExtractionAction(importId).finally(() => router.refresh());
  }, [importId, router]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <Skeleton className="h-[480px] w-full" />
      <div className="space-y-4">
        <div className="flex items-center gap-2 font-medium">
          <Spinner aria-hidden="true" />
          {tc.extractingTitle}
        </div>
        <ol className="space-y-1 text-sm text-muted-foreground">
          <li>1. {tc.extractingStepRead}</li>
          <li>2. {tc.extractingStepExtract}</li>
        </ol>
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Review component**

`src/components/candidates/create/import-review.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Sparkles } from "lucide-react";
import type { CandidateDraft } from "@kubri/contracts";
import { emptyCandidateDraftFields } from "@kubri/contracts";
import { LoadingButton } from "@/components/shared/loading-button";
import { useProgressTransition } from "@/components/layout/route-progress";
import { useT } from "@/lib/i18n/provider";
import {
  confirmCandidateImportAction,
  discardCandidateImportAction,
} from "@/app/(dashboard)/dashboard/candidates/new/actions";
import { CandidateForm } from "./candidate-form";

interface ImportReviewProps {
  importId: string;
  poolId: string;
  mimeType: string;
  fileName: string;
  extractedText: string | null;
  /** null when the extraction failed and the operator fills in by hand. */
  draft: CandidateDraft | null;
  duplicates: { id: string; firstName: string | null; lastName: string | null }[];
}

export function ImportReview({
  importId, poolId, mimeType, fileName, extractedText, draft, duplicates,
}: ImportReviewProps) {
  const t = useT();
  const tc = t.candidateCreate;
  const router = useRouter();
  const [discarding, startDiscard] = useProgressTransition();
  const fileUrl = `/api/candidate-imports/${importId}/file`;

  const discard = () =>
    startDiscard(async () => {
      await discardCandidateImportAction(importId);
      router.push("/dashboard/candidates/new");
    });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="space-y-2 lg:sticky lg:top-4 lg:self-start">
        <p className="truncate text-sm text-muted-foreground">{fileName}</p>
        {mimeType === "application/pdf" ? (
          <iframe src={fileUrl} title={fileName} className="h-[75vh] w-full rounded-md border" />
        ) : mimeType.startsWith("image/") ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL behind a redirect
          <img src={fileUrl} alt={fileName} className="w-full rounded-md border" />
        ) : (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">{tc.previewUnavailable}</p>
            <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap text-xs">{extractedText}</pre>
          </div>
        )}
      </div>

      <div className="space-y-4">
        {draft && (
          <div className="flex items-start gap-2 rounded-md bg-sky-50 p-3 text-sm text-sky-800">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {tc.extractedBanner}
          </div>
        )}
        {draft && !draft.isCv && (
          <div className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {tc.notCvWarning}
          </div>
        )}
        {duplicates.length > 0 && (
          <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
            <p className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              {tc.duplicateWarning}
            </p>
            <ul className="mt-1 list-disc pl-6">
              {duplicates.map((d) => (
                <li key={d.id}>
                  <Link href={`/dashboard/candidates/${d.id}`} className="underline" target="_blank">
                    {[d.firstName, d.lastName].filter(Boolean).join(" ") || d.id}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <CandidateForm
          initialValues={draft?.fields ?? emptyCandidateDraftFields()}
          uncertain={draft?.uncertain ?? []}
          pools={[{ id: poolId, name: "" }]}
          onSubmit={(_poolId, values) => confirmCandidateImportAction(importId, values)}
          onSuccess={(id) => router.push(`/dashboard/candidates/${id}`)}
          secondaryActions={
            <LoadingButton type="button" variant="outline" loading={discarding} onClick={discard}>
              {tc.discard}
            </LoadingButton>
          }
        />
      </div>
    </div>
  );
}
```

The pool is fixed at upload time, so `pools` has one entry and the selector stays hidden.

- [ ] **Step 3: Page**

`src/app/(dashboard)/dashboard/candidates/imports/[importId]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { candidateDraftSchema } from "@kubri/contracts";
import { requireOrganization } from "@/lib/auth-utils";
import { getImportForOrg } from "@/lib/candidate-imports/service";
import { isImportErrorCode, RETRYABLE_IMPORT_ERRORS } from "@/lib/candidate-imports/errors";
import { findPossibleDuplicates } from "@/lib/candidates/duplicates";
import { getDictionary } from "@/lib/i18n";
import { getServerLocale } from "@/lib/i18n/locale";
import { Button } from "@/components/ui/button";
import { ExtractionRunner } from "@/components/candidates/create/extraction-runner";
import { ImportReview } from "@/components/candidates/create/import-review";
import { RetryExtractionButton } from "@/components/candidates/create/retry-extraction-button";

// Server actions invoked from this page (extraction: OCR + LLM) get 60 s.
export const maxDuration = 60;

interface ImportPageProps {
  params: Promise<{ importId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CandidateImportPage({ params, searchParams }: ImportPageProps) {
  let user;
  try {
    user = await requireOrganization();
  } catch {
    redirect("/login");
  }
  const t = getDictionary(await getServerLocale());
  const tc = t.candidateCreate;
  const { importId } = await params;
  const manual = (await searchParams)["manual"] === "1";

  const imp = await getImportForOrg(importId, user.organizationId);
  if (!imp || imp.status === "DISCARDED") notFound();
  if (imp.status === "COMPLETED" && imp.candidateId) redirect(`/dashboard/candidates/${imp.candidateId}`);

  const header = (
    <div className="space-y-2">
      <Link href="/dashboard/candidates/new">
        <Button variant="ghost" size="sm" className="gap-1">
          <ArrowLeft className="h-4 w-4" />
          {tc.newCandidate}
        </Button>
      </Link>
      <h1 className="text-2xl tracking-tight">{tc.reviewTitle}</h1>
    </div>
  );

  if (imp.status === "UPLOADED" || imp.status === "EXTRACTING") {
    return <div className="space-y-6">{header}<ExtractionRunner importId={imp.id} /></div>;
  }

  if (imp.status === "FAILED" && !manual) {
    const code = isImportErrorCode(imp.errorCode) ? imp.errorCode : "INTERNAL_ERROR";
    const retryable = RETRYABLE_IMPORT_ERRORS.includes(code);
    return (
      <div className="space-y-6">
        {header}
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-destructive/50 p-12 text-center">
          <AlertCircle className="h-10 w-10 text-destructive/60" aria-hidden="true" />
          <h2 className="text-lg font-medium">{tc.failedTitle}</h2>
          <p className="text-sm text-muted-foreground">{tc.errors[code]}</p>
          <div className="flex gap-2">
            {retryable && <RetryExtractionButton importId={imp.id} />}
            <Link href={`/dashboard/candidates/imports/${imp.id}?manual=1`}>
              <Button variant="outline">{tc.fillManually}</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // READY, or FAILED filled in by hand.
  const parsedDraft = imp.status === "READY" ? candidateDraftSchema.safeParse(imp.draft) : null;
  const draft = parsedDraft?.success ? parsedDraft.data : null;
  const duplicates = draft
    ? await findPossibleDuplicates(imp.poolId, { phone: draft.fields.phone, email: draft.fields.email })
    : [];

  return (
    <div className="space-y-6">
      {header}
      <ImportReview
        importId={imp.id}
        poolId={imp.poolId}
        mimeType={imp.mimeType}
        fileName={imp.fileName}
        extractedText={imp.extractedText}
        draft={draft}
        duplicates={duplicates}
      />
    </div>
  );
}
```

- [ ] **Step 4: Retry button**

`src/components/candidates/create/retry-extraction-button.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { LoadingButton } from "@/components/shared/loading-button";
import { useProgressTransition } from "@/components/layout/route-progress";
import { useT } from "@/lib/i18n/provider";
import { runCandidateImportExtractionAction } from "@/app/(dashboard)/dashboard/candidates/new/actions";

export function RetryExtractionButton({ importId }: { importId: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useProgressTransition();
  return (
    <LoadingButton
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          await runCandidateImportExtractionAction(importId);
          router.refresh();
        })
      }
    >
      {t.candidateCreate.retry}
    </LoadingButton>
  );
}
```

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/candidates/create "src/app/(dashboard)/dashboard/candidates/imports"
git commit -m "feat(candidates): import review page with extraction, retry and manual fallback"
```

---

### Task 9: Candidate detail — Documents card and origin badge

**Files:**
- Modify: `src/types/index.ts` (interface `Candidate`)
- Modify: `src/lib/candidates/service.ts` (`dbCandidateToApp`)
- Create: `src/components/candidates/candidate-documents.tsx`
- Modify: `src/app/(dashboard)/dashboard/candidates/[id]/page.tsx`

- [ ] **Step 1: Add `createdVia`**

In `src/types/index.ts`, inside `interface Candidate`, after `channel: Channel;`:

```ts
  /** Set for candidates created from the dashboard; null for chatbot/assessment. */
  createdVia: "dashboard_form" | "dashboard_cv" | null;
```

In `src/lib/candidates/service.ts`, inside `dbCandidateToApp`, after `channel,`:

```ts
    createdVia:
      c.channel === "dashboard_form" || c.channel === "dashboard_cv" ? c.channel : null,
```

Run: `pnpm exec tsc --noEmit`
Expected: errors only where `Candidate` objects are built literally in tests/fixtures. For each, add `createdVia: null`.

- [ ] **Step 2: Documents card**

`src/components/candidates/candidate-documents.tsx`:

```tsx
import { Download, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Dictionary, Locale } from "@/lib/i18n";

export interface CandidateDocumentRow {
  id: string;
  fileName: string;
  createdAt: Date;
  uploadedByName: string | null;
}

export function CandidateDocuments({
  candidateId, documents, t, locale,
}: {
  candidateId: string;
  documents: CandidateDocumentRow[];
  t: Dictionary;
  locale: Locale;
}) {
  if (documents.length === 0) return null;
  const tc = t.candidateCreate;
  return (
    <Card className="shadow-sm border-border/60">
      <CardHeader>
        <CardTitle>{tc.documents}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {documents.map((d) => (
          <div key={d.id} className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0">
                <p className="truncate text-sm">{d.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {tc.documentUploaded
                    .replace("{name}", d.uploadedByName ?? t.candidates.deletedUser)
                    .replace("{date}", d.createdAt.toLocaleDateString(locale === "it" ? "it-IT" : "en-GB"))}
                </p>
              </div>
            </div>
            <a
              href={`/api/candidates/${candidateId}/documents/${d.id}`}
              className="inline-flex items-center gap-1 text-sm text-kubri-600 underline hover:text-kubri-800"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {tc.download}
            </a>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Wire it into the detail page**

In `src/app/(dashboard)/dashboard/candidates/[id]/page.tsx`:

1. Imports:
```ts
import { CandidateDocuments } from "@/components/candidates/candidate-documents";
import { Badge } from "@/components/ui/badge";
```
2. Store the locale: replace `const t = getDictionary(await getServerLocale());` with
```ts
  const locale = await getServerLocale();
  const t = getDictionary(locale);
```
3. Add a sixth entry to the `Promise.all` array and destructure it as `documents`:
```ts
    prisma.candidateDocument.findMany({
      where: { candidateId: id },
      orderBy: { createdAt: "desc" },
      select: { id: true, fileName: true, createdAt: true, uploadedBy: { select: { name: true } } },
    }),
```
   This query runs alongside the access-checked candidate fetch; the card only renders after the `if (!candidate)` early return, so documents of an inaccessible candidate are never shown.
4. Render the origin badge next to the candidate's name/header (beside `CandidateStatusSelect`):
```tsx
          {candidate.createdVia && (
            <Badge variant="outline">
              {candidate.createdVia === "dashboard_cv" ? t.candidateCreate.originCv : t.candidateCreate.originForm}
            </Badge>
          )}
```
5. Render the card after `<CandidateProfile … />`:
```tsx
      <CandidateDocuments
        candidateId={id}
        t={t}
        locale={locale}
        documents={documents.map((d) => ({
          id: d.id,
          fileName: d.fileName,
          createdAt: d.createdAt,
          uploadedByName: d.uploadedBy?.name ?? null,
        }))}
      />
```

- [ ] **Step 4: Typecheck, lint, tests**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm exec vitest run src/__tests__/lib/candidates`
Expected: no errors; candidate service tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/lib/candidates/service.ts src/components/candidates/candidate-documents.tsx "src/app/(dashboard)/dashboard/candidates/[id]/page.tsx" src/__tests__
git commit -m "feat(candidates): documents card and origin badge on candidate detail"
```

---

### Task 10: Entry point and CLAUDE.md

**Files:**
- Modify: `src/app/(dashboard)/dashboard/candidates/page.tsx`
- Modify: `CLAUDE.md` (repo root)

- [ ] **Step 1: "Nuovo candidato" button**

In the candidates page header, inside `<div className="flex items-center gap-2">`, as the last child (after the refresh `<form>`):

```tsx
          <Link href="/dashboard/candidates/new">
            <Button size="sm" className="gap-2">
              <UserPlus className="h-4 w-4" />
              {t.candidateCreate.newCandidate}
            </Button>
          </Link>
```

Add `UserPlus` to the existing `lucide-react` import and `import Link from "next/link";`.

Also update `t.candidates.emptyNoFilters` in both dictionaries so the empty state no longer implies the chatbot is the only source:
- it: `"I candidati appariranno qui quando il chatbot raccoglierà i profili o quando li aggiungerai tu."`
- en: the existing English sentence with `" or when you add them."` appended in the same way (read `en.ts` and keep its wording).

- [ ] **Step 2: Update CLAUDE.md**

In the root `CLAUDE.md`:

- In the "Make → Postgres Webhook" section, replace
  `The webhook is the **only** sanctioned write path for candidate data. The dashboard's UI is read-only on candidate profile fields (notes and tags are separate models).`
  with
  `Every write to \`Candidate\` goes through \`src/lib/candidates/ingest.ts\` (\`upsertCandidate\` / \`ingestCandidate\`). Sanctioned callers: the Make webhook, the assessment webhook, dashboard candidate creation (manual form and CV import, \`src/lib/candidates/dashboard-create.ts\` and \`src/lib/candidate-imports/\`), and backfill scripts. Editing existing candidates from the UI is not supported.`
- In "Candidate ingestion" conventions, replace the first bullet with
  `- All \`Candidate\` writes go through \`ingestCandidate\` / \`upsertCandidate\`. Never call \`prisma.candidate.create/update/upsert\` directly elsewhere (backfill scripts under \`scripts/\` excepted)`
  and replace `- Never expose write endpoints for candidate profile fields to the dashboard UI` with
  `- The dashboard may create candidates (form or CV import) but never edit existing profile fields`
- In "Things NOT To Do", replace the first bullet with
  `- Do NOT write \`Candidate\` rows outside \`ingestCandidate\` / \`upsertCandidate\``
- Under "Development Priorities → Done or in progress", append
  `10. Candidate creation from the dashboard (manual form + CV import with Mistral OCR/LLM)`

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/dashboard/candidates/page.tsx" src/lib/i18n/dictionaries ../../CLAUDE.md
git commit -m "feat(candidates): new candidate entry point; document the new write path"
```

(Run `git add` from `apps/dashboard`; `../../CLAUDE.md` is the repo-root file.)

---

### Task 11: End-to-end check in the browser, then PR

- [ ] **Step 1: Full test run, typecheck, lint, build**

Run: `pnpm exec vitest run && pnpm exec tsc --noEmit && pnpm lint && pnpm --filter kubri-dashboard build`
Expected: no new failures vs `main`; build succeeds.

- [ ] **Step 2: Manual walkthrough on the dev server** (`pnpm dev:dashboard`, logged in as an `ORG_MEMBER` of an org with one non-global pool)

Check each, in Italian and then English (switch from the profile page):
1. Candidates list shows "Nuovo candidato"; clicking it opens `/dashboard/candidates/new` in upload mode.
2. Upload a digital PDF CV → redirected to the review page → skeleton "Sto leggendo il CV…" → form pre-filled, PDF preview on the left, uncertain fields amber.
3. Clear the last name → "Crea candidato" → inline "Campo obbligatorio", nothing saved.
4. Fill it back → "Crea candidato" → lands on the candidate page with the "Da CV" badge and a "Documenti" card; "Scarica" downloads the file; an `AuditLog` row `candidate_document.download` exists.
5. Upload a phone photo of a CV (JPG) → OCR path works.
6. Upload a DOCX → preview shows extracted text.
7. Upload a `.txt` renamed to `.pdf` → "Formato non supportato…", no import row left behind.
8. Upload a CV whose phone matches an existing candidate → duplicate warning with link.
9. Upload, then "Scarta" → back to `/new`; the import is `DISCARDED` and the object is gone from the bucket.
10. Manual mode → fill name + surname only → candidate created with "Inserito manualmente" badge.
11. Double-click "Crea candidato" quickly → exactly one candidate.
12. Open another org's import URL → 404.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/create-candidate-ui
gh pr create --base main --title "feat: create candidates from the dashboard (form + CV import)" --body "$(cat <<'EOF'
## Summary
- "Nuovo candidato" entry point → `/dashboard/candidates/new` (CV upload or manual form)
- CV upload goes browser → Supabase Storage via signed upload URL, then server verification
- Review page per import: CV preview beside a pre-filled `CandidateForm`; uncertain fields flagged; duplicate and not-a-CV warnings; retry and manual fallback on failure
- Candidate detail: "Documenti" card (audit-logged downloads) and origin badge
- CLAUDE.md: candidate write-path rule updated

Spec: docs/superpowers/specs/2026-10-23-candidate-creation-cv-import-design.md

## Before merge
- [ ] Bucket `candidate-documents` exists in prod (from PR 2)

## Test plan
- [ ] Unit tests (actions, form state, duplicates, file routes)
- [ ] Manual walkthrough (12 checks in the plan) in IT and EN

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
