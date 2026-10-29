# Candidate Landing — Plan 1: Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything the public candidate landing needs server-side — data model, hardened public upload pipeline, abuse controls and the orchestration the public server actions call — with no UI.

**Architecture:** Builds on the CV import pipeline from `feat/create-candidate-ui` (this branch is stacked on it). New `CandidateLandingPage` model (one per organization → one non-global pool). The existing import service gains opt-in "public" options (lower size cap, file inspection, OCR page cap, pre-LLM quality gate, hard `NOT_A_CV`) and a generalized `confirmImport` (nullable user, `landing_cv` channel, consent, attach-to-existing by exact phone in the same pool). A new `src/lib/landing/` module holds Turnstile verification, the signed import cookie, the landing lookup/admin service and `flow.ts`, the framework-free orchestration that Plan 2's server actions wrap.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Prisma 7 (Postgres), Zod v4 (`zod/v4`), vitest (jsdom default; `// @vitest-environment node` where native modules run), Upstash Redis (`@upstash/redis`), `sharp`, `unpdf`, Cloudflare Turnstile (HTTP API only, no SDK).

**Spec:** `docs/superpowers/specs/2026-10-29-candidate-landing-cv-upload-design.md`

---

## Conventions for every task

- All commands run from `apps/dashboard/` unless stated otherwise.
- Run a single test file with `pnpm exec vitest run <path>`.
- This worktree has no `.env.local` / DB: tests that need `DATABASE_URL` (under `src/lib/pools/__tests__`) fail here and are **not** regressions. Every test in this plan mocks Prisma.
- If `node_modules` is missing, run `pnpm install` from the repo root first.
- Never write `any`; use `unknown` + guards.
- Commit messages: conventional commits, ending with the attribution line the session provides.

## File map

| File | Status | Responsibility |
|---|---|---|
| `prisma/schema.prisma` | modify | `CandidateLandingPage` model + back-relations |
| `prisma/migrations/20261029120000_add_candidate_landing_page/migration.sql` | create | hand-authored DDL |
| `src/lib/candidates/phone.ts` | create | `normalizePhone` |
| `src/lib/candidates/duplicates.ts` | modify | `findCandidateIdBySamePhone` (exact, same pool, tx-aware) |
| `src/lib/documents/ocr.ts` | modify | `maxPages` parameter |
| `src/lib/documents/extract-text.ts` | modify | `maxOcrPages` option |
| `src/lib/documents/inspect.ts` | create | public file inspection (PDF/DOCX active content, page cap, image re-encode) |
| `src/lib/documents/quality.ts` | create | `passesCvQualityGate` (free, pre-LLM) |
| `src/lib/storage/candidate-documents.ts` | modify | `replaceCandidateDocument` |
| `src/lib/candidate-imports/errors.ts` | modify | `REJECTED_FILE` code |
| `src/lib/candidate-imports/service.ts` | modify | public options, generalized `confirmImport`, 24 h public cleanup, `getPublicImport` |
| `src/lib/candidates/dashboard-create.ts` | modify | `landing_cv` channel + consent |
| `src/lib/rate-limit/index.ts` | create | fixed-window counters, fail-closed in prod |
| `src/lib/landing/turnstile.ts` | create | Turnstile `siteverify` |
| `src/lib/landing/import-cookie.ts` | create | signed import ↔ browser binding, IP hash |
| `src/lib/validations/landing-page.ts` | create | admin input schema + slug regex |
| `src/lib/landing/service.ts` | create | `getActiveLandingBySlug`, `getLandingForOrg`, `saveLandingPage` |
| `src/lib/landing/contact.ts` | create | contact schema, draft → contact, merge contact into fields |
| `src/lib/landing/flow.ts` | create | request / register / extract / confirm orchestration |
| `src/lib/i18n/dictionaries/{it,en}.ts` | modify | `candidateCreate.errors.REJECTED_FILE` |
| `src/middleware.ts` | modify | `/candidati` public prefix |
| `.env.example` | modify | 4 new variables |
| `package.json` | modify | `sharp` dependency |

---

### Task 1: `CandidateLandingPage` model and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261029120000_add_candidate_landing_page/migration.sql`

- [ ] **Step 1: Add the model**

Append to `prisma/schema.prisma`, after `model CandidateDocument { … }`:

```prisma
/// Public candidate landing (/candidati/<slug>): one per organization, pointing
/// at one non-global pool linked to it. Offers WhatsApp or CV upload.
model CandidateLandingPage {
  id               String   @id @default(uuid()) @db.Uuid
  slug             String   @unique
  organizationId   String   @unique @db.Uuid
  poolId           String   @db.Uuid
  enabled          Boolean  @default(true)
  privacyPolicyUrl String
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  pool         Pool         @relation(fields: [poolId], references: [id], onDelete: Restrict)

  @@index([poolId])
}
```

In `model Organization`, after the `candidateImports  CandidateImport[]` line, add:

```prisma
  landingPage       CandidateLandingPage?
```

In `model Pool`, after its `candidateImports CandidateImport[]` line, add:

```prisma
  landingPages     CandidateLandingPage[]
```

- [ ] **Step 2: Hand-author the migration**

No DB in this worktree, and `migrate dev` injects spurious `DROP INDEX` for the pgvector HNSW indexes — write the SQL by hand. Create `prisma/migrations/20261029120000_add_candidate_landing_page/migration.sql`:

```sql
-- Public candidate landing pages. Additive only; no existing rows touched.

-- CreateTable
CREATE TABLE "CandidateLandingPage" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "organizationId" UUID NOT NULL,
    "poolId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "privacyPolicyUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateLandingPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CandidateLandingPage_slug_key" ON "CandidateLandingPage"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateLandingPage_organizationId_key" ON "CandidateLandingPage"("organizationId");

-- CreateIndex
CREATE INDEX "CandidateLandingPage_poolId_idx" ON "CandidateLandingPage"("poolId");

-- AddForeignKey
ALTER TABLE "CandidateLandingPage" ADD CONSTRAINT "CandidateLandingPage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateLandingPage" ADD CONSTRAINT "CandidateLandingPage_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "Pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 3: Regenerate the client and typecheck**

Run: `pnpm exec prisma generate && pnpm exec tsc --noEmit -p .`
Expected: generate succeeds; tsc exits 0 (do **not** run `prisma format` — it rewrites unrelated lines).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261029120000_add_candidate_landing_page
git commit -m "feat(db): CandidateLandingPage model"
```

---

### Task 2: `normalizePhone`

**Files:**
- Create: `src/lib/candidates/phone.ts`
- Test: `src/__tests__/lib/candidates/phone.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { normalizePhone } from "@/lib/candidates/phone";

describe("normalizePhone", () => {
  it("keeps digits of an international number", () => {
    expect(normalizePhone("+39 333 123 4567")).toBe("393331234567");
  });
  it("drops a 00 international prefix", () => {
    expect(normalizePhone("0039-333-1234567")).toBe("393331234567");
  });
  it("adds 39 to a 10-digit Italian mobile without prefix", () => {
    expect(normalizePhone("333 1234567")).toBe("393331234567");
  });
  it("leaves other countries alone", () => {
    expect(normalizePhone("+212 612 345 678")).toBe("212612345678");
  });
  it("returns null for empty or too short input", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/__tests__/lib/candidates/phone.test.ts`
Expected: FAIL — cannot resolve `@/lib/candidates/phone`.

- [ ] **Step 3: Implement**

`src/lib/candidates/phone.ts`:

```ts
/**
 * Canonical digits-only phone for exact comparisons: strips separators and a
 * leading "00", and prefixes 39 to 10-digit numbers starting with 3 (Italian
 * mobiles written without country code). Null when fewer than 8 digits remain.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith("3")) digits = `39${digits}`;
  return digits.length >= 8 ? digits : null;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm exec vitest run src/__tests__/lib/candidates/phone.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/candidates/phone.ts src/__tests__/lib/candidates/phone.test.ts
git commit -m "feat(candidates): normalizePhone for exact phone matching"
```

---

### Task 3: Exact same-pool phone lookup

**Files:**
- Modify: `src/lib/candidates/duplicates.ts`
- Test: `src/__tests__/lib/candidates/duplicates.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/lib/candidates/duplicates.test.ts` (keep the existing imports; add `findCandidateIdBySamePhone` to the import from `@/lib/candidates/duplicates`):

```ts
describe("findCandidateIdBySamePhone", () => {
  const db = { candidate: { findMany: vi.fn() } };

  beforeEach(() => vi.clearAllMocks());

  it("returns the candidate whose normalized phone matches exactly, in the given pool", async () => {
    db.candidate.findMany.mockResolvedValueOnce([
      { id: "c-other", phone: "+44 7333 1234567" },
      { id: "c-same", phone: "333 1234567" },
    ]);
    const id = await findCandidateIdBySamePhone(db as never, "pool-1", "+39 333 123 4567");
    expect(id).toBe("c-same");
    expect(db.candidate.findMany.mock.calls[0]![0].where).toEqual({
      poolId: "pool-1",
      phone: { endsWith: "31234567" },
    });
  });

  it("returns null without querying when the phone is not usable", async () => {
    await expect(findCandidateIdBySamePhone(db as never, "pool-1", "123")).resolves.toBeNull();
    expect(db.candidate.findMany).not.toHaveBeenCalled();
  });

  it("returns null when only suffixes match", async () => {
    db.candidate.findMany.mockResolvedValueOnce([{ id: "c-x", phone: "+44 7333 1234567" }]);
    await expect(
      findCandidateIdBySamePhone(db as never, "pool-1", "+39 333 123 4567"),
    ).resolves.toBeNull();
  });
});
```

If the file does not already import `vi` and `beforeEach` from `vitest`, add them.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/__tests__/lib/candidates/duplicates.test.ts`
Expected: FAIL — `findCandidateIdBySamePhone` is not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/candidates/duplicates.ts`, and add `import { normalizePhone } from "./phone";` to its imports:

```ts
/**
 * The candidate of `poolId` whose phone is the same number as `phone` after
 * normalization, or null. Used to attach a public-landing CV to an existing
 * profile instead of creating a duplicate — exact match only, same pool only
 * (never across pools: they may belong to different controllers). The SQL
 * filter narrows by the last 8 digits; stored phones with separators inside
 * those digits are missed (a duplicate is created — acceptable).
 */
export async function findCandidateIdBySamePhone(
  db: Prisma.TransactionClient,
  poolId: string,
  phone: string | null,
): Promise<string | null> {
  const target = normalizePhone(phone);
  if (!target) return null;
  const rows = await db.candidate.findMany({
    where: { poolId, phone: { endsWith: target.slice(-8) } },
    select: { id: true, phone: true },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  return rows.find((r) => normalizePhone(r.phone) === target)?.id ?? null;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm exec vitest run src/__tests__/lib/candidates/duplicates.test.ts`
Expected: PASS (existing + 3 new). The `where` assertion uses `toEqual`, which ignores the `orderBy`/`take` siblings because it only checks `.where`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/candidates/duplicates.ts src/__tests__/lib/candidates/duplicates.test.ts
git commit -m "feat(candidates): exact same-pool phone lookup"
```

---

### Task 4: OCR page cap as a parameter

**Files:**
- Modify: `src/lib/documents/ocr.ts`
- Modify: `src/lib/documents/extract-text.ts`
- Test: `src/__tests__/lib/documents/ocr.test.ts`, `src/__tests__/lib/documents/extract-text.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/lib/documents/ocr.test.ts` (reuse its existing `fetch` stub / env setup; if it stubs `fetch` per test with `vi.stubGlobal`, do the same):

```ts
it("requests only the first maxPages pages of a PDF", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ pages: [{ markdown: "testo" }] }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  process.env["MISTRAL_API_KEY"] = "k";
  await ocrDocument(new Uint8Array([1, 2, 3]), "application/pdf", 20000, 3);
  const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as { pages: number[] };
  expect(body.pages).toEqual([0, 1, 2]);
});
```

Append to `src/__tests__/lib/documents/extract-text.test.ts` (the file already mocks `@/lib/documents/ocr`; reuse that mock as `ocrDocument`):

```ts
it("passes maxOcrPages through to OCR for images", async () => {
  m(ocrDocument).mockResolvedValueOnce({ text: "testo letto", pageCount: 1 });
  await extractDocumentText(new Uint8Array([0xff, 0xd8, 0xff]), "jpeg", { maxOcrPages: 3 });
  expect(m(ocrDocument)).toHaveBeenCalledWith(expect.any(Uint8Array), "image/jpeg", undefined, 3);
});
```

If the file names its mock helper differently than `m`, use its helper.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/__tests__/lib/documents/ocr.test.ts src/__tests__/lib/documents/extract-text.test.ts`
Expected: FAIL — pages has 10 entries; `ocrDocument` called with 2 args.

- [ ] **Step 3: Implement**

In `src/lib/documents/ocr.ts` rename the constant and add the parameter:

```ts
/** A CV rarely needs more; keeps long scans inside the request budget. */
export const MAX_OCR_PAGES = 10;
```

```ts
export async function ocrDocument(
  bytes: Uint8Array,
  mimeType: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxPages = MAX_OCR_PAGES,
): Promise<{ text: string; pageCount: number }> {
```

and replace the pages line with:

```ts
  if (isPdf) payload["pages"] = Array.from({ length: maxPages }, (_, i) => i);
```

In `src/lib/documents/extract-text.ts`:

```ts
export interface ExtractTextOptions {
  /** Cap on pages sent to OCR (public uploads use a lower cap than operators). */
  maxOcrPages?: number;
}

export async function extractDocumentText(
  bytes: Uint8Array,
  kind: DocumentKind,
  opts: ExtractTextOptions = {},
): Promise<ExtractedText> {
```

