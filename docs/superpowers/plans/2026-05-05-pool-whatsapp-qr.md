# Pool WhatsApp QR Code — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "QR WhatsApp" action on each row of the admin pools list (`/admin/pools`) that opens a dialog with a QR encoding a `wa.me` deep link, prefixed with the pool's external identifier when the pool is not global. ADMIN_KUBRI only.

**Architecture:** Pure helper `buildWaLink` in `src/lib/whatsapp/`, unit-tested. Server Component (`/admin/pools`) reads `KUBRI_WHATSAPP_NUMBER` and `KUBRI_WHATSAPP_MESSAGE_TEMPLATE` from `process.env` and passes a precomputed link + message to a Client Component dialog that renders the QR via `qrcode.react`. No new API route. If env vars missing the action button is rendered disabled with a tooltip.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Vitest, shadcn/ui (`Dialog`, `Tooltip`, `Button`), `qrcode.react`.

**Spec:** [docs/superpowers/specs/2026-05-05-pool-whatsapp-qr-design.md](../specs/2026-05-05-pool-whatsapp-qr-design.md)

---

## File Structure

**Created:**
- `src/lib/whatsapp/build-link.ts` — pure helper
- `src/__tests__/lib/whatsapp/build-link.test.ts` — unit tests
- `src/components/pools/pool-qr-dialog.tsx` — Client Component dialog + trigger

**Modified:**
- `src/app/(admin)/admin/pools/page.tsx` — add Azioni column, render dialog per row
- `.env.example` — add `KUBRI_WHATSAPP_NUMBER`, `KUBRI_WHATSAPP_MESSAGE_TEMPLATE`
- `package.json` — add `qrcode.react`

---

## Task 1: Add `qrcode.react` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install dependency**

Run:
```bash
pnpm add qrcode.react
```

Expected: `qrcode.react` appears under `dependencies` in `package.json`. `pnpm-lock.yaml` updated.

- [ ] **Step 2: Verify import works**

Run:
```bash
pnpm tsc --noEmit
```

Expected: no new errors. (`qrcode.react` ships its own types.)

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add qrcode.react dependency"
```

---

## Task 2: `buildWaLink` helper — failing tests

**Files:**
- Create: `src/__tests__/lib/whatsapp/build-link.test.ts`

- [ ] **Step 1: Create test directory**

Run:
```bash
mkdir -p src/__tests__/lib/whatsapp
```

- [ ] **Step 2: Write the failing tests**

Create `src/__tests__/lib/whatsapp/build-link.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildWaLink } from "@/lib/whatsapp/build-link";

const NUMBER = "393331234567";
const TEMPLATE = "Ciao, vorrei candidarmi tramite Kubri.";

