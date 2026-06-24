# Assessment App — Monorepo Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the incremental pnpm-workspace foundation for the new public Assessment app — shared contract package, a deployable assessment Next app skeleton, and its "join community" forwarder — without touching the existing dashboard.

**Architecture:** Convert the repo into a pnpm workspace while the dashboard stays at the root (deliberate temporary asymmetry). Add `packages/contracts` (the typed integration seam between the two apps) and `apps/assessment` (a separate Next app, deployed to its own Vercel project). The assessment app holds NO database access: on "join community" it validates the payload against `@kubri/contracts` and forwards it to an authenticated dashboard webhook. The dashboard-side webhook receiver and the questionnaire/PDF/LLM internals are explicitly OUT of scope here (they depend on the questionnaire content and the Candidate data-model mapping — a later feature spec).

**Tech Stack:** pnpm workspaces, Next 16.2.2 (App Router), React 19.2.4, TypeScript 5 (strict), Zod 4 (`zod/v4` import), Tailwind 4, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-06-24-assessment-app-repo-structure-design.md`

---

## Pre-flight (worktree setup)

This plan runs in a git worktree that has no `node_modules` and no `.env.local` (by design). Before Task 1:

- [ ] Run `pnpm install` at the repo root and confirm it completes (the root `postinstall` runs `prisma generate`, which is offline and needs no DB).

Run: `pnpm install`
Expected: install completes; `prisma generate` succeeds. DB-backed tests are not run in this plan — every test here mocks its dependencies.

---

## Task 1: Convert the repo to a pnpm workspace

The dashboard stays at the repo root (it remains the workspace root package). We only declare where future workspace members live.

**Files:**
- Modify: `pnpm-workspace.yaml`

- [ ] **Step 1: Add the `packages` globs**

Replace the contents of `pnpm-workspace.yaml` with:

```yaml
packages:
  - "apps/*"
  - "packages/*"
onlyBuiltDependencies:
  - "@prisma/engines"
  - prisma
```

- [ ] **Step 2: Re-run install to register the (still empty) workspace**

Run: `pnpm install`
Expected: completes with no error. No members exist under `apps/`/`packages/` yet, which is fine.

- [ ] **Step 3: Verify the dashboard is unaffected**

Run: `pnpm test`
Expected: the existing dashboard test suite runs exactly as before (DB-backed tests that need `.env.local` may fail in the worktree — that is the known worktree limitation, not a regression introduced here).

- [ ] **Step 4: Commit**

```bash
git add pnpm-workspace.yaml
git commit -m "chore: declare pnpm workspace (apps/*, packages/*)"
```

---

## Task 2: Create `packages/contracts` (the shared payload contract)

The Zod schema + types describing what the assessment app sends to the dashboard on "join community". Contact fields are fully typed; the assessment answers are an open record until the questionnaire pins them down (this mirrors how the existing Make webhook accepts `data` as an opaque object — see `src/lib/validations/webhook-candidate.ts`).

**Files:**
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/index.test.ts`

- [ ] **Step 1: Create the package manifest**

`packages/contracts/package.json`:

```json
{
  "name": "@kubri/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "zod": "^4.3.6"
  }
}
```

- [ ] **Step 2: Create the package tsconfig**

`packages/contracts/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["esnext"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Write the failing test**

`packages/contracts/src/index.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assessmentSubmissionSchema } from "./index";

const VALID = {
  contact: { firstName: "Amir", lastName: "K", phone: "+393331234567" },
  assessment: { q1: "a", q2: 3 },
};