Change both `ocrOrThrow(bytes, kind)` calls to `ocrOrThrow(bytes, kind, opts.maxOcrPages)`, and the helper to:

```ts
async function ocrOrThrow(
  bytes: Uint8Array,
  kind: DocumentKind,
  maxOcrPages?: number,
): Promise<ExtractedText> {
  const r = await ocrDocument(bytes, DOCUMENT_MIME[kind], undefined, maxOcrPages);
  const text = r.text.trim();
  if (!text) throw new DocumentError("NO_TEXT");
  return { text, method: "ocr", pageCount: r.pageCount };
}
```

Existing extract-text tests that assert `toHaveBeenCalledWith(bytes, mime)` now see two extra `undefined` args: update each such assertion to `toHaveBeenCalledWith(<same args>, undefined, undefined)`.

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm exec vitest run src/__tests__/lib/documents/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/documents/ocr.ts src/lib/documents/extract-text.ts src/__tests__/lib/documents/
git commit -m "feat(documents): configurable OCR page cap"
```

---

### Task 5: Public file inspection

**Files:**
- Modify: `package.json` (add `sharp`)
- Create: `src/lib/documents/inspect.ts`
- Test: `src/__tests__/lib/documents/inspect.test.ts`

- [ ] **Step 1: Add the dependency**

Run from the repo root: `pnpm --filter kubri-dashboard add sharp@^0.34.5`
Expected: `apps/dashboard/package.json` lists `"sharp": "^0.34.5"` (already in the lockfile as a Next.js dependency).

- [ ] **Step 2: Write the failing test**

`src/__tests__/lib/documents/inspect.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import sharp from "sharp";

const pdfProxy = {
  numPages: 2,
  getJSActions: vi.fn(),
  getAttachments: vi.fn(),
  loadingTask: { destroy: vi.fn() },
};
vi.mock("unpdf", () => ({ getDocumentProxy: vi.fn() }));

import { getDocumentProxy } from "unpdf";
import { inspectPublicDocument, PUBLIC_MAX_PDF_PAGES } from "@/lib/documents/inspect";

const m = <T>(f: T) => f as unknown as ReturnType<typeof vi.fn>;
const enc = (s: string) => new TextEncoder().encode(s);

describe("inspectPublicDocument — PDF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pdfProxy.numPages = 2;
    pdfProxy.getJSActions.mockResolvedValue(null);
    pdfProxy.getAttachments.mockResolvedValue(null);
    m(getDocumentProxy).mockResolvedValue(pdfProxy);
  });

  it("accepts a plain PDF unchanged", async () => {
    const bytes = enc("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj");
    const r = await inspectPublicDocument(bytes, "pdf");
    expect(r).toEqual({ ok: true, bytes, kind: "pdf" });
  });

  it.each(["/JavaScript", "/JS (app.alert(1))", "/Launch", "/EmbeddedFile", "/RichMedia", "/XFA"])(
    "rejects %s in the raw bytes",
    async (marker) => {
      const r = await inspectPublicDocument(enc(`%PDF-1.7 << ${marker} >>`), "pdf");
      expect(r).toEqual({ ok: false, reason: "pdf_active_content" });
    },
  );

  it("decodes #xx escapes in names before scanning", async () => {
    const r = await inspectPublicDocument(enc("%PDF-1.7 << /J#61vaScript >>"), "pdf");
    expect(r).toEqual({ ok: false, reason: "pdf_active_content" });
  });

  it("does not flag names that merely start with JS", async () => {
    const r = await inspectPublicDocument(enc("%PDF-1.7 << /JSONData 1 >>"), "pdf");
    expect(r.ok).toBe(true);
  });

  it("rejects an encrypted PDF", async () => {
    const r = await inspectPublicDocument(enc("%PDF-1.7 trailer << /Encrypt 5 0 R >>"), "pdf");
    expect(r).toEqual({ ok: false, reason: "pdf_encrypted" });
  });

  it("rejects active content hidden in object streams (pdf.js view)", async () => {
    pdfProxy.getJSActions.mockResolvedValueOnce({ OpenAction: ["app.alert(1)"] });
    const r = await inspectPublicDocument(enc("%PDF-1.7 /ObjStm"), "pdf");
    expect(r).toEqual({ ok: false, reason: "pdf_active_content" });
  });

  it("rejects attachments reported by pdf.js", async () => {
    pdfProxy.getAttachments.mockResolvedValueOnce({ "x.exe": {} });
    const r = await inspectPublicDocument(enc("%PDF-1.7"), "pdf");
    expect(r).toEqual({ ok: false, reason: "pdf_active_content" });
  });

  it("rejects more than the page cap", async () => {
    pdfProxy.numPages = PUBLIC_MAX_PDF_PAGES + 1;
    const r = await inspectPublicDocument(enc("%PDF-1.7"), "pdf");
    expect(r).toEqual({ ok: false, reason: "pdf_too_many_pages" });
  });

  it("maps a password error to pdf_encrypted and other load errors to pdf_unreadable", async () => {
    m(getDocumentProxy).mockRejectedValueOnce(Object.assign(new Error("pw"), { name: "PasswordException" }));
    await expect(inspectPublicDocument(enc("%PDF-1.7"), "pdf")).resolves.toEqual({
      ok: false, reason: "pdf_encrypted",
    });
    m(getDocumentProxy).mockRejectedValueOnce(new Error("bad xref"));
    await expect(inspectPublicDocument(enc("%PDF-1.7"), "pdf")).resolves.toEqual({
      ok: false, reason: "pdf_unreadable",
    });
  });
});

describe("inspectPublicDocument — DOCX", () => {
  it("accepts a DOCX without active parts", async () => {
    const bytes = enc("PK\u0003\u0004word/document.xml");
    await expect(inspectPublicDocument(bytes, "docx")).resolves.toEqual({ ok: true, bytes, kind: "docx" });
  });

  it.each(["word/vbaProject.bin", "word/embeddings/oleObject1.bin", "word/activeX/activeX1.xml", "macroEnabled"])(
    "rejects %s",
    async (part) => {
      const r = await inspectPublicDocument(enc(`PK\u0003\u0004word/document.xml ${part}`), "docx");
      expect(r).toEqual({ ok: false, reason: "docx_active_content" });
    },
  );
});