describe("buildWaLink", () => {
  it("does not prefix the message for a global pool", () => {
    const url = buildWaLink(
      { isGlobal: true, externalKey: "GLOBAL", slug: "global" },
      NUMBER,
      TEMPLATE,
    );
    expect(url).toBe(
      `https://wa.me/${NUMBER}?text=${encodeURIComponent(TEMPLATE)}`,
    );
  });

  it("prefixes externalKey for a non-global pool", () => {
    const url = buildWaLink(
      { isGlobal: false, externalKey: "MENSA01", slug: "mensa-milano" },
      NUMBER,
      TEMPLATE,
    );
    const expectedText = `[MENSA01] ${TEMPLATE}`;
    expect(url).toBe(
      `https://wa.me/${NUMBER}?text=${encodeURIComponent(expectedText)}`,
    );
  });

  it("falls back to slug when externalKey is null", () => {
    const url = buildWaLink(
      { isGlobal: false, externalKey: null, slug: "mensa-milano" },
      NUMBER,
      TEMPLATE,
    );
    const expectedText = `[mensa-milano] ${TEMPLATE}`;
    expect(url).toBe(
      `https://wa.me/${NUMBER}?text=${encodeURIComponent(expectedText)}`,
    );
  });

  it("encodes special characters (spaces, accents, commas, newlines)", () => {
    const tricky = "Ciao è così,\nbenvenuto!";
    const url = buildWaLink(
      { isGlobal: true, externalKey: null, slug: "x" },
      NUMBER,
      tricky,
    );
    expect(url).toBe(
      `https://wa.me/${NUMBER}?text=${encodeURIComponent(tricky)}`,
    );
    expect(url).toContain("%0A");
    expect(url).toContain("%C3%A8");
  });

  it("handles an empty template (still produces a valid url)", () => {
    const url = buildWaLink(
      { isGlobal: true, externalKey: null, slug: "x" },
      NUMBER,
      "",
    );
    expect(url).toBe(`https://wa.me/${NUMBER}?text=`);
  });

  it("includes prefix even with empty template when pool is not global", () => {
    const url = buildWaLink(
      { isGlobal: false, externalKey: "ABC", slug: "abc" },
      NUMBER,
      "",
    );
    expect(url).toBe(
      `https://wa.me/${NUMBER}?text=${encodeURIComponent("[ABC] ")}`,
    );
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:
```bash
pnpm test src/__tests__/lib/whatsapp/build-link.test.ts
```

Expected: FAIL with module-not-found error for `@/lib/whatsapp/build-link`.

---

## Task 3: Implement `buildWaLink`

**Files:**
- Create: `src/lib/whatsapp/build-link.ts`

- [ ] **Step 1: Write minimal implementation**

Create `src/lib/whatsapp/build-link.ts`:

```ts
export type PoolForWaLink = {
  isGlobal: boolean;
  externalKey: string | null;
  slug: string;
};

export function buildWaLink(
  pool: PoolForWaLink,
  number: string,
  template: string,
): string {
  const prefix = pool.isGlobal ? "" : `[${pool.externalKey ?? pool.slug}] `;
  const text = `${prefix}${template}`;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

export function buildWaMessage(pool: PoolForWaLink, template: string): string {
  const prefix = pool.isGlobal ? "" : `[${pool.externalKey ?? pool.slug}] `;
  return `${prefix}${template}`;
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run:
```bash
pnpm test src/__tests__/lib/whatsapp/build-link.test.ts
```

Expected: all 6 tests PASS.

- [ ] **Step 3: Run typecheck**

Run:
```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/whatsapp/build-link.ts src/__tests__/lib/whatsapp/build-link.test.ts
git commit -m "feat(whatsapp): add buildWaLink helper for pool wa.me links"
```

---

## Task 4: Add env vars to `.env.example`

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Append the two variables**

Append to `.env.example` (use Edit, do not duplicate existing keys):

```env

# WhatsApp QR (admin pools)
KUBRI_WHATSAPP_NUMBER=
KUBRI_WHATSAPP_MESSAGE_TEMPLATE=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore(env): add KUBRI_WHATSAPP_NUMBER and KUBRI_WHATSAPP_MESSAGE_TEMPLATE"
```

---

## Task 5: `PoolQrDialog` Client Component

**Files:**
- Create: `src/components/pools/pool-qr-dialog.tsx`

- [ ] **Step 1: Inspect existing shadcn primitives**

Run:
```bash
ls src/components/ui/dialog.tsx src/components/ui/button.tsx src/components/ui/tooltip.tsx
```

Expected: all three exist. Note the named exports used elsewhere in the codebase (e.g. `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogTrigger`, `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider`).

- [ ] **Step 2: Create the component**

Create `src/components/pools/pool-qr-dialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Props = {
  poolName: string;
  waLink: string | null;
  messageText: string | null;
  disabledReason?: string;
};

export function PoolQrDialog({
  poolName,
  waLink,
  messageText,
  disabledReason,
}: Props) {
  const [copied, setCopied] = useState(false);

  if (!waLink || !messageText) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button variant="outline" size="sm" disabled>
                QR WhatsApp
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {disabledReason ??
              "Configurare KUBRI_WHATSAPP_NUMBER e KUBRI_WHATSAPP_MESSAGE_TEMPLATE"}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  async function copy() {
    if (!waLink) return;
    await navigator.clipboard.writeText(waLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          QR WhatsApp
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>QR WhatsApp — {poolName}</DialogTitle>
          <DialogDescription>
            Inquadra il QR per aprire WhatsApp con il messaggio precompilato.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-2">
          <div className="rounded-md bg-white p-4">
            <QRCodeSVG value={waLink} size={240} level="M" />
          </div>
          <div className="w-full space-y-2">
            <div className="text-xs text-muted-foreground">Messaggio</div>
            <div className="rounded border bg-muted/40 p-2 text-sm whitespace-pre-wrap break-words">
              {messageText}
            </div>
          </div>
          <div className="w-full space-y-2">
            <div className="text-xs text-muted-foreground">Link</div>
            <a
              href={waLink}
              target="_blank"
              rel="noreferrer"
              className="block break-all rounded border bg-muted/40 p-2 font-mono text-xs hover:underline"
            >
              {waLink}
            </a>
          </div>
          <Button type="button" variant="secondary" onClick={copy}>
            {copied ? "Copiato!" : "Copia link"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Typecheck**

Run:
```bash
pnpm tsc --noEmit
```

Expected: no errors. If a shadcn primitive name differs from what's imported above (e.g. tooltip API), adjust imports to match `src/components/ui/*.tsx` exactly — do not invent new components.

- [ ] **Step 4: Commit**

```bash
git add src/components/pools/pool-qr-dialog.tsx
git commit -m "feat(pools): add PoolQrDialog client component"
```

---

## Task 6: Wire dialog into the admin pools page

**Files:**
- Modify: `src/app/(admin)/admin/pools/page.tsx`

- [ ] **Step 1: Read the current file**

Open `src/app/(admin)/admin/pools/page.tsx` and confirm structure (Server Component, redirect for non-ADMIN_KUBRI, `listPoolsWithCounts`, table with columns Nome / Slug / External key / Candidati / Organizations / Tipo).

- [ ] **Step 2: Update imports and render the new column**

Apply this edit to `src/app/(admin)/admin/pools/page.tsx`:

Add imports near the existing ones at the top:

```ts
import { PoolQrDialog } from "@/components/pools/pool-qr-dialog";
import { buildWaLink, buildWaMessage } from "@/lib/whatsapp/build-link";
```

Inside the component, after `const pools = await listPoolsWithCounts();`, add:

```ts
const waNumber = process.env.KUBRI_WHATSAPP_NUMBER ?? "";
const waTemplate = process.env.KUBRI_WHATSAPP_MESSAGE_TEMPLATE ?? "";
const waConfigured = waNumber.length > 0 && waTemplate.length > 0;
```

In `<TableHeader>` add a new `<TableHead>` after `Tipo`:

```tsx
<TableHead className="text-right">Azioni</TableHead>
```

In `<TableBody>` rows, append after the `Tipo` cell:

```tsx
<TableCell className="text-right">
  <PoolQrDialog
    poolName={pool.name}
    waLink={
      waConfigured
        ? buildWaLink(
            { isGlobal: pool.isGlobal, externalKey: pool.externalKey, slug: pool.slug },
            waNumber,
            waTemplate,
          )
        : null
    }
    messageText={
      waConfigured
        ? buildWaMessage(
            { isGlobal: pool.isGlobal, externalKey: pool.externalKey, slug: pool.slug },
            waTemplate,
          )
        : null
    }
  />
</TableCell>
```

- [ ] **Step 3: Typecheck**

Run:
```bash
pnpm tsc --noEmit
```

Expected: no errors. If `pool.isGlobal` / `pool.externalKey` / `pool.slug` are not on the type returned by `listPoolsWithCounts`, verify the query includes them — they are present in the existing JSX so they should be.

- [ ] **Step 4: Lint**

Run:
```bash
pnpm lint
```

Expected: no new errors.

- [ ] **Step 5: Run full test suite**

Run:
```bash
pnpm test
```

Expected: all tests pass (no regressions).

- [ ] **Step 6: Manual smoke**

Run dev server with the env vars set in `.env.local`:

```bash
KUBRI_WHATSAPP_NUMBER=393331234567 \
KUBRI_WHATSAPP_MESSAGE_TEMPLATE="Ciao, vorrei candidarmi tramite Kubri." \
pnpm dev
```

As ADMIN_KUBRI, navigate to `/admin/pools`. Verify:
- A "QR WhatsApp" button appears in the new Azioni column.
- Click on a global pool → dialog shows QR + message without prefix.
- Click on a non-global pool with `externalKey` → message starts with `[<externalKey>] `.
- Click on a non-global pool with null `externalKey` → message starts with `[<slug>] `.
- "Copia link" copies the wa.me URL.
- The wa.me link opens WhatsApp Web/desktop with the right text when clicked.

Then restart without env vars (`unset KUBRI_WHATSAPP_NUMBER KUBRI_WHATSAPP_MESSAGE_TEMPLATE`) and verify the button is disabled with a tooltip.

- [ ] **Step 7: Commit**

```bash
git add src/app/\(admin\)/admin/pools/page.tsx
git commit -m "feat(pools): show WhatsApp QR action in admin pools list"
```

---

## Task 7: Final verification

- [ ] **Step 1: Run full check**

Run:
```bash
pnpm lint && pnpm tsc --noEmit && pnpm test
```

Expected: all green.

- [ ] **Step 2: Review diff**

Run:
```bash
git log --oneline main..HEAD
git diff main...HEAD --stat
```

Expected: 5–6 commits limited to `package.json`, `pnpm-lock.yaml`, `.env.example`, `src/lib/whatsapp/`, `src/__tests__/lib/whatsapp/`, `src/components/pools/pool-qr-dialog.tsx`, `src/app/(admin)/admin/pools/page.tsx`.

---

## Notes for the implementer

- **Italian UI strings** are kept inline for now (no i18n bundle yet) — same convention used in `src/app/(admin)/admin/pools/page.tsx`.
- **No changes to `listPoolsWithCounts`** are expected; if `isGlobal`/`externalKey`/`slug` aren't returned, that's a real bug — investigate the query rather than papering over with optional chaining.
- **Do not** introduce a new API route or server action — everything is computed in the Server Component and passed as props.
- **Env vars are not segreti.** They are not exposed to the client via `NEXT_PUBLIC_*`; they're read in the Server Component and the resulting strings are passed down. That's enough.