describe("assessmentSubmissionSchema", () => {
  it("accepts a valid submission", () => {
    expect(assessmentSubmissionSchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects a missing phone", () => {
    const r = assessmentSubmissionSchema.safeParse({
      contact: { firstName: "Amir", lastName: "K" },
      assessment: {},
    });
    expect(r.success).toBe(false);
  });

  it("rejects a malformed phone", () => {
    const r = assessmentSubmissionSchema.safeParse({
      contact: { firstName: "A", lastName: "B", phone: "not-a-number" },
      assessment: {},
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/contracts/src/index.test.ts`
Expected: FAIL — cannot resolve `./index` (file not created yet).

- [ ] **Step 5: Write the implementation**

`packages/contracts/src/index.ts`:

```ts
import { z } from "zod/v4";

/** Contact details collected when the user joins the Kubri community. */
export const assessmentContactSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  // Digits with an optional leading "+", 8–15 long (loose E.164).
  phone: z.string().regex(/^\+?[0-9]{8,15}$/),
});
export type AssessmentContact = z.infer<typeof assessmentContactSchema>;

/**
 * The structured assessment answers. The exact shape is defined by the
 * questionnaire (a later feature spec); until then it is an open record,
 * mirroring how the Make webhook accepts `data` as an opaque object.
 */
export const assessmentAnswersSchema = z.record(z.string(), z.unknown());
export type AssessmentAnswers = z.infer<typeof assessmentAnswersSchema>;

/** Payload the assessment app POSTs to the dashboard webhook on "join". */
export const assessmentSubmissionSchema = z.object({
  contact: assessmentContactSchema,
  assessment: assessmentAnswersSchema,
});
export type AssessmentSubmission = z.infer<typeof assessmentSubmissionSchema>;
```

- [ ] **Step 6: Install so the workspace links the new package**

Run: `pnpm install`
Expected: completes; `@kubri/contracts` is now a recognized workspace package.

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/contracts/src/index.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): add @kubri/contracts assessment submission schema"
```

---

## Task 3: Scaffold the `apps/assessment` Next app

A minimal, deployable public Next app (mobile-first shell, Tailwind 4). The questionnaire UI is a later feature; this task only proves the app exists, builds, and consumes `@kubri/contracts`.

**Files:**
- Create: `apps/assessment/package.json`
- Create: `apps/assessment/next.config.ts`
- Create: `apps/assessment/tsconfig.json`
- Create: `apps/assessment/postcss.config.mjs`
- Create: `apps/assessment/src/app/globals.css`
- Create: `apps/assessment/src/app/layout.tsx`
- Create: `apps/assessment/src/app/page.tsx`

- [ ] **Step 1: Create the app manifest**

`apps/assessment/package.json`:

```json
{
  "name": "@kubri/assessment",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3002",
    "build": "next build",
    "start": "next start --port 3002"
  },
  "dependencies": {
    "@kubri/contracts": "workspace:*",
    "next": "16.2.2",
    "react": "19.2.4",
    "react-dom": "19.2.4"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "tailwindcss": "^4",
    "typescript": "^5"
  }
}
```

- [ ] **Step 2: Create the Next config (transpile the workspace package)**

`apps/assessment/next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @kubri/contracts ships raw TS; Next must transpile it.
  transpilePackages: ["@kubri/contracts"],
};

export default nextConfig;
```

- [ ] **Step 3: Create the app tsconfig**

`apps/assessment/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create the PostCSS + Tailwind entry**

`apps/assessment/postcss.config.mjs`:

```js
const config = {
  plugins: ["@tailwindcss/postcss"],
};
export default config;
```

`apps/assessment/src/app/globals.css`:

```css
@import "tailwindcss";
```

- [ ] **Step 5: Create the root layout**

`apps/assessment/src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kubri Assessment",
  description: "Valuta le tue competenze con Kubri",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="it">
      <body className="min-h-dvh bg-white text-neutral-900 antialiased">
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 6: Create the placeholder landing page**

`apps/assessment/src/app/page.tsx`:

```tsx
export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">Kubri Assessment</h1>
      <p className="text-neutral-600">Il questionario sarà disponibile a breve.</p>
    </main>
  );
}
```

- [ ] **Step 7: Install so the app's deps are linked**

Run: `pnpm install`
Expected: completes; `@kubri/assessment` resolves `@kubri/contracts` via `workspace:*`.

- [ ] **Step 8: Verify the app builds**

Run: `pnpm --filter @kubri/assessment build`
Expected: a successful Next production build (compiles `/` and the layout; no type errors).

- [ ] **Step 9: Commit**

```bash
git add apps/assessment
git commit -m "feat(assessment): scaffold public Next app shell"
```

---

## Task 4: Implement `apps/assessment` "join community" forwarder

The `POST /api/community` route: validate with `@kubri/contracts`, then forward to the dashboard webhook with the shared-secret `Authorization` header. No DB access. Mirrors the auth/validation shape of `src/app/api/webhooks/make/candidate/route.ts`, but as a sender.

**Files:**
- Create: `apps/assessment/src/app/api/community/route.ts`
- Test: `apps/assessment/src/app/api/community/route.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/assessment/src/app/api/community/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "./route";

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/community", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const VALID = {
  contact: { firstName: "Amir", lastName: "K", phone: "+393331234567" },
  assessment: { q1: "a" },
};

describe("POST /api/community", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env["DASHBOARD_WEBHOOK_URL"] =
      "https://dash.example/api/webhooks/assessment";
    process.env["ASSESSMENT_WEBHOOK_SECRET"] = "s3cr3t";
  });

  it("returns 400 on an invalid payload", async () => {
    const res = await POST(makeReq({ contact: {}, assessment: {} }));
    expect(res.status).toBe(400);
  });

  it("forwards a valid payload to the dashboard webhook with the secret", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const res = await POST(makeReq(VALID));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://dash.example/api/webhooks/assessment");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer s3cr3t",
    });
  });

  it("returns 502 when the dashboard webhook rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 401 }),
    );
    const res = await POST(makeReq(VALID));
    expect(res.status).toBe(502);
  });

  it("returns 500 when webhook config is missing", async () => {
    delete process.env["DASHBOARD_WEBHOOK_URL"];
    const res = await POST(makeReq(VALID));
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run apps/assessment/src/app/api/community/route.test.ts`
Expected: FAIL — cannot resolve `./route` (not created yet).

- [ ] **Step 3: Write the route**

`apps/assessment/src/app/api/community/route.ts`:

```ts
import { NextResponse } from "next/server";
import { assessmentSubmissionSchema } from "@kubri/contracts";

export async function POST(req: Request): Promise<Response> {
  const webhookUrl = process.env["DASHBOARD_WEBHOOK_URL"];
  const secret = process.env["ASSESSMENT_WEBHOOK_SECRET"];
  if (!webhookUrl || !secret) {
    console.error("[assessment/community] missing webhook config");
    return NextResponse.json({ error: "misconfigured" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = assessmentSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(parsed.data),
    });
  } catch (e) {
    console.error("[assessment/community] upstream fetch failed", e);
    return NextResponse.json({ error: "upstream_unreachable" }, { status: 502 });
  }

  if (!upstream.ok) {
    console.error("[assessment/community] upstream error", upstream.status);
    return NextResponse.json({ error: "upstream_error" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run apps/assessment/src/app/api/community/route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Verify the app still builds with the new route**

Run: `pnpm --filter @kubri/assessment build`
Expected: successful build including the `/api/community` route.

- [ ] **Step 6: Commit**

```bash
git add apps/assessment/src/app/api/community
git commit -m "feat(assessment): forward community signups to dashboard webhook"
```

---

## Task 5: Document env vars for both Vercel projects

Make the new env contract explicit on both sides. No code; config + docs.

**Files:**
- Modify: `.env.example` (dashboard / root)
- Create: `apps/assessment/.env.example`

- [ ] **Step 1: Add the receiver secret to the dashboard env example**

In `.env.example`, immediately after the `MAKE_WEBHOOK_SECRET=` block, add:

```bash
# Secret shared with the Assessment app for its candidate webhook.
# Same value as ASSESSMENT_WEBHOOK_SECRET in the assessment app.
# Generate with: openssl rand -hex 32
ASSESSMENT_WEBHOOK_SECRET=
```

- [ ] **Step 2: Create the assessment app env example**

`apps/assessment/.env.example`:

```bash
# URL of the dashboard webhook that receives community signups + assessment
# answers and upserts a Candidate. Per Vercel environment:
#   Production  -> https://app.kubri.it/api/webhooks/assessment
#   Preview/Dev -> the dev/staging dashboard (writes to the dev DB)
DASHBOARD_WEBHOOK_URL=

# Shared secret sent as `Authorization: Bearer ...` to the dashboard webhook.
# Must match ASSESSMENT_WEBHOOK_SECRET on the dashboard.
ASSESSMENT_WEBHOOK_SECRET=

# NOTE: the LLM API key for the "skills report" (concept map + PDF) is added
# in the later feature phase — not needed by this foundation.
```

- [ ] **Step 3: Commit**

```bash
git add .env.example apps/assessment/.env.example
git commit -m "docs: env vars for the assessment webhook (both sides)"
```

---

## Out of scope (next: feature phase, needs the questionnaire)

These are intentionally NOT in this plan and become the next spec → plan cycle once the questionnaire is provided:

- **Dashboard-side webhook receiver** `POST /api/webhooks/assessment` — auth + validate against `@kubri/contracts`, resolve `Pool`, upsert `Candidate` (+ embedding). Blocked on the Candidate data-model mapping (which columns hold the structured assessment, `externalId`/`Pool` resolution for assessment-sourced candidates).
- **Questionnaire UI/flow** in `apps/assessment` and the concrete `assessment` answer shape in `@kubri/contracts`.
- **`POST /api/report`** — LLM concept map + PDF (`@react-pdf/renderer`). Reconcile the LLM provider: the codebase currently uses **Mistral** (`MISTRAL_API_KEY`), not Anthropic; consult the `claude-api` skill if Claude/Haiku is chosen instead.
- **Vercel project creation**, domain, and Ignored Build Step (per the spec's deployment section).
- **Abuse protection on the public `/api/community` relay** (flagged in the foundation code review). The route is a public, unauthenticated endpoint that forwards to an authenticated dashboard webhook — it lends its credential to anonymous callers, and `assessment` is an open record, so a caller can attach an arbitrarily large payload. Add rate limiting + a request body size cap. Design this **together with the receiver** (where the cost lands), not as a retrofit. Note also that phone/format normalization belongs in the questionnaire UI before submit (the contract regex is intentionally loose).