describe("inspectPublicDocument — images", () => {
  it("re-encodes to JPEG and strips EXIF", async () => {
    const withExif = await sharp({
      create: { width: 20, height: 10, channels: 3, background: { r: 200, g: 0, b: 0 } },
    })
      .jpeg()
      .withExif({ IFD0: { Copyright: "secret-gps-owner" } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const r = await inspectPublicDocument(new Uint8Array(withExif), "jpeg");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe("jpeg");
    const meta = await sharp(Buffer.from(r.bytes)).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined();
  });

  it("converts PNG to JPEG", async () => {
    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 0, b: 255 } },
    }).png().toBuffer();
    const r = await inspectPublicDocument(new Uint8Array(png), "png");
    expect(r.ok && r.kind).toBe("jpeg");
  });

  it("rejects bytes sharp cannot decode", async () => {
    const r = await inspectPublicDocument(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), "jpeg");
    expect(r).toEqual({ ok: false, reason: "image_unreadable" });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm exec vitest run src/__tests__/lib/documents/inspect.test.ts`
Expected: FAIL — cannot resolve `@/lib/documents/inspect`.

- [ ] **Step 4: Implement**

`src/lib/documents/inspect.ts`:

```ts
import sharp from "sharp";
import { getDocumentProxy } from "unpdf";
import type { DocumentKind } from "./detect";

/** Public uploads only: a CV longer than this is not what we are looking for. */
export const PUBLIC_MAX_PDF_PAGES = 5;
const MAX_IMAGE_SIDE = 3000;
/** Decompression-bomb guard for images (~40 MP). */
const MAX_INPUT_PIXELS = 40_000_000;

export type InspectRejectReason =
  | "pdf_active_content"
  | "pdf_encrypted"
  | "pdf_too_many_pages"
  | "pdf_unreadable"
  | "docx_active_content"
  | "image_unreadable";

export type InspectResult =
  | { ok: true; bytes: Uint8Array; kind: DocumentKind }
  | { ok: false; reason: InspectRejectReason };

// A PDF name ends at a delimiter, so "/JS" must not match "/JSONData".
const PDF_ACTIVE_NAME = /\/(?:JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA)(?![A-Za-z0-9])/;
const PDF_ENCRYPT_NAME = /\/Encrypt(?![A-Za-z0-9])/;
const DOCX_ACTIVE_PART = /vbaProject\.bin|word\/embeddings\/|word\/activeX\/|macroEnabled/i;

/** PDF names may hex-escape characters ("/J#61vaScript"); undo that before scanning. */
function pdfText(bytes: Uint8Array): string {
  return new TextDecoder("latin1")
    .decode(bytes)
    .replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

async function inspectPdf(bytes: Uint8Array): Promise<InspectResult> {
  const text = pdfText(bytes);
  if (PDF_ENCRYPT_NAME.test(text)) return { ok: false, reason: "pdf_encrypted" };
  if (PDF_ACTIVE_NAME.test(text)) return { ok: false, reason: "pdf_active_content" };

  // The byte scan misses names inside compressed object streams: ask pdf.js too.
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    return { ok: false, reason: name === "PasswordException" ? "pdf_encrypted" : "pdf_unreadable" };
  }
  try {
    if (pdf.numPages > PUBLIC_MAX_PDF_PAGES) return { ok: false, reason: "pdf_too_many_pages" };
    const [js, attachments] = await Promise.all([pdf.getJSActions(), pdf.getAttachments()]);
    if (!isEmpty(js) || !isEmpty(attachments)) return { ok: false, reason: "pdf_active_content" };
    return { ok: true, bytes, kind: "pdf" };
  } catch {
    return { ok: false, reason: "pdf_unreadable" };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/**
 * Re-encode to JPEG: drops EXIF (incl. GPS) and anything appended to or
 * smuggled inside the original (polyglot files). Output replaces the upload.
 */
async function reencodeImage(bytes: Uint8Array): Promise<InspectResult> {
  try {
    const out = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { ok: true, bytes: new Uint8Array(out), kind: "jpeg" };
  } catch {
    return { ok: false, reason: "image_unreadable" };
  }
}

/**
 * Extra checks for files uploaded by anonymous visitors (public landing).
 * The server never executes these files; the checks protect the operator who
 * later downloads them. Returns the bytes to store (re-encoded for images).
 */
export async function inspectPublicDocument(
  bytes: Uint8Array,
  kind: DocumentKind,
): Promise<InspectResult> {
  switch (kind) {
    case "pdf":
      return inspectPdf(bytes);
    case "docx": {
      // Zip entry names are stored uncompressed in local headers: a byte scan finds them.
      const names = new TextDecoder("latin1").decode(bytes);
      return DOCX_ACTIVE_PART.test(names)
        ? { ok: false, reason: "docx_active_content" }
        : { ok: true, bytes, kind };
    }
    case "jpeg":
    case "png":
      return reencodeImage(bytes);
  }
}
```

If `tsc` reports that `getJSActions` / `getAttachments` are missing from unpdf's `PDFDocumentProxy` type, check `node_modules/unpdf/dist/types/src/display/api.d.ts` for their exact names; both exist in pdf.js ≥ 2.7, which unpdf bundles.

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm exec vitest run src/__tests__/lib/documents/inspect.test.ts && pnpm exec tsc --noEmit -p .`
Expected: PASS; tsc exits 0.

- [ ] **Step 6: Commit**

```bash
git add package.json ../../pnpm-lock.yaml src/lib/documents/inspect.ts src/__tests__/lib/documents/inspect.test.ts
git commit -m "feat(documents): inspect public uploads for active content and re-encode images"
```

---

### Task 6: Pre-LLM quality gate

**Files:**
- Create: `src/lib/documents/quality.ts`
- Test: `src/__tests__/lib/documents/quality.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { MIN_CV_TEXT_CHARS, passesCvQualityGate } from "@/lib/documents/quality";

const filler = (n: number) => "x".repeat(n);

describe("passesCvQualityGate", () => {
  it("rejects short text even with signals", () => {
    expect(passesCvQualityGate("Esperienza 2019 mario@example.com")).toBe(false);
  });

  it("rejects long text without any CV signal", () => {
    expect(passesCvQualityGate(`${filler(MIN_CV_TEXT_CHARS + 50)} lorem ipsum`)).toBe(false);
  });

  it.each([
    "Telefono +39 333 123 4567",
    "mario.rossi@example.com",
    "Magazziniere dal 2018",
    "Esperienze lavorative",
    "Work experience",
    "Expérience professionnelle et formation",
    "Experiencia laboral",
  ])("accepts long text with a signal: %s", (signal) => {
    expect(passesCvQualityGate(`${filler(MIN_CV_TEXT_CHARS)} ${signal}`)).toBe(true);
  });

  it("does not count whitespace toward the minimum", () => {
    expect(passesCvQualityGate(`${" \n".repeat(400)} 2019`)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/__tests__/lib/documents/quality.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/lib/documents/quality.ts`:

```ts
/** Below this many non-whitespace characters there is no CV worth an LLM call. */
export const MIN_CV_TEXT_CHARS = 300;

const CV_SIGNALS: readonly RegExp[] = [
  /\+?\d[\d\s./-]{7,}\d/, // phone-like
  /[^\s@]+@[^\s@]+\.[a-z]{2,}/i, // email
  /\b(?:19|20)\d{2}\b/, // a year
  /\b(?:esperienz|lavor|formazion|competenz|istruzion|curricul|experience|education|skills|employment|expérience|formation|compétences|experiencia|formación|educación|habilidades)/i,
];

/**
 * Free check run before the paid LLM step on public uploads: enough text and
 * at least one thing a CV usually has. Deliberately permissive — it only has
 * to stop junk (blank scans, random files), the LLM's isCv does the rest.
 */
export function passesCvQualityGate(text: string): boolean {
  if (text.replace(/\s+/g, "").length < MIN_CV_TEXT_CHARS) return false;
  return CV_SIGNALS.some((re) => re.test(text));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm exec vitest run src/__tests__/lib/documents/quality.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/documents/quality.ts src/__tests__/lib/documents/quality.test.ts
git commit -m "feat(documents): free pre-LLM CV quality gate"
```

---

### Task 7: `REJECTED_FILE` error code and storage replace

**Files:**
- Modify: `src/lib/candidate-imports/errors.ts`
- Modify: `src/lib/storage/candidate-documents.ts`
- Modify: `src/lib/i18n/dictionaries/it.ts`, `src/lib/i18n/dictionaries/en.ts`
- Test: `src/__tests__/lib/storage/candidate-documents.test.ts`

- [ ] **Step 1: Write the failing storage test**

Append to `src/__tests__/lib/storage/candidate-documents.test.ts`, following its existing mock of the Supabase bucket (it mocks `createSupabaseAdminClient().storage.from()`; add an `upload` mock fn to that bucket object if missing):

```ts
it("replaceCandidateDocument overwrites the object with the given type", async () => {
  bucketMock.upload.mockResolvedValueOnce({ data: { path: "p/i/cv.png" }, error: null });
  await replaceCandidateDocument("p/i/cv.png", new Uint8Array([1]), "image/jpeg");
  expect(bucketMock.upload).toHaveBeenCalledWith("p/i/cv.png", new Uint8Array([1]), {
    upsert: true,
    contentType: "image/jpeg",
  });
});

it("replaceCandidateDocument throws StorageError on failure", async () => {
  bucketMock.upload.mockResolvedValueOnce({ data: null, error: { message: "nope" } });
  await expect(
    replaceCandidateDocument("p/i/cv.png", new Uint8Array([1]), "image/jpeg"),
  ).rejects.toBeInstanceOf(StorageError);
});
```

Use the file's actual name for the bucket mock object in place of `bucketMock`.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/__tests__/lib/storage/candidate-documents.test.ts`
Expected: FAIL — `replaceCandidateDocument` is not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/storage/candidate-documents.ts`:

```ts
/** Overwrite an object in place (public uploads: re-encoded images). */
export async function replaceCandidateDocument(
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const { error } = await bucket().upload(path, bytes, { upsert: true, contentType });
  if (error) throw new StorageError(`replace failed: ${error.message}`);
}
```

In `src/lib/candidate-imports/errors.ts` add `"REJECTED_FILE",` to `IMPORT_ERROR_CODES` right after `"UNSUPPORTED_TYPE",`.

`ImportErrorCode` feeds the operator UI's `tc.errors[code]` lookup, so add the key to both dictionaries under `candidateCreate.errors`, after `UNSUPPORTED_TYPE`:

`it.ts`:
```ts
      REJECTED_FILE: "Il file contiene elementi non consentiti (macro, script o allegati).",
```

`en.ts`:
```ts
      REJECTED_FILE: "The file contains content we don't allow (macros, scripts or attachments).",
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm exec vitest run src/__tests__/lib/storage/ src/lib/i18n && pnpm exec tsc --noEmit -p .`
Expected: PASS (including the i18n parity test); tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/candidate-imports/errors.ts src/lib/storage/candidate-documents.ts src/lib/i18n/dictionaries src/__tests__/lib/storage/candidate-documents.test.ts
git commit -m "feat(candidate-imports): REJECTED_FILE code and storage replace"
```

---

### Task 8: Public options in upload and extraction

**Files:**
- Modify: `src/lib/candidate-imports/service.ts`
- Test: `src/__tests__/lib/candidate-imports/service.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/lib/candidate-imports/service.test.ts`:

1. Add to the `@/lib/storage/candidate-documents` mock factory: `replaceCandidateDocument: vi.fn(),` and import it alongside the others.
2. Add `vi.mock("@/lib/documents/inspect", () => ({ inspectPublicDocument: vi.fn() }));` next to the other mocks and `import { inspectPublicDocument } from "@/lib/documents/inspect";`.
3. Append:

```ts
describe("public upload options", () => {
  beforeEach(() => vi.clearAllMocks());

  it("createUploadTicket honours a lower maxBytes", async () => {
    await expect(
      createUploadTicket({ poolId: "p", fileName: "cv.pdf", fileSize: 6 * 1024 * 1024, maxBytes: 5 * 1024 * 1024 }),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });

  it("registerUpload with inspect rejects and removes an unsafe file", async () => {
    m(downloadCandidateDocument).mockResolvedValueOnce(PDF);
    m(inspectPublicDocument).mockResolvedValueOnce({ ok: false, reason: "pdf_active_content" });
    await expect(
      registerUpload({ ...REGISTER, origin: "PUBLIC_LINK", createdById: null, inspect: true }),
    ).rejects.toMatchObject({ code: "REJECTED_FILE" });
    expect(m(removeCandidateDocuments)).toHaveBeenCalledWith([`p/${IMPORT_ID}/CV_Ahmed.pdf`]);
    expect(m(prisma.candidateImport.create)).not.toHaveBeenCalled();
  });

  it("registerUpload with inspect stores re-encoded bytes and their type", async () => {
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
    const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 1, 2]);
    m(downloadCandidateDocument).mockResolvedValueOnce(PNG);
    m(inspectPublicDocument).mockResolvedValueOnce({ ok: true, bytes: JPEG, kind: "jpeg" });
    await registerUpload({ ...REGISTER, fileName: "foto.png", origin: "PUBLIC_LINK", createdById: null, inspect: true });
    expect(m(replaceCandidateDocument)).toHaveBeenCalledWith(`p/${IMPORT_ID}/foto.png`, JPEG, "image/jpeg");
    expect(m(prisma.candidateImport.create).mock.calls[0]![0].data).toMatchObject({
      origin: "PUBLIC_LINK", createdById: null, mimeType: "image/jpeg", fileSize: 5,
    });
  });

  it("registerUpload without inspect never calls the inspector", async () => {
    m(downloadCandidateDocument).mockResolvedValueOnce(PDF);
    await registerUpload(REGISTER);
    expect(m(inspectPublicDocument)).not.toHaveBeenCalled();
  });

  it("registerUpload honours maxBytes on the stored object", async () => {
    m(downloadCandidateDocument).mockResolvedValueOnce(new Uint8Array(11));
    await expect(registerUpload({ ...REGISTER, maxBytes: 10 })).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });
});

describe("runExtraction public options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m(prisma.candidateImport.updateMany).mockResolvedValue({ count: 1 });
    m(prisma.candidateImport.findUniqueOrThrow).mockResolvedValue({ storagePath: "p/i/cv.pdf" });
    m(downloadCandidateDocument).mockResolvedValue(PDF);
    m(extractDocumentText).mockResolvedValue({ text: "testo del cv", method: "pdf", pageCount: 1 });
  });

  it("passes maxOcrPages to text extraction", async () => {
    m(extractCandidateDraft).mockResolvedValueOnce(DRAFT);
    await runExtraction(IMPORT_ID, { maxOcrPages: 3 });
    expect(m(extractDocumentText)).toHaveBeenCalledWith(PDF, "pdf", { maxOcrPages: 3 });
  });

  it("fails NOT_A_CV without calling the LLM when the text gate says no", async () => {
    await runExtraction(IMPORT_ID, { textGate: () => false });
    expect(m(extractCandidateDraft)).not.toHaveBeenCalled();
    const finish = m(prisma.candidateImport.updateMany).mock.calls[1]![0];
    expect(finish.data).toEqual({ status: "FAILED", errorCode: "NOT_A_CV" });
  });

  it("rejectNonCv turns isCv=false into FAILED and keeps no text", async () => {
    m(extractCandidateDraft).mockResolvedValueOnce({ ...DRAFT, isCv: false });
    await runExtraction(IMPORT_ID, { rejectNonCv: true });
    const finish = m(prisma.candidateImport.updateMany).mock.calls[1]![0];
    expect(finish.data).toEqual({ status: "FAILED", errorCode: "NOT_A_CV" });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/__tests__/lib/candidate-imports/service.test.ts`
Expected: the new tests FAIL (unknown options / extra args), existing tests PASS — except `extractDocumentText` call assertions in existing `runExtraction` tests, which must be updated in Step 3.

- [ ] **Step 3: Implement**

In `src/lib/candidate-imports/service.ts`:

Imports — add:

```ts
import type { DocumentKind } from "@/lib/documents/detect";
import { inspectPublicDocument } from "@/lib/documents/inspect";
```

and add `replaceCandidateDocument` to the `@/lib/storage/candidate-documents` import.

`createUploadTicket`:

```ts
export async function createUploadTicket(input: {
  poolId: string;
  fileName: string;
  fileSize: number;
  /** Public uploads pass a lower cap. */
  maxBytes?: number;
}): Promise<UploadTicket> {
  if (input.fileSize > (input.maxBytes ?? MAX_DOCUMENT_BYTES)) throw new ImportError("FILE_TOO_LARGE");
```

(the rest unchanged; it destructures nothing, so `maxBytes` is simply ignored downstream).

`RegisterUploadInput` — add:

```ts
  /** Public uploads pass a lower cap. */
  maxBytes?: number;
  /** Public uploads: reject active content, re-encode images (inspectPublicDocument). */
  inspect?: boolean;
```

Add a helper above `registerUpload`:

```ts
async function removeQuietly(storagePath: string, why: string): Promise<void> {
  try {
    await removeCandidateDocuments([storagePath]);
  } catch (e) {
    console.error(`[candidate import] ${why} removal failed`, { storagePath, error: e });
  }
}
```

Replace the body of `registerUpload` after the download with:

```ts
  const tooLarge = bytes.byteLength > (input.maxBytes ?? MAX_DOCUMENT_BYTES);
  const detected = tooLarge ? null : detectDocumentKind(bytes);
  if (!detected) {
    await removeQuietly(storagePath, "invalid upload");
    throw new ImportError(tooLarge ? "FILE_TOO_LARGE" : "UNSUPPORTED_TYPE");
  }

  let stored = bytes;
  let kind: DocumentKind = detected;
  if (input.inspect) {
    const inspected = await inspectPublicDocument(bytes, detected);
    if (!inspected.ok) {
      console.warn("[candidate import] public upload rejected", { reason: inspected.reason });
      await removeQuietly(storagePath, "rejected upload");
      throw new ImportError("REJECTED_FILE");
    }
    if (inspected.bytes !== bytes) {
      try {
        await replaceCandidateDocument(storagePath, inspected.bytes, DOCUMENT_MIME[inspected.kind]);
      } catch (e) {
        await removeQuietly(storagePath, "unreplaceable upload");
        throw new ImportError("STORAGE_ERROR", e);
      }
    }
    stored = inspected.bytes;
    kind = inspected.kind;
  }

  await prisma.candidateImport.create({
    data: {
      id: input.importId,
      organizationId: input.organizationId,
      poolId: input.poolId,
      origin: input.origin,
      status: "UPLOADED",
      createdById: input.createdById,
      storagePath,
      fileName: input.fileName.slice(0, 255),
      mimeType: DOCUMENT_MIME[kind],
      fileSize: stored.byteLength,
    },
  });
  return { importId: input.importId };
```

`runExtraction` — add the options type above it and change the signature:

```ts
export interface ExtractionOptions {
  /** Cap on OCR pages (public uploads: lower than the operator default). */
  maxOcrPages?: number;
  /** Free pre-LLM check; false → FAILED NOT_A_CV and no LLM call. */
  textGate?: (text: string) => boolean;
  /** isCv=false → FAILED NOT_A_CV (public) instead of a READY warning (operator). */
  rejectNonCv?: boolean;
}

export async function runExtraction(importId: string, opts: ExtractionOptions = {}): Promise<void> {
```

Inside the `try`, replace from `const extracted = …` to the `await finish({ status: "READY", … })` call with:

```ts
    const extracted = await extractDocumentText(bytes, kind, { maxOcrPages: opts.maxOcrPages });
    // Postgres text/jsonb reject NUL, which unpdf can emit.
    const text = extracted.text.replace(/\u0000/g, "");
    if (opts.textGate && !opts.textGate(text)) {
      await finish({ status: "FAILED", errorCode: "NOT_A_CV" });
      return;
    }
    const draft = await extractCandidateDraft(text);
    if (!draft.isCv && opts.rejectNonCv) {
      await finish({ status: "FAILED", errorCode: "NOT_A_CV" });
      return;
    }
    await finish({
      status: "READY",
      extractedText: text,
      extractionMethod: extracted.method,
      draft: draft as unknown as Prisma.InputJsonValue,
      errorCode: draft.isCv ? null : "NOT_A_CV",
    });
```

Update existing assertions in `service.test.ts` that check `extractDocumentText` was called with `(bytes, kind)` to `(bytes, kind, { maxOcrPages: undefined })`.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run src/__tests__/lib/candidate-imports/service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/candidate-imports/service.ts src/__tests__/lib/candidate-imports/service.test.ts
git commit -m "feat(candidate-imports): opt-in public upload and extraction options"
```

---

### Task 9: Generalized `confirmImport` (landing channel, consent, attach to existing)

**Files:**
- Modify: `src/lib/candidates/dashboard-create.ts`
- Modify: `src/lib/candidate-imports/service.ts`
- Test: `src/__tests__/lib/candidates/dashboard-create.test.ts`, `src/__tests__/lib/candidate-imports/service.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/lib/candidates/dashboard-create.test.ts` (reuse its `POOL`/fields fixtures; if absent use the ones below):

```ts
describe("buildDashboardCandidateInput for the public landing", () => {
  const pool = { id: "p", isGlobal: false, globalSharing: "WEBHOOK" as const };
  const fields = { firstName: "Ahmed", lastName: "Benali" } as never;

  it("uses a landing: externalId and the landing channel", () => {
    const data = buildDashboardCandidateInput({ pool, fields, channel: "landing_cv", rawPayload: {} });
    expect(data.externalId).toMatch(/^landing:[0-9a-f-]{36}$/);
    expect(data.channel).toBe("landing_cv");
  });

  it("shares with global only on consent when the pool is consent-driven", () => {
    expect(
      buildDashboardCandidateInput({ pool, fields, channel: "landing_cv", rawPayload: {}, consentToShare: true })
        .sharedWithGlobal,
    ).toBe(true);
    expect(
      buildDashboardCandidateInput({ pool, fields, channel: "landing_cv", rawPayload: {} }).sharedWithGlobal,
    ).toBe(false);
  });

  it("keeps dashboard: ids for operator channels", () => {
    const data = buildDashboardCandidateInput({ pool, fields, channel: "dashboard_cv", rawPayload: {} });
    expect(data.externalId).toMatch(/^dashboard:/);
  });
});
```

In `src/__tests__/lib/candidate-imports/service.test.ts`:

1. Change the `tx` mock at the top to:

```ts
const tx = {
  candidateImport: { findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  candidateDocument: { create: vi.fn() },
  candidate: { findMany: vi.fn() },
};
```

2. Add `vi.mock("@/lib/candidates/duplicates", () => ({ findCandidateIdBySamePhone: vi.fn() }));` and `import { findCandidateIdBySamePhone } from "@/lib/candidates/duplicates";`.

3. The return value gains `attached`. In the `confirmImport` describe, replace
   `expect(r).toEqual({ candidateId: "c-1" });` → `expect(r).toEqual({ candidateId: "c-1", attached: false });`,
   `expect(r).toEqual({ candidateId: "c-2" });` → `expect(r).toEqual({ candidateId: "c-2", attached: false });`,
   `expect(r).toEqual({ candidateId: "c-9" });` → `expect(r).toEqual({ candidateId: "c-9", attached: false });`.

4. Append inside `describe("confirmImport", …)`:

```ts
  it("public mode attaches the CV to the same-phone candidate of the pool", async () => {
    tx.candidateImport.findFirst.mockResolvedValueOnce({ ...IMPORT, createdById: null });
    tx.candidateImport.updateMany.mockResolvedValueOnce({ count: 1 });
    m(findCandidateIdBySamePhone).mockResolvedValueOnce("c-existing");

    const r = await confirmImport({
      importId: IMPORT.id, organizationId: "o", userId: null,
      fields: { ...FIELDS, phone: "+39 333 1234567" } as never,
      channel: "landing_cv", attachToExistingByPhone: true,
    });

    expect(r).toEqual({ candidateId: "c-existing", attached: true });
    expect(m(findCandidateIdBySamePhone)).toHaveBeenCalledWith(tx, "p", "+39 333 1234567");
    expect(m(upsertCandidate)).not.toHaveBeenCalled();
    expect(tx.candidateDocument.create.mock.calls[0]![0].data).toMatchObject({
      candidateId: "c-existing", kind: "CV", uploadedById: null,
    });
    expect(tx.candidateImport.update.mock.calls[0]![0].data).toMatchObject({ candidateId: "c-existing" });
    expect(m(refreshCandidateEmbedding)).not.toHaveBeenCalled();
  });

  it("public mode creates a landing candidate when no phone matches", async () => {
    tx.candidateImport.findFirst.mockResolvedValueOnce({ ...IMPORT, createdById: null });
    tx.candidateImport.updateMany.mockResolvedValueOnce({ count: 1 });
    m(findCandidateIdBySamePhone).mockResolvedValueOnce(null);
    m(upsertCandidate).mockResolvedValueOnce({ id: "c-new" });

    const r = await confirmImport({
      importId: IMPORT.id, organizationId: "o", userId: null,
      fields: { ...FIELDS, phone: "+39 333 1234567" } as never,
      channel: "landing_cv", consentToShare: true, attachToExistingByPhone: true,
      rawPayloadExtra: { landingPageId: "l-1", consent: { acceptedAt: "t" } },
    });

    expect(r).toEqual({ candidateId: "c-new", attached: false });
    const [data] = m(upsertCandidate).mock.calls[0]!;
    expect(data.channel).toBe("landing_cv");
    expect(data.externalId).toMatch(/^landing:/);
    expect(data.sharedWithGlobal).toBe(true);
    expect(data.rawPayload).toMatchObject({
      mode: "landing_cv", createdById: null, landingPageId: "l-1", consent: { acceptedAt: "t" },
    });
  });

  it("operator mode never looks up phones", async () => {
    tx.candidateImport.findFirst.mockResolvedValueOnce(IMPORT);
    tx.candidateImport.updateMany.mockResolvedValueOnce({ count: 1 });
    m(upsertCandidate).mockResolvedValueOnce({ id: "c-1" });
    await confirmImport({ importId: IMPORT.id, organizationId: "o", userId: "u", fields: FIELDS });
    expect(m(findCandidateIdBySamePhone)).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/__tests__/lib/candidates/dashboard-create.test.ts src/__tests__/lib/candidate-imports/service.test.ts`
Expected: FAIL on the new tests and on the updated `attached: false` expectations.

- [ ] **Step 3: Implement `dashboard-create.ts`**

```ts
export type DashboardChannel = "dashboard_form" | "dashboard_cv";
/** Every channel that creates candidates from inside the app (not a webhook). */
export type CandidateCreateChannel = DashboardChannel | "landing_cv";
```

Replace `buildDashboardCandidateInput` with:

```ts
/**
 * Map form fields to a Candidate row for an in-app created candidate
 * (operator form/CV, or the public landing). `externalId` is synthetic
 * ("dashboard:<uuid>" / "landing:<uuid>") so it never collides with Make keys
 * or assessment phones. Sharing follows the pool's globalSharing mode with the
 * candidate's own consent — only the public landing collects one.
 */
export function buildDashboardCandidateInput(args: {
  pool: PoolRef;
  fields: CandidateFields;
  channel: CandidateCreateChannel;
  rawPayload: Prisma.InputJsonValue;
  consentToShare?: boolean;
}): Prisma.CandidateUncheckedCreateInput {
  const { pool, fields } = args;
  const coords = geocodeFromAddress(fields.location) ?? geocodeFromAddress(fields.address);
  const idPrefix = args.channel === "landing_cv" ? "landing" : "dashboard";

  return {
    ...fields,
    externalId: `${idPrefix}:${randomUUID()}`,
    poolId: pool.id,
    latitude: coords?.latitude ?? null,
    longitude: coords?.longitude ?? null,
    channel: args.channel,
    sharedWithGlobal: resolveSharedWithGlobal(pool, args.consentToShare === true),
    rawPayload: args.rawPayload,
  };
}
```

- [ ] **Step 4: Implement `confirmImport`**

In `service.ts` add imports:

```ts
import {
  buildDashboardCandidateInput,
  type CandidateCreateChannel,
} from "@/lib/candidates/dashboard-create";
import { findCandidateIdBySamePhone } from "@/lib/candidates/duplicates";
```

(replace the existing single-name `buildDashboardCandidateInput` import).

Replace `ConfirmImportInput` and `confirmImport` with:

```ts
export interface ConfirmImportInput {
  importId: string;
  organizationId: string;
  /** Null for public-landing imports (no logged-in uploader). */
  userId: string | null;
  fields: CandidateFields;
  channel?: Extract<CandidateCreateChannel, "dashboard_cv" | "landing_cv">;
  /** The candidate's own consent to global sharing (public landing only). */
  consentToShare?: boolean;
  /** Merged into the candidate's rawPayload (landing id, consent record). */
  rawPayloadExtra?: Record<string, unknown>;
  /**
   * Public landing: when a candidate of the import's pool has the same
   * normalized phone, attach the CV to it instead of creating a new row. The
   * existing profile is never modified. Never looks outside the pool.
   */
  attachToExistingByPhone?: boolean;
}

export interface ConfirmImportResult {
  candidateId: string;
  /** True when the CV was attached to an existing candidate. */
  attached: boolean;
}

/**
 * Create the candidate from a READY import (or a FAILED one filled in by
 * hand) — or attach the CV to an existing same-phone candidate — atomically.
 * Idempotent: confirming a COMPLETED import returns its candidate. Throws
 * ImportNotFoundError (wrong org / id) or ImportStateError (discarded, or lost
 * a concurrent confirm).
 */
export async function confirmImport(input: ConfirmImportInput): Promise<ConfirmImportResult> {
  const channel = input.channel ?? "dashboard_cv";
  const result = await prisma.$transaction(async (tx) => {
    const imp = await tx.candidateImport.findFirst({
      where: { id: input.importId, organizationId: input.organizationId },
      include: { pool: true },
    });
    if (!imp) throw new ImportNotFoundError();
    if (imp.status === "COMPLETED" && imp.candidateId) {
      return { candidateId: imp.candidateId, row: null, attached: false };
    }

    const claimed = await tx.candidateImport.updateMany({
      where: {
        id: imp.id,
        OR: [
          { status: { in: ["READY", "FAILED"] } },
          // A stuck extraction may be filled in by hand (review page ?manual=1).
          { status: "EXTRACTING", updatedAt: { lt: new Date(Date.now() - STALE_EXTRACTION_MS) } },
        ],
      },
      data: { status: "COMPLETED" },
    });
    if (claimed.count === 0) throw new ImportStateError(imp.status);

    const document = {
      kind: "CV" as const,
      storagePath: imp.storagePath,
      fileName: imp.fileName,
      mimeType: imp.mimeType,
      size: imp.fileSize,
      uploadedById: imp.createdById,
    };
    const closeImport = (candidateId: string) =>
      tx.candidateImport.update({
        where: { id: imp.id },
        data: { candidateId, extractedText: null, draft: Prisma.DbNull },
      });

    if (input.attachToExistingByPhone) {
      const existingId = await findCandidateIdBySamePhone(tx, imp.poolId, input.fields.phone);
      if (existingId) {
        await tx.candidateDocument.create({ data: { candidateId: existingId, ...document } });
        await closeImport(existingId);
        return { candidateId: existingId, row: null, attached: true };
      }
    }

    const row = await upsertCandidate(
      buildDashboardCandidateInput({
        pool: imp.pool,
        fields: input.fields,
        channel,
        consentToShare: input.consentToShare,
        rawPayload: {
          mode: channel === "landing_cv" ? "landing_cv" : "cv",
          importId: imp.id,
          createdById: input.userId,
          draft: imp.draft,
          submitted: input.fields,
          ...input.rawPayloadExtra,
        } as unknown as Prisma.InputJsonValue,
      }),
      tx,
    );

    await tx.candidateDocument.create({ data: { candidateId: row.id, ...document } });
    await closeImport(row.id);
    return { candidateId: row.id, row, attached: false };
  });

  if (result.row) await refreshCandidateEmbedding(result.row, "candidate import");
  return { candidateId: result.candidateId, attached: result.attached };
}
```

The operator action `confirmCandidateImportAction` destructures `{ candidateId }` and passes `userId: user.id` — it compiles unchanged.

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm exec vitest run src/__tests__/lib/candidates/ src/__tests__/lib/candidate-imports/ src/__tests__/app/dashboard/candidates/ && pnpm exec tsc --noEmit -p .`
Expected: PASS; tsc exits 0. The existing test asserting `tx.candidateDocument.create.mock.calls[0]![0].data` with `toMatchObject` still passes (same keys).

- [ ] **Step 6: Commit**

```bash
git add src/lib/candidates/dashboard-create.ts src/lib/candidate-imports/service.ts src/__tests__/lib/candidates/dashboard-create.test.ts src/__tests__/lib/candidate-imports/service.test.ts
git commit -m "feat(candidate-imports): confirm public imports, attach CV to same-phone candidate"
```

---

### Task 10: 24 h cleanup for public imports and `getPublicImport`

**Files:**
- Modify: `src/lib/candidate-imports/service.ts`
- Test: `src/__tests__/lib/candidate-imports/service.test.ts`

- [ ] **Step 1: Update and add tests**

In the test `"discards stale open imports older than 7 days"`, replace

```ts
    const where = m(prisma.candidateImport.findMany).mock.calls[0]![0].where;
    expect(where.updatedAt.lt).toEqual(new Date("2026-10-16T03:00:00Z"));
```

with

```ts
    const where = m(prisma.candidateImport.findMany).mock.calls[0]![0].where;
    expect(where).toEqual({
      status: { in: ["UPLOADED", "EXTRACTING", "READY", "FAILED"] },
      OR: [
        { updatedAt: { lt: new Date("2026-10-16T03:00:00Z") } },
        { origin: "PUBLIC_LINK", updatedAt: { lt: new Date("2026-10-22T03:00:00Z") } },
      ],
    });
```

Append:

```ts
describe("getPublicImport", () => {
  beforeEach(() => vi.clearAllMocks());

  it("scopes by pool and PUBLIC_LINK origin", async () => {
    m(prisma.candidateImport.findFirst).mockResolvedValueOnce({ id: IMPORT_ID });
    await getPublicImport(IMPORT_ID, "p");
    expect(m(prisma.candidateImport.findFirst).mock.calls[0]![0]).toEqual({
      where: { id: IMPORT_ID, poolId: "p", origin: "PUBLIC_LINK" },
      select: { id: true, status: true, errorCode: true, draft: true },
    });
  });

  it("returns null for a non-UUID id", async () => {
    await expect(getPublicImport("x", "p")).resolves.toBeNull();
    expect(m(prisma.candidateImport.findFirst)).not.toHaveBeenCalled();
  });
});
```

Add `getPublicImport` to the import list from `@/lib/candidate-imports/service`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run src/__tests__/lib/candidate-imports/service.test.ts`
Expected: FAIL (where shape; missing export).

- [ ] **Step 3: Implement**

In `service.ts`, below `STALE_IMPORT_MS`:

```ts
/** Public uploads without consent must not linger: discard after 24 h. */
const STALE_PUBLIC_IMPORT_MS = 24 * 60 * 60 * 1000;
```

In `discardStaleImports`, replace the first query's `where` with:

```ts
    where: {
      status: { in: [...OPEN_STATUSES] },
      OR: [
        { updatedAt: { lt: new Date(now.getTime() - STALE_IMPORT_MS) } },
        { origin: "PUBLIC_LINK", updatedAt: { lt: new Date(now.getTime() - STALE_PUBLIC_IMPORT_MS) } },
      ],
    },
```

and update its doc comment's first line to: `Nightly cleanup: discard open imports untouched for 7 days (24 h for public uploads) and delete their files …`.

Append:

```ts
/** A public-landing import, scoped to the landing's pool. */
export async function getPublicImport(importId: string, poolId: string) {
  if (!isUuid(importId)) return null;
  return prisma.candidateImport.findFirst({
    where: { id: importId, poolId, origin: "PUBLIC_LINK" },
    select: { id: true, status: true, errorCode: true, draft: true },
  });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run src/__tests__/lib/candidate-imports/service.test.ts src/__tests__/app/api/cron/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/candidate-imports/service.ts src/__tests__/lib/candidate-imports/service.test.ts
git commit -m "feat(candidate-imports): 24h cleanup for public uploads, getPublicImport"
```

---

### Task 11: Rate limiter

**Files:**
- Create: `src/lib/rate-limit/index.ts`
- Test: `src/__tests__/lib/rate-limit/index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  consumeRateLimits,
  RateLimitUnavailableError,
  _setCounterForTests,
  type Counter,
} from "@/lib/rate-limit";

function memoryCounter(): Counter & { store: Map<string, number> } {
  const store = new Map<string, number>();
  return {
    store,
    incr: vi.fn(async (k: string) => {
      const n = (store.get(k) ?? 0) + 1;
      store.set(k, n);
      return n;
    }),
    expire: vi.fn(async () => 1),
  };
}

describe("consumeRateLimits", () => {
  const NOW = new Date("2026-10-29T10:15:00Z").getTime();
  afterEach(() => _setCounterForTests(undefined));

  it("allows up to the limit within a window, then refuses", async () => {
    const c = memoryCounter();
    _setCounterForTests(c);
    const rule = { key: "ip:abc", limit: 2, windowSec: 3600 };
    await expect(consumeRateLimits([rule], NOW)).resolves.toBe(true);
    await expect(consumeRateLimits([rule], NOW)).resolves.toBe(true);
    await expect(consumeRateLimits([rule], NOW)).resolves.toBe(false);
  });

  it("starts a fresh count in the next window and sets a TTL", async () => {
    const c = memoryCounter();
    _setCounterForTests(c);
    const rule = { key: "ip:abc", limit: 1, windowSec: 3600 };
    await consumeRateLimits([rule], NOW);
    await expect(consumeRateLimits([rule], NOW + 3600 * 1000)).resolves.toBe(true);
    expect(c.expire).toHaveBeenCalledWith(expect.stringMatching(/^rl:ip:abc:\d+$/), 3600);
  });

  it("refuses when any rule is exceeded", async () => {
    _setCounterForTests(memoryCounter());
    const tight = { key: "a", limit: 0, windowSec: 60 };
    const loose = { key: "b", limit: 10, windowSec: 60 };
    await expect(consumeRateLimits([loose, tight], NOW)).resolves.toBe(false);
  });

  it("throws RateLimitUnavailableError when the counter fails", async () => {
    _setCounterForTests({ incr: vi.fn().mockRejectedValue(new Error("down")), expire: vi.fn() });
    await expect(
      consumeRateLimits([{ key: "a", limit: 1, windowSec: 60 }], NOW),
    ).rejects.toBeInstanceOf(RateLimitUnavailableError);
  });

  describe("without Upstash credentials", () => {
    beforeEach(() => {
      vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
      vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
      _setCounterForTests(undefined);
    });
    afterEach(() => vi.unstubAllEnvs());

    it("fails closed in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      await expect(
        consumeRateLimits([{ key: "a", limit: 1, windowSec: 60 }], NOW),
      ).rejects.toBeInstanceOf(RateLimitUnavailableError);
    });

    it("uses an in-memory counter outside production", async () => {
      vi.stubEnv("NODE_ENV", "development");
      await expect(consumeRateLimits([{ key: "dev", limit: 1, windowSec: 60 }], NOW)).resolves.toBe(true);
      await expect(consumeRateLimits([{ key: "dev", limit: 1, windowSec: 60 }], NOW)).resolves.toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run src/__tests__/lib/rate-limit/index.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/lib/rate-limit/index.ts`:

```ts
import { Redis } from "@upstash/redis";

/** Counter store: Upstash in production, in-memory in dev/test. */
export interface Counter {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

export interface RateLimitRule {
  /** Caller-chosen key, e.g. "landing:ip:<hash>:h". Never raw personal data. */
  key: string;
  limit: number;
  windowSec: number;
}

/** The limiter cannot decide: public endpoints must refuse (fail closed). */
export class RateLimitUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("rate limiter unavailable", { cause });
    this.name = "RateLimitUnavailableError";
  }
}

class MemoryCounter implements Counter {
  private counts = new Map<string, number>();
  async incr(key: string): Promise<number> {
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    return n;
  }
  async expire(): Promise<number> {
    return 1;
  }
}

let counter: Counter | null | undefined;

/** Null in production without Upstash credentials: callers fail closed. */
function getCounter(): Counter | null {
  if (counter !== undefined) return counter;
  const url = process.env["UPSTASH_REDIS_REST_URL"];
  const token = process.env["UPSTASH_REDIS_REST_TOKEN"];
  if (url && token) counter = new Redis({ url, token });
  else counter = process.env["NODE_ENV"] === "production" ? null : new MemoryCounter();
  return counter;
}

/**
 * Count one hit against every rule (fixed windows) and report whether all are
 * still within their limit. Every rule is incremented even when an earlier one
 * is exceeded, so attempts keep counting. Throws RateLimitUnavailableError when
 * no counter is configured in production or the store errors.
 */
export async function consumeRateLimits(rules: RateLimitRule[], now = Date.now()): Promise<boolean> {
  const store = getCounter();
  if (!store) throw new RateLimitUnavailableError();
  try {
    const results = await Promise.all(
      rules.map(async (rule) => {
        const windowIndex = Math.floor(now / (rule.windowSec * 1000));
        const key = `rl:${rule.key}:${windowIndex}`;
        const count = await store.incr(key);
        if (count === 1) await store.expire(key, rule.windowSec);
        return count <= rule.limit;
      }),
    );
    return results.every(Boolean);
  } catch (e) {
    throw new RateLimitUnavailableError(e);
  }
}

/** Test-only: inject a counter, or `undefined` to re-read the environment. */
export function _setCounterForTests(c: Counter | undefined): void {
  counter = c;
}
```

Note: the test "sets a TTL" expects `expire` on the **first** hit of a window; with `count === 1` that holds for the new window key.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run src/__tests__/lib/rate-limit/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rate-limit src/__tests__/lib/rate-limit
git commit -m "feat(rate-limit): fixed-window limiter on Upstash, fail-closed in production"
```

---

### Task 12: Turnstile verification

**Files:**
- Create: `src/lib/landing/turnstile.ts`
- Test: `src/__tests__/lib/landing/turnstile.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { verifyTurnstile } from "@/lib/landing/turnstile";

describe("verifyTurnstile", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("posts secret, token and ip and returns success", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "sec");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(verifyTurnstile("tok", "1.2.3.4")).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const body = init.body as URLSearchParams;
    expect(body.get("secret")).toBe("sec");
    expect(body.get("response")).toBe("tok");
    expect(body.get("remoteip")).toBe("1.2.3.4");
  });

  it("returns false on success=false, HTTP error, network error or empty token", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "sec");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false }))));
    await expect(verifyTurnstile("tok", null)).resolves.toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x", { status: 500 })));
    await expect(verifyTurnstile("tok", null)).resolves.toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    await expect(verifyTurnstile("tok", null)).resolves.toBe(false);
    await expect(verifyTurnstile("", null)).resolves.toBe(false);
  });

  it("without a secret: refuses in production, allows in development", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    await expect(verifyTurnstile("tok", null)).resolves.toBe(false);
    vi.stubEnv("NODE_ENV", "development");
    await expect(verifyTurnstile("", null)).resolves.toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run src/__tests__/lib/landing/turnstile.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/lib/landing/turnstile.ts`:

```ts
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 5000;

/**
 * Server-side check of a Cloudflare Turnstile token. Without
 * TURNSTILE_SECRET_KEY it refuses in production and allows everything in
 * development (no Cloudflare account needed locally). Never throws.
 */
export async function verifyTurnstile(token: string, ip: string | null): Promise<boolean> {
  const secret = process.env["TURNSTILE_SECRET_KEY"];
  if (!secret) return process.env["NODE_ENV"] !== "production";
  if (!token) return false;

  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);
  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: unknown };
    return data.success === true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run src/__tests__/lib/landing/turnstile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/landing/turnstile.ts src/__tests__/lib/landing/turnstile.test.ts
git commit -m "feat(landing): Turnstile server-side verification"
```

---

### Task 13: Signed import cookie and IP hash

**Files:**
- Create: `src/lib/landing/import-cookie.ts`
- Test: `src/__tests__/lib/landing/import-cookie.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  hashIp,
  LANDING_COOKIE_TTL_SEC,
  signImportCookie,
  verifyImportCookie,
} from "@/lib/landing/import-cookie";

const IMPORT_ID = "22222222-2222-4222-8222-222222222222";
const LANDING_ID = "33333333-3333-4333-8333-333333333333";
const NOW = 1_800_000_000_000;

describe("import cookie", () => {
  beforeEach(() => vi.stubEnv("LANDING_COOKIE_SECRET", "s".repeat(32)));
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips import and landing ids", () => {
    const v = signImportCookie({ importId: IMPORT_ID, landingId: LANDING_ID }, NOW);
    expect(verifyImportCookie(v, NOW + 1000)).toEqual({ importId: IMPORT_ID, landingId: LANDING_ID });
  });

  it("rejects an expired cookie", () => {
    const v = signImportCookie({ importId: IMPORT_ID, landingId: LANDING_ID }, NOW);
    expect(verifyImportCookie(v, NOW + (LANDING_COOKIE_TTL_SEC + 1) * 1000)).toBeNull();
  });

  it("rejects a tampered import id or signature", () => {
    const v = signImportCookie({ importId: IMPORT_ID, landingId: LANDING_ID }, NOW);
    const other = "44444444-4444-4444-8444-444444444444";
    expect(verifyImportCookie(v.replace(IMPORT_ID, other), NOW)).toBeNull();
    expect(verifyImportCookie(`${v.slice(0, -2)}xx`, NOW)).toBeNull();
  });

  it("rejects garbage and missing values", () => {
    expect(verifyImportCookie(undefined, NOW)).toBeNull();
    expect(verifyImportCookie("a.b.c", NOW)).toBeNull();
    expect(verifyImportCookie("not-a-uuid.x.1.sig", NOW)).toBeNull();
  });

  it("rejects a cookie signed with another secret", () => {
    const v = signImportCookie({ importId: IMPORT_ID, landingId: LANDING_ID }, NOW);
    vi.stubEnv("LANDING_COOKIE_SECRET", "t".repeat(32));
    expect(verifyImportCookie(v, NOW)).toBeNull();
  });

  it("refuses to sign with a missing or short secret", () => {
    vi.stubEnv("LANDING_COOKIE_SECRET", "short");
    expect(() => signImportCookie({ importId: IMPORT_ID, landingId: LANDING_ID }, NOW)).toThrow();
  });
});

describe("hashIp", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is stable, salted and never contains the IP", () => {
    vi.stubEnv("LANDING_IP_SALT", "salt-a");
    const a = hashIp("1.2.3.4");
    expect(a).toBe(hashIp("1.2.3.4"));
    expect(a).not.toContain("1.2.3.4");
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    vi.stubEnv("LANDING_IP_SALT", "salt-b");
    expect(hashIp("1.2.3.4")).not.toBe(a);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run src/__tests__/lib/landing/import-cookie.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/lib/landing/import-cookie.ts`:

```ts
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const LANDING_COOKIE_NAME = "kubri_landing_import";
export const LANDING_COOKIE_TTL_SEC = 30 * 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ImportBinding {
  importId: string;
  landingId: string;
}

function secret(): string {
  const s = process.env["LANDING_COOKIE_SECRET"];
  if (!s || s.length < 32) throw new Error("LANDING_COOKIE_SECRET must be set (32+ chars)");
  return s;
}

function mac(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/**
 * Cookie value binding one public import to the browser that started it:
 * `<importId>.<landingId>.<expSeconds>.<hmac>`. Public actions accept an
 * import id only from a valid cookie, never from the request body.
 */
export function signImportCookie(binding: ImportBinding, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + LANDING_COOKIE_TTL_SEC;
  const payload = `${binding.importId}.${binding.landingId}.${exp}`;
  return `${payload}.${mac(payload)}`;
}

export function verifyImportCookie(value: string | undefined, now = Date.now()): ImportBinding | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [importId, landingId, expStr, sig] = parts as [string, string, string, string];
  if (!UUID_RE.test(importId) || !UUID_RE.test(landingId)) return null;
  const exp = Number(expStr);
  if (!Number.isInteger(exp) || exp * 1000 < now) return null;

  let expected: string;
  try {
    expected = mac(`${importId}.${landingId}.${expStr}`);
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { importId, landingId };
}

/** Salted, truncated SHA-256 of the client IP: for rate-limit keys and audit, never the raw IP. */
export function hashIp(ip: string | null): string {
  const salt = process.env["LANDING_IP_SALT"] ?? "";
  return createHash("sha256").update(`${salt}:${ip ?? "unknown"}`).digest("hex").slice(0, 32);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run src/__tests__/lib/landing/import-cookie.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/landing/import-cookie.ts src/__tests__/lib/landing/import-cookie.test.ts
git commit -m "feat(landing): signed import binding cookie and salted IP hash"
```

---

### Task 14: Landing page validation and service

**Files:**
- Create: `src/lib/validations/landing-page.ts`
- Create: `src/lib/landing/service.ts`
- Test: `src/__tests__/lib/landing/service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    candidateLandingPage: { findUnique: vi.fn(), upsert: vi.fn() },
    organizationPool: { findUnique: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { getActiveLandingBySlug, getLandingForOrg, saveLandingPage } from "@/lib/landing/service";
import { landingPageInputSchema } from "@/lib/validations/landing-page";

const m = <T>(f: T) => f as unknown as ReturnType<typeof vi.fn>;
const POOL_ID = "11111111-1111-4111-8111-111111111111";
const ROW = {
  id: "l-1", slug: "coop-sole", enabled: true, privacyPolicyUrl: "https://x.it/privacy",
  organizationId: "o-1", poolId: POOL_ID,
  organization: { id: "o-1", name: "Coop Sole" },
  pool: { id: POOL_ID, isGlobal: false, globalSharing: "WEBHOOK", externalKey: "SOLE", slug: "sole" },
};

describe("landingPageInputSchema", () => {
  const ok = { slug: "Coop-Sole", poolId: POOL_ID, privacyPolicyUrl: "https://x.it/p", enabled: true };
  it("lowercases the slug", () => {
    expect(landingPageInputSchema.parse(ok).slug).toBe("coop-sole");
  });
  it.each(["a", "-coop", "coop-", "coop sole", "coop_sole", "x".repeat(61)])("rejects slug %s", (slug) => {
    expect(landingPageInputSchema.safeParse({ ...ok, slug }).success).toBe(false);
  });
  it("requires an https privacy URL", () => {
    expect(landingPageInputSchema.safeParse({ ...ok, privacyPolicyUrl: "http://x.it" }).success).toBe(false);
  });
});

describe("getActiveLandingBySlug", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the landing when enabled, pool non-global and still linked", async () => {
    m(prisma.candidateLandingPage.findUnique).mockResolvedValueOnce(ROW);
    m(prisma.organizationPool.findUnique).mockResolvedValueOnce({ poolId: POOL_ID });
    const l = await getActiveLandingBySlug("coop-sole");
    expect(l).toMatchObject({ id: "l-1", organization: { name: "Coop Sole" }, pool: { id: POOL_ID } });
    expect(m(prisma.organizationPool.findUnique).mock.calls[0]![0].where).toEqual({
      organizationId_poolId: { organizationId: "o-1", poolId: POOL_ID },
    });
  });

  it.each([
    ["disabled", { ...ROW, enabled: false }],
    ["global pool", { ...ROW, pool: { ...ROW.pool, isGlobal: true } }],
  ])("returns null when %s", async (_, row) => {
    m(prisma.candidateLandingPage.findUnique).mockResolvedValueOnce(row);
    m(prisma.organizationPool.findUnique).mockResolvedValueOnce({ poolId: POOL_ID });
    await expect(getActiveLandingBySlug("coop-sole")).resolves.toBeNull();
  });

  it("returns null when the pool was detached from the organization", async () => {
    m(prisma.candidateLandingPage.findUnique).mockResolvedValueOnce(ROW);
    m(prisma.organizationPool.findUnique).mockResolvedValueOnce(null);
    await expect(getActiveLandingBySlug("coop-sole")).resolves.toBeNull();
  });

  it("does not query for an invalid slug", async () => {
    await expect(getActiveLandingBySlug("../etc")).resolves.toBeNull();
    expect(m(prisma.candidateLandingPage.findUnique)).not.toHaveBeenCalled();
  });
});

describe("saveLandingPage", () => {
  const input = { slug: "coop-sole", poolId: POOL_ID, privacyPolicyUrl: "https://x.it/p", enabled: true };
  beforeEach(() => vi.clearAllMocks());

  it("rejects a pool not linked to the organization", async () => {
    m(prisma.organizationPool.findUnique).mockResolvedValueOnce(null);
    await expect(saveLandingPage("o-1", input)).resolves.toEqual({ ok: false, error: "INVALID_POOL" });
    expect(m(prisma.candidateLandingPage.upsert)).not.toHaveBeenCalled();
  });

  it("rejects a global pool", async () => {
    m(prisma.organizationPool.findUnique).mockResolvedValueOnce({ pool: { isGlobal: true } });
    await expect(saveLandingPage("o-1", input)).resolves.toEqual({ ok: false, error: "INVALID_POOL" });
  });

  it("upserts by organization", async () => {
    m(prisma.organizationPool.findUnique).mockResolvedValueOnce({ pool: { isGlobal: false } });
    m(prisma.candidateLandingPage.upsert).mockResolvedValueOnce({ id: "l-1" });
    await expect(saveLandingPage("o-1", input)).resolves.toEqual({ ok: true, id: "l-1" });
    const args = m(prisma.candidateLandingPage.upsert).mock.calls[0]![0];
    expect(args.where).toEqual({ organizationId: "o-1" });
    expect(args.create).toEqual({ organizationId: "o-1", ...input });
    expect(args.update).toEqual(input);
  });

  it("maps a slug unique violation to SLUG_TAKEN", async () => {
    m(prisma.organizationPool.findUnique).mockResolvedValueOnce({ pool: { isGlobal: false } });
    m(prisma.candidateLandingPage.upsert).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x", meta: { target: ["slug"] } }),
    );
    await expect(saveLandingPage("o-1", input)).resolves.toEqual({ ok: false, error: "SLUG_TAKEN" });
  });
});

describe("getLandingForOrg", () => {
  it("looks up by organization", async () => {
    m(prisma.candidateLandingPage.findUnique).mockResolvedValueOnce(null);
    await getLandingForOrg("o-1");
    expect(m(prisma.candidateLandingPage.findUnique).mock.calls.at(-1)![0].where).toEqual({ organizationId: "o-1" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run src/__tests__/lib/landing/service.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement validation**

`src/lib/validations/landing-page.ts`:

```ts
import { z } from "zod/v4";

/** 3–60 chars, lowercase letters, digits and inner dashes. */
export const LANDING_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;

export const landingPageInputSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(LANDING_SLUG_RE),
  poolId: z.string().uuid(),
  privacyPolicyUrl: z
    .url()
    .max(500)
    .refine((u) => u.startsWith("https://")),
  enabled: z.boolean(),
});

export type LandingPageInput = z.output<typeof landingPageInputSchema>;
```

- [ ] **Step 4: Implement the service**

`src/lib/landing/service.ts`:

```ts
import { prisma } from "@/lib/db";
import { Prisma, type GlobalSharingMode } from "@/generated/prisma/client";
import { LANDING_SLUG_RE, type LandingPageInput } from "@/lib/validations/landing-page";

export interface ActiveLanding {
  id: string;
  slug: string;
  privacyPolicyUrl: string;
  organization: { id: string; name: string };
  pool: {
    id: string;
    isGlobal: boolean;
    globalSharing: GlobalSharingMode;
    externalKey: string | null;
    slug: string;
  };
}

/**
 * The landing behind /candidati/<slug>, or null (→ 404) when unknown,
 * disabled, pointing at a global pool, or its pool is no longer linked to the
 * organization. Checked on every public request, not only on save.
 */
export async function getActiveLandingBySlug(slug: string): Promise<ActiveLanding | null> {
  if (!LANDING_SLUG_RE.test(slug)) return null;
  const row = await prisma.candidateLandingPage.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      enabled: true,
      privacyPolicyUrl: true,
      organizationId: true,
      poolId: true,
      organization: { select: { id: true, name: true } },
      pool: { select: { id: true, isGlobal: true, globalSharing: true, externalKey: true, slug: true } },
    },
  });
  if (!row || !row.enabled || row.pool.isGlobal) return null;

  const link = await prisma.organizationPool.findUnique({
    where: { organizationId_poolId: { organizationId: row.organizationId, poolId: row.poolId } },
    select: { poolId: true },
  });
  if (!link) return null;

  return {
    id: row.id,
    slug: row.slug,
    privacyPolicyUrl: row.privacyPolicyUrl,
    organization: row.organization,
    pool: row.pool,
  };
}

/** The organization's landing (any state), for the admin card and the QR page. */
export async function getLandingForOrg(organizationId: string) {
  return prisma.candidateLandingPage.findUnique({
    where: { organizationId },
    select: { id: true, slug: true, poolId: true, enabled: true, privacyPolicyUrl: true },
  });
}

export type SaveLandingResult =
  | { ok: true; id: string }
  | { ok: false; error: "INVALID_POOL" | "SLUG_TAKEN" };

/**
 * Create or update the organization's landing. Callers enforce ADMIN_KUBRI
 * and validate with landingPageInputSchema. The pool must be linked to the
 * organization and not global.
 */
export async function saveLandingPage(
  organizationId: string,
  input: LandingPageInput,
): Promise<SaveLandingResult> {
  const link = await prisma.organizationPool.findUnique({
    where: { organizationId_poolId: { organizationId, poolId: input.poolId } },
    select: { pool: { select: { isGlobal: true } } },
  });
  if (!link || link.pool.isGlobal) return { ok: false, error: "INVALID_POOL" };

  try {
    const row = await prisma.candidateLandingPage.upsert({
      where: { organizationId },
      create: { organizationId, ...input },
      update: input,
      select: { id: true },
    });
    return { ok: true, id: row.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "SLUG_TAKEN" };
    }
    throw e;
  }
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm exec vitest run src/__tests__/lib/landing/service.test.ts && pnpm exec tsc --noEmit -p .`
Expected: PASS; tsc exits 0. (`organizationId` is `@unique`, so `where: { organizationId }` is a valid `WhereUniqueInput`.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/validations/landing-page.ts src/lib/landing/service.ts src/__tests__/lib/landing/service.test.ts
git commit -m "feat(landing): landing lookup with invariant checks and admin save"
```

---

### Task 15: Contact schema and draft merge

**Files:**
- Create: `src/lib/landing/contact.ts`
- Test: `src/__tests__/lib/landing/contact.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { emptyCandidateDraftFields } from "@kubri/contracts";
import { contactFromDraft, landingContactSchema, mergeContactIntoDraft } from "@/lib/landing/contact";

const CONTACT = {
  firstName: "Ahmed", lastName: "Benali", phone: "+39 333 1234567",
  email: "", privacyAccepted: true, shareWithGlobal: false,
};

describe("landingContactSchema", () => {
  it("accepts a valid contact and maps an empty email to null", () => {
    expect(landingContactSchema.parse(CONTACT).email).toBeNull();
  });
  it("lowercases the email", () => {
    expect(landingContactSchema.parse({ ...CONTACT, email: " A@B.IT " }).email).toBe("a@b.it");
  });
  it.each([
    ["missing consent", { privacyAccepted: false }],
    ["bad phone", { phone: "12" }],
    ["empty first name", { firstName: " " }],
    ["bad email", { email: "nope" }],
  ])("rejects %s", (_, patch) => {
    expect(landingContactSchema.safeParse({ ...CONTACT, ...patch }).success).toBe(false);
  });
});

describe("contactFromDraft", () => {
  it("reads the four contact fields from a stored draft", () => {
    const draft = {
      isCv: true, uncertain: [],
      fields: { ...emptyCandidateDraftFields(), firstName: "Ahmed", phone: "333 1234567" },
    };
    expect(contactFromDraft(draft)).toEqual({ firstName: "Ahmed", lastName: "", phone: "333 1234567", email: "" });
  });
  it("returns empty values for a malformed draft", () => {
    expect(contactFromDraft({ nope: true })).toEqual({ firstName: "", lastName: "", phone: "", email: "" });
  });
});

describe("mergeContactIntoDraft", () => {
  it("overrides contact fields and keeps the rest of the draft", () => {
    const draft = {
      isCv: true, uncertain: [],
      fields: { ...emptyCandidateDraftFields(), firstName: "A", workExperience: ["Magazziniere, 2020"] },
    };
    const fields = mergeContactIntoDraft(draft, landingContactSchema.parse(CONTACT));
    expect(fields).toMatchObject({
      firstName: "Ahmed", lastName: "Benali", phone: "+39 333 1234567", email: null,
      workExperience: ["Magazziniere, 2020"],
    });
  });

  it("drops draft values the strict schema rejects instead of failing", () => {
    const draft = {
      isCv: true, uncertain: [],
      fields: { ...emptyCandidateDraftFields(), skillsAndCompetences: Array(60).fill("x") },
    };
    const fields = mergeContactIntoDraft(draft, landingContactSchema.parse(CONTACT));
    expect(fields.skillsAndCompetences).toEqual([]);
  });

  it("works with a missing draft", () => {
    const fields = mergeContactIntoDraft(null, landingContactSchema.parse(CONTACT));
    expect(fields.firstName).toBe("Ahmed");
  });
});
```

Check the strict list limit for `skillsAndCompetences` in `packages/contracts/src/candidate/fields.ts` (`LIST_LIMITS.skillsAndCompetences.maxItems` = 50): 60 items exceeds it in the strict schema. The lenient draft schema accepts what the LLM returns as-is; if it also caps at 50, the merge test still exercises the fallback path because the fixture bypasses the draft schema.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run src/__tests__/lib/landing/contact.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/lib/landing/contact.ts`:

```ts
import { z } from "zod/v4";
import {
  candidateDraftSchema,
  candidateFieldsSchema,
  emptyCandidateDraftFields,
  isArrayFieldKey,
  type CandidateDraftFields,
  type CandidateFieldKey,
  type CandidateFields,
} from "@kubri/contracts";
import { normalizePhone } from "@/lib/candidates/phone";

/** What the candidate confirms on the landing (decision: minimal confirmation). */
export const landingContactSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  phone: z
    .string()
    .trim()
    .max(40)
    .refine((p) => normalizePhone(p) !== null),
  email: z
    .string()
    .trim()
    .max(254)
    .transform((s) => (s ? s.toLowerCase() : null))
    .pipe(z.email().nullable()),
  privacyAccepted: z.literal(true),
  shareWithGlobal: z.boolean(),
});
export type LandingContact = z.output<typeof landingContactSchema>;

/** Pre-fill values for the confirmation form. */
export interface ContactPrefill {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
}

function draftFields(draft: unknown): CandidateDraftFields {
  const parsed = candidateDraftSchema.safeParse(draft);
  return parsed.success ? parsed.data.fields : emptyCandidateDraftFields();
}

export function contactFromDraft(draft: unknown): ContactPrefill {
  const f = draftFields(draft);
  return {
    firstName: f.firstName ?? "",
    lastName: f.lastName ?? "",
    phone: f.phone ?? "",
    email: f.email ?? "",
  };
}

/**
 * Full candidate fields: the LLM draft, with the four contact fields replaced
 * by what the candidate confirmed. Draft values the strict schema rejects are
 * cleared rather than failing the confirmation (the candidate cannot fix them).
 */
export function mergeContactIntoDraft(draft: unknown, contact: LandingContact): CandidateFields {
  const merged: Record<string, unknown> = {
    ...draftFields(draft),
    firstName: contact.firstName,
    lastName: contact.lastName,
    phone: contact.phone,
    email: contact.email,
  };
  const parsed = candidateFieldsSchema.safeParse(merged);
  if (parsed.success) return parsed.data;

  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && key in merged) {
      merged[key] = isArrayFieldKey(key as CandidateFieldKey) ? [] : null;
    }
  }
  return candidateFieldsSchema.parse(merged);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run src/__tests__/lib/landing/contact.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/landing/contact.ts src/__tests__/lib/landing/contact.test.ts
git commit -m "feat(landing): contact confirmation schema and draft merge"
```

---

### Task 16: Landing flow orchestration

**Files:**
- Create: `src/lib/landing/flow.ts`
- Test: `src/__tests__/lib/landing/flow.test.ts`

The flow is framework-free (no `next/headers`): Plan 2's server actions read the cookie and IP, call these functions, and set the cookie. Callers have already resolved the landing with `getActiveLandingBySlug`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/landing/turnstile", () => ({ verifyTurnstile: vi.fn() }));
vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return { ...actual, consumeRateLimits: vi.fn() };
});
vi.mock("@/lib/candidate-imports/service", () => ({
  createUploadTicket: vi.fn(),
  registerUpload: vi.fn(),
  runExtraction: vi.fn(),
  getPublicImport: vi.fn(),
  confirmImport: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { verifyTurnstile } from "@/lib/landing/turnstile";
import { consumeRateLimits, RateLimitUnavailableError } from "@/lib/rate-limit";
import {
  confirmImport,
  createUploadTicket,
  getPublicImport,
  registerUpload,
  runExtraction,
} from "@/lib/candidate-imports/service";
import { ImportError } from "@/lib/candidate-imports/errors";
import { emptyCandidateDraftFields } from "@kubri/contracts";
import { logAudit } from "@/lib/audit";
import { passesCvQualityGate } from "@/lib/documents/quality";
import {
  confirmLandingImport,
  PUBLIC_MAX_DOCUMENT_BYTES,
  PUBLIC_MAX_OCR_PAGES,
  registerLandingUpload,
  requestLandingUpload,
  runLandingExtraction,
} from "@/lib/landing/flow";
import type { ActiveLanding } from "@/lib/landing/service";

const m = <T>(f: T) => f as unknown as ReturnType<typeof vi.fn>;
const IMPORT_ID = "22222222-2222-4222-8222-222222222222";
const LANDING: ActiveLanding = {
  id: "33333333-3333-4333-8333-333333333333", slug: "coop-sole", privacyPolicyUrl: "https://x.it/p",
  organization: { id: "o-1", name: "Coop Sole" },
  pool: { id: "p-1", isGlobal: false, globalSharing: "WEBHOOK", externalKey: "SOLE", slug: "sole" },
};
const CTX = { ip: "1.2.3.4", ipHash: "h".repeat(32) };
// A stored draft carries every field (contactFromDraft validates the whole shape).
const DRAFT = {
  isCv: true, uncertain: [],
  fields: { ...emptyCandidateDraftFields(), firstName: "Ahmed", lastName: "Benali", phone: "333 1234567" },
};

describe("requestLandingUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m(verifyTurnstile).mockResolvedValue(true);
    m(consumeRateLimits).mockResolvedValue(true);
    m(createUploadTicket).mockResolvedValue({ importId: IMPORT_ID, storagePath: "p-1/x/cv.pdf", token: "t" });
  });
  const input = { fileName: "cv.pdf", fileSize: 1000, turnstileToken: "tok" };

  it("checks captcha, rate limits, then issues a ticket with the public cap", async () => {
    const r = await requestLandingUpload(LANDING, input, CTX);
    expect(r).toEqual({ ok: true, data: { importId: IMPORT_ID, storagePath: "p-1/x/cv.pdf", token: "t" } });
    expect(m(verifyTurnstile)).toHaveBeenCalledWith("tok", "1.2.3.4");
    const rules = m(consumeRateLimits).mock.calls[0]![0] as { key: string; limit: number }[];
    expect(rules.map((r) => r.key)).toEqual([
      `landing:ip:${CTX.ipHash}:h`, `landing:ip:${CTX.ipHash}:d`, `landing:page:${LANDING.id}:d`,
    ]);
    expect(m(createUploadTicket)).toHaveBeenCalledWith({
      poolId: "p-1", fileName: "cv.pdf", fileSize: 1000, maxBytes: PUBLIC_MAX_DOCUMENT_BYTES,
    });
  });

  it("refuses oversize or empty files before the captcha", async () => {
    await expect(requestLandingUpload(LANDING, { ...input, fileSize: PUBLIC_MAX_DOCUMENT_BYTES + 1 }, CTX))
      .resolves.toEqual({ ok: false, error: "FILE_TOO_LARGE" });
    await expect(requestLandingUpload(LANDING, { ...input, fileSize: 0 }, CTX))
      .resolves.toEqual({ ok: false, error: "UNSUPPORTED_TYPE" });
    expect(m(verifyTurnstile)).not.toHaveBeenCalled();
  });

  it("maps captcha failure, rate limit and limiter outage", async () => {
    m(verifyTurnstile).mockResolvedValueOnce(false);
    await expect(requestLandingUpload(LANDING, input, CTX)).resolves.toEqual({ ok: false, error: "CAPTCHA_FAILED" });
    m(consumeRateLimits).mockResolvedValueOnce(false);
    await expect(requestLandingUpload(LANDING, input, CTX)).resolves.toEqual({ ok: false, error: "RATE_LIMITED" });
    m(consumeRateLimits).mockRejectedValueOnce(new RateLimitUnavailableError());
    await expect(requestLandingUpload(LANDING, input, CTX)).resolves.toEqual({ ok: false, error: "UNAVAILABLE" });
    expect(m(createUploadTicket)).not.toHaveBeenCalled();
  });

  it("rejects invalid input", async () => {
    await expect(requestLandingUpload(LANDING, { fileName: "", fileSize: 10, turnstileToken: "t" }, CTX))
      .resolves.toEqual({ ok: false, error: "VALIDATION" });
  });
});

describe("registerLandingUpload", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registers as PUBLIC_LINK with inspection and the public cap", async () => {
    m(registerUpload).mockResolvedValueOnce({ importId: IMPORT_ID });
    await expect(registerLandingUpload(LANDING, IMPORT_ID, "cv.pdf")).resolves.toEqual({ ok: true, data: null });
    expect(m(registerUpload)).toHaveBeenCalledWith({
      importId: IMPORT_ID, organizationId: "o-1", poolId: "p-1", origin: "PUBLIC_LINK",
      createdById: null, fileName: "cv.pdf", maxBytes: PUBLIC_MAX_DOCUMENT_BYTES, inspect: true,
    });
  });

  it("maps ImportError codes", async () => {
    m(registerUpload).mockRejectedValueOnce(new ImportError("REJECTED_FILE"));
    await expect(registerLandingUpload(LANDING, IMPORT_ID, "cv.pdf")).resolves.toEqual({ ok: false, error: "REJECTED_FILE" });
  });
});

describe("runLandingExtraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m(consumeRateLimits).mockResolvedValue(true);
  });

  it("returns the contact prefill without spending budget when already READY", async () => {
    m(getPublicImport).mockResolvedValueOnce({ id: IMPORT_ID, status: "READY", errorCode: null, draft: DRAFT });
    const r = await runLandingExtraction(LANDING, IMPORT_ID);
    expect(r).toEqual({ ok: true, data: { firstName: "Ahmed", lastName: "Benali", phone: "333 1234567", email: "" } });
    expect(m(consumeRateLimits)).not.toHaveBeenCalled();
    expect(m(runExtraction)).not.toHaveBeenCalled();
  });

  it("spends the global and per-import budget, then extracts with public options", async () => {
    m(getPublicImport)
      .mockResolvedValueOnce({ id: IMPORT_ID, status: "UPLOADED", errorCode: null, draft: null })
      .mockResolvedValueOnce({ id: IMPORT_ID, status: "READY", errorCode: null, draft: DRAFT });
    const r = await runLandingExtraction(LANDING, IMPORT_ID);
    expect(r.ok).toBe(true);
    const rules = m(consumeRateLimits).mock.calls[0]![0] as { key: string }[];
    expect(rules.map((x) => x.key)).toEqual(["landing:extractions:d", `landing:import:${IMPORT_ID}:d`]);
    expect(m(runExtraction)).toHaveBeenCalledWith(IMPORT_ID, {
      maxOcrPages: PUBLIC_MAX_OCR_PAGES, textGate: passesCvQualityGate, rejectNonCv: true,
    });
  });

  it("returns BUDGET_EXHAUSTED without extracting", async () => {
    m(getPublicImport).mockResolvedValueOnce({ id: IMPORT_ID, status: "UPLOADED", errorCode: null, draft: null });
    m(consumeRateLimits).mockResolvedValueOnce(false);
    await expect(runLandingExtraction(LANDING, IMPORT_ID)).resolves.toEqual({ ok: false, error: "BUDGET_EXHAUSTED" });
    expect(m(runExtraction)).not.toHaveBeenCalled();
  });

  it("returns the stored failure code", async () => {
    m(getPublicImport)
      .mockResolvedValueOnce({ id: IMPORT_ID, status: "UPLOADED", errorCode: null, draft: null })
      .mockResolvedValueOnce({ id: IMPORT_ID, status: "FAILED", errorCode: "NOT_A_CV", draft: null });
    await expect(runLandingExtraction(LANDING, IMPORT_ID)).resolves.toEqual({ ok: false, error: "NOT_A_CV" });
  });

  it("returns SESSION_EXPIRED for an unknown or other-landing import", async () => {
    m(getPublicImport).mockResolvedValueOnce(null);
    await expect(runLandingExtraction(LANDING, IMPORT_ID)).resolves.toEqual({ ok: false, error: "SESSION_EXPIRED" });
  });
});

describe("confirmLandingImport", () => {
  const CONTACT = {
    firstName: "Ahmed", lastName: "Benali", phone: "+39 333 1234567", email: "",
    privacyAccepted: true, shareWithGlobal: true,
  };
  beforeEach(() => {
    vi.clearAllMocks();
    m(getPublicImport).mockResolvedValue({ id: IMPORT_ID, status: "READY", errorCode: null, draft: DRAFT });
    m(confirmImport).mockResolvedValue({ candidateId: "c-1", attached: false });
  });

  it("confirms in public mode with consent and audit", async () => {
    const now = new Date("2026-10-29T10:00:00Z");
    await expect(confirmLandingImport(LANDING, IMPORT_ID, CONTACT, CTX, now)).resolves.toEqual({ ok: true, data: null });
    const args = m(confirmImport).mock.calls[0]![0];
    expect(args).toMatchObject({
      importId: IMPORT_ID, organizationId: "o-1", userId: null, channel: "landing_cv",
      consentToShare: true, attachToExistingByPhone: true,
      rawPayloadExtra: {
        landingPageId: LANDING.id,
        consent: {
          privacyPolicyUrl: "https://x.it/p", acceptedAt: "2026-10-29T10:00:00.000Z",
          shareWithGlobal: true, textVersion: "2026-10-29",
        },
      },
    });
    expect(args.fields).toMatchObject({ firstName: "Ahmed", phone: "+39 333 1234567" });
    expect(m(logAudit)).toHaveBeenCalledWith({
      userId: null, organizationId: "o-1", action: "candidate_import.public_confirm",
      resourceType: "candidate_import", resourceId: IMPORT_ID,
      metadata: { candidateId: "c-1", attached: false, ipHash: CTX.ipHash },
    });
  });

  it("ignores the share checkbox when the pool is not consent-driven", async () => {
    await confirmLandingImport({ ...LANDING, pool: { ...LANDING.pool, globalSharing: "NEVER" } }, IMPORT_ID, CONTACT, CTX);
    expect(m(confirmImport).mock.calls[0]![0].consentToShare).toBe(false);
  });

  it("rejects an invalid contact", async () => {
    await expect(confirmLandingImport(LANDING, IMPORT_ID, { ...CONTACT, privacyAccepted: false }, CTX))
      .resolves.toEqual({ ok: false, error: "VALIDATION" });
    expect(m(confirmImport)).not.toHaveBeenCalled();
  });

  it("refuses an import that is not READY", async () => {
    m(getPublicImport).mockResolvedValueOnce({ id: IMPORT_ID, status: "FAILED", errorCode: "NOT_A_CV", draft: null });
    await expect(confirmLandingImport(LANDING, IMPORT_ID, CONTACT, CTX)).resolves.toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("an already completed import confirms idempotently", async () => {
    m(getPublicImport).mockResolvedValueOnce({ id: IMPORT_ID, status: "COMPLETED", errorCode: null, draft: null });
    await expect(confirmLandingImport(LANDING, IMPORT_ID, CONTACT, CTX)).resolves.toEqual({ ok: true, data: null });
    expect(m(confirmImport)).not.toHaveBeenCalled();
  });

  it("an audit failure does not fail the confirmation", async () => {
    m(logAudit).mockRejectedValueOnce(new Error("db"));
    await expect(confirmLandingImport(LANDING, IMPORT_ID, CONTACT, CTX)).resolves.toEqual({ ok: true, data: null });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run src/__tests__/lib/landing/flow.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/lib/landing/flow.ts`:

```ts
import { z } from "zod/v4";
import {
  confirmImport,
  createUploadTicket,
  getPublicImport,
  registerUpload,
  runExtraction,
  type UploadTicket,
} from "@/lib/candidate-imports/service";
import {
  ImportError,
  ImportNotFoundError,
  ImportStateError,
  isImportErrorCode,
  type ImportErrorCode,
} from "@/lib/candidate-imports/errors";
import { passesCvQualityGate } from "@/lib/documents/quality";
import { consumeRateLimits, RateLimitUnavailableError, type RateLimitRule } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { verifyTurnstile } from "./turnstile";
import { contactFromDraft, landingContactSchema, mergeContactIntoDraft, type ContactPrefill } from "./contact";
import type { ActiveLanding } from "./service";

export const PUBLIC_MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const PUBLIC_MAX_OCR_PAGES = 3;
/** Bump when the consent copy in the dictionaries changes. */
export const CONSENT_TEXT_VERSION = "2026-10-29";

const HOUR = 3600;
const DAY = 24 * HOUR;
const LIMITS = {
  perIpHour: 3,
  perIpDay: 10,
  perLandingDay: 100,
  /** Global budget cap on paid extractions (OCR + LLM), all landings together. */
  extractionsDay: 300,
  /** One retry per import. */
  perImportDay: 2,
} as const;

export type LandingErrorCode =
  | ImportErrorCode
  | "CAPTCHA_FAILED"
  | "RATE_LIMITED"
  | "BUDGET_EXHAUSTED"
  | "UNAVAILABLE"
  | "SESSION_EXPIRED"
  | "VALIDATION"
  | "NOT_FOUND";

export type LandingResult<T> = { ok: true; data: T } | { ok: false; error: LandingErrorCode };

export interface RequestContext {
  ip: string | null;
  ipHash: string;
}

const fail = (error: LandingErrorCode): { ok: false; error: LandingErrorCode } => ({ ok: false, error });

function toLandingError(e: unknown, tag: string): { ok: false; error: LandingErrorCode } {
  if (e instanceof ImportError) return fail(e.code);
  if (e instanceof ImportNotFoundError || e instanceof ImportStateError) return fail("NOT_FOUND");
  if (e instanceof RateLimitUnavailableError) return fail("UNAVAILABLE");
  // Errors can carry candidate data: name + message only.
  console.error(`[landing] ${tag} failed`, e instanceof Error ? { name: e.name, message: e.message } : {});
  return fail("INTERNAL_ERROR");
}

const requestSchema = z.object({
  fileName: z.string().min(1).max(255),
  fileSize: z.number().int().nonnegative(),
  turnstileToken: z.string().max(4096),
});

/**
 * Step 1: cheap checks first (size), then captcha, then rate limits, then a
 * signed upload ticket. The caller binds `ticket.importId` to the browser
 * with the import cookie.
 */
export async function requestLandingUpload(
  landing: ActiveLanding,
  input: unknown,
  ctx: RequestContext,
): Promise<LandingResult<UploadTicket>> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return fail("VALIDATION");
  const { fileName, fileSize, turnstileToken } = parsed.data;
  if (fileSize === 0) return fail("UNSUPPORTED_TYPE");
  if (fileSize > PUBLIC_MAX_DOCUMENT_BYTES) return fail("FILE_TOO_LARGE");

  if (!(await verifyTurnstile(turnstileToken, ctx.ip))) return fail("CAPTCHA_FAILED");

  const rules: RateLimitRule[] = [
    { key: `landing:ip:${ctx.ipHash}:h`, limit: LIMITS.perIpHour, windowSec: HOUR },
    { key: `landing:ip:${ctx.ipHash}:d`, limit: LIMITS.perIpDay, windowSec: DAY },
    { key: `landing:page:${landing.id}:d`, limit: LIMITS.perLandingDay, windowSec: DAY },
  ];
  try {
    if (!(await consumeRateLimits(rules))) return fail("RATE_LIMITED");
    const ticket = await createUploadTicket({
      poolId: landing.pool.id,
      fileName,
      fileSize,
      maxBytes: PUBLIC_MAX_DOCUMENT_BYTES,
    });
    return { ok: true, data: ticket };
  } catch (e) {
    return toLandingError(e, "request upload");
  }
}

/** Step 2: verify + inspect the stored file and create the PUBLIC_LINK import. */
export async function registerLandingUpload(
  landing: ActiveLanding,
  importId: string,
  fileName: string,
): Promise<LandingResult<null>> {
  if (!fileName || fileName.length > 255) return fail("VALIDATION");
  try {
    await registerUpload({
      importId,
      organizationId: landing.organization.id,
      poolId: landing.pool.id,
      origin: "PUBLIC_LINK",
      createdById: null,
      fileName,
      maxBytes: PUBLIC_MAX_DOCUMENT_BYTES,
      inspect: true,
    });
    return { ok: true, data: null };
  } catch (e) {
    return toLandingError(e, "register upload");
  }
}

/**
 * Step 3: run the paid extraction under the global budget and return the
 * contact prefill. Re-entrant: a READY import returns its prefill for free.
 */
export async function runLandingExtraction(
  landing: ActiveLanding,
  importId: string,
): Promise<LandingResult<ContactPrefill>> {
  const imp = await getPublicImport(importId, landing.pool.id);
  if (!imp) return fail("SESSION_EXPIRED");
  if (imp.status === "READY") return { ok: true, data: contactFromDraft(imp.draft) };
  if (imp.status === "COMPLETED" || imp.status === "DISCARDED") return fail("SESSION_EXPIRED");

  try {
    const withinBudget = await consumeRateLimits([
      { key: "landing:extractions:d", limit: LIMITS.extractionsDay, windowSec: DAY },
      { key: `landing:import:${imp.id}:d`, limit: LIMITS.perImportDay, windowSec: DAY },
    ]);
    if (!withinBudget) return fail("BUDGET_EXHAUSTED");
    await runExtraction(imp.id, {
      maxOcrPages: PUBLIC_MAX_OCR_PAGES,
      textGate: passesCvQualityGate,
      rejectNonCv: true,
    });
  } catch (e) {
    return toLandingError(e, "extraction");
  }

  const after = await getPublicImport(imp.id, landing.pool.id);
  if (after?.status === "READY") return { ok: true, data: contactFromDraft(after.draft) };
  if (after?.status === "FAILED" && isImportErrorCode(after.errorCode)) return fail(after.errorCode);
  return fail("INTERNAL_ERROR");
}

/** Step 4: the candidate's confirmed contact + consent → candidate (or CV attached). */
export async function confirmLandingImport(
  landing: ActiveLanding,
  importId: string,
  input: unknown,
  ctx: RequestContext,
  now = new Date(),
): Promise<LandingResult<null>> {
  const parsed = landingContactSchema.safeParse(input);
  if (!parsed.success) return fail("VALIDATION");
  const contact = parsed.data;

  const imp = await getPublicImport(importId, landing.pool.id);
  if (!imp) return fail("SESSION_EXPIRED");
  if (imp.status === "COMPLETED") return { ok: true, data: null };
  if (imp.status !== "READY") return fail("NOT_FOUND");

  // The sharing checkbox only means something for consent-driven pools.
  const shareWithGlobal = landing.pool.globalSharing === "WEBHOOK" && contact.shareWithGlobal;

  try {
    const { candidateId, attached } = await confirmImport({
      importId: imp.id,
      organizationId: landing.organization.id,
      userId: null,
      fields: mergeContactIntoDraft(imp.draft, contact),
      channel: "landing_cv",
      consentToShare: shareWithGlobal,
      attachToExistingByPhone: true,
      rawPayloadExtra: {
        landingPageId: landing.id,
        consent: {
          privacyPolicyUrl: landing.privacyPolicyUrl,
          acceptedAt: now.toISOString(),
          shareWithGlobal,
          textVersion: CONSENT_TEXT_VERSION,
        },
      },
    });
    try {
      await logAudit({
        userId: null,
        organizationId: landing.organization.id,
        action: "candidate_import.public_confirm",
        resourceType: "candidate_import",
        resourceId: imp.id,
        metadata: { candidateId, attached, ipHash: ctx.ipHash },
      });
    } catch (e) {
      console.error("[landing] audit log failed", e instanceof Error ? e.message : e);
    }
    return { ok: true, data: null };
  } catch (e) {
    return toLandingError(e, "confirm");
  }
}
```

`logAudit`'s `AuditLogParams.userId` is typed `string`. Widen it in `src/lib/audit.ts` to `userId: string | null;` (the column is nullable). Run `pnpm exec tsc --noEmit -p .` to confirm no caller breaks.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm exec vitest run src/__tests__/lib/landing/ && pnpm exec tsc --noEmit -p .`
Expected: PASS; tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/landing/flow.ts src/lib/audit.ts src/__tests__/lib/landing/flow.test.ts
git commit -m "feat(landing): public upload, extraction and confirmation flow"
```

---

### Task 17: Public prefix and environment

**Files:**
- Modify: `src/middleware.ts`
- Modify: `.env.example`
- Test: `src/__tests__/middleware.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

If a middleware test already exists, add the case there instead. Otherwise create `src/__tests__/middleware.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: vi.fn(async () => ({ response: NextResponse.next(), user: null })),
}));

import { middleware } from "@/middleware";

describe("middleware public prefixes", () => {
  it("lets anonymous visitors reach the candidate landing", async () => {
    const res = await middleware(new NextRequest("https://app.kubri.it/candidati/coop-sole"));
    expect(res.status).not.toBe(307);
    expect(res.headers.get("location")).toBeNull();
  });

  it("still redirects anonymous visitors away from the dashboard", async () => {
    const res = await middleware(new NextRequest("https://app.kubri.it/dashboard"));
    expect(res.headers.get("location")).toContain("/login");
  });

  it("does not open look-alike prefixes", async () => {
    const res = await middleware(new NextRequest("https://app.kubri.it/candidatix"));
    expect(res.headers.get("location")).toContain("/login");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run src/__tests__/middleware.test.ts`
Expected: FAIL on the first test (redirect to /login).

- [ ] **Step 3: Implement**

In `src/middleware.ts`, add to `PUBLIC_PREFIXES` after `"/api/cron",`:

```ts
  // Public candidate landing (WhatsApp or CV upload). Its server actions POST to
  // the same path; abuse is handled by Turnstile + rate limits, not a session.
  "/candidati",
```

Append to `.env.example`:

```env
# Public candidate landing (/candidati/<slug>)
# Cloudflare Turnstile — without the secret, uploads are refused in production.
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
# 32+ random chars: HMAC for the import binding cookie.
LANDING_COOKIE_SECRET=
# Random salt for IP hashes in rate-limit keys and audit logs.
LANDING_IP_SALT=
# NOTE: UPSTASH_REDIS_REST_URL / _TOKEN above are REQUIRED in production for the landing.
```

- [ ] **Step 4: Run the full suite and typecheck**

Run: `pnpm exec vitest run && pnpm exec tsc --noEmit -p . && pnpm lint`
Expected: all tests PASS except the DB-backed ones under `src/lib/pools/__tests__` (no `DATABASE_URL` in this worktree — not a regression); tsc and lint exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/middleware.ts .env.example src/__tests__/middleware.test.ts
git commit -m "feat(landing): /candidati public prefix and environment variables"
```

---

## Done when

- All tasks committed; `vitest`, `tsc`, `lint` green (DB-backed pool tests excepted).
- Operator CV import behaves exactly as before (its tests unchanged except the `attached: false` field and the `extractDocumentText` argument shape).
- Plan 2 (`2026-10-29-candidate-landing-2-ui.md`) can be executed on top.
