# Assessment Questionnaire → Candidate Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a completed structured questionnaire into a `Candidate` row when the user opts into the community — driven by a single hard-coded question registry that powers rendering, validation, and answer→DB mapping.

**Architecture:** A registry in `@kubri/contracts` is the source of truth: it derives the Zod validation schema and a mapping from answers to `Candidate` columns + a new `assessmentProfile` JSON column. The public assessment app renders the registry and POSTs `{ contact, assessment }` to its existing `/api/community` proxy, which forwards to a new dashboard webhook (`/api/webhooks/assessment`) — the only place that writes the DB.

**Tech Stack:** TypeScript (strict), Zod 4 (`zod/v4`), Next 16 (App Router, React 19), Prisma 7 (Postgres/pgvector), Vitest 4, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-06-24-assessment-questionnaire-pipeline-design.md`

**Reuse (read these first):**
- `apps/dashboard/src/lib/make/normalize.ts` — the column-mapping + coercion pattern to mirror.
- `apps/dashboard/src/app/api/webhooks/make/candidate/route.ts` — the webhook route to clone.
- `apps/dashboard/src/__tests__/app/api/webhooks/make/candidate.test.ts` — the webhook test pattern.
- `apps/dashboard/src/lib/embeddings/{client,text}.ts` — `generateEmbedding`, `vectorToPgLiteral`, `buildCandidateEmbeddingText(input: CandidateEmbeddingInput)` where `CandidateEmbeddingInput = { skillsAndCompetences: string[]; workExperience: string[]; educationAndTraining: string[]; desiredJob; jobConstraints }`.
- `apps/dashboard/src/lib/pools/resolve.ts` — `resolvePoolByExternalKey`, `UnknownPoolError`.

**Conventions:** Zod imported as `import { z } from "zod/v4"`. Workspace-level tests (`packages/**`, `apps/assessment/**`) run via the root `vitest.config.ts` with `pnpm exec vitest run <path>`. Dashboard tests via `pnpm --filter kubri-dashboard test`. Prisma runs from `apps/dashboard`.

**Decision — answer optionality:** every assessment answer is **optional** (the questionnaire is exploratory; partial submissions are allowed and still useful as a lead). The schema validates each answer's *type when present*. Only the `contact` block has required fields (firstName, lastName, phone, privacy consent).

## File structure

```
packages/contracts/src/
├── index.ts                         # re-export assessment/*; tighten assessmentSubmissionSchema (+ email)
└── assessment/
    ├── types.ts                     # ComponentType, FieldTarget, QuestionDef, SectionDef, CandidateColumn
    ├── registry.ts                  # ASSESSMENT_SECTIONS (transcribed JSON) + allQuestions()
    ├── schema.ts                    # buildAssessmentAnswersSchema() derived from registry
    ├── mapping.ts                   # mapAssessmentToCandidate(answers) → { columns, assessmentProfile }
    └── *.test.ts
apps/dashboard/
├── prisma/schema.prisma             # + assessmentProfile Json?, + email String?
└── src/app/api/webhooks/assessment/
    ├── route.ts
    └── (test in src/__tests__/app/api/webhooks/assessment/route.test.ts)
apps/assessment/src/
├── components/questionnaire/        # one component per ComponentType + QuestionRenderer
├── components/AssessmentFlow.tsx    # client: sections, completion CTAs, contact form
├── lib/submit.ts                    # POST {contact,assessment} → /api/community
└── app/page.tsx                     # renders <AssessmentFlow>
```

---

## Task 1: Registry types + a thin registry slice (contracts)

**Files:**
- Create: `packages/contracts/src/assessment/types.ts`
- Create: `packages/contracts/src/assessment/registry.ts`
- Test: `packages/contracts/src/assessment/registry.test.ts`

- [ ] **Step 1: Write the failing test (registry integrity)**

`registry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ASSESSMENT_SECTIONS, allQuestions } from "./registry";

describe("assessment registry", () => {
  it("has unique question ids", () => {
    const ids = allQuestions().map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every question has a target and a known component", () => {
    const components = new Set([
      "single_choice", "multi_choice", "scale", "text", "textarea", "select", "repeatable_group",
    ]);
    for (const q of allQuestions()) {
      expect(components.has(q.component)).toBe(true);
      expect(q.target).toBeTruthy();
    }
  });

  it("choice questions carry options; scale questions carry a scale", () => {
    for (const q of allQuestions()) {
      if (q.component === "single_choice" || q.component === "multi_choice") {
        expect(Array.isArray(q.options) && q.options.length > 0).toBe(true);
      }
      if (q.component === "scale") expect(q.scale).toBeTruthy();
    }
  });

  it("sections are ordered and non-empty", () => {
    expect(ASSESSMENT_SECTIONS.length).toBeGreaterThan(0);
    const orders = ASSESSMENT_SECTIONS.map((s) => s.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run packages/contracts/src/assessment/registry.test.ts`
Expected: FAIL — cannot resolve `./registry`.

- [ ] **Step 3: Write `types.ts`**

```ts
/** UI component used to render a question. */
export type ComponentType =
  | "single_choice"
  | "multi_choice"
  | "scale"
  | "text"
  | "textarea"
  | "select"
  | "repeatable_group";

/** Writable Candidate columns an answer may target. */
export type CandidateColumn =
  | "workExperience"
  | "skillsAndCompetences"
  | "educationAndTraining"
  | "desiredJob"
  | "jobConstraints"
  | "preferredLocation"
  | "partTimePreference";

/** Where a question's answer goes. */
export type FieldTarget =
  | { kind: "column"; field: CandidateColumn; strategy: "set" | "append" }
  | { kind: "profile"; path: string };

export interface ChoiceOption {
  value: string;
  label: string;
}

export interface ScaleConfig {
  min: number;
  max: number;
  default: number;
  labelMin: string;
  labelMax: string;
}

/** A sub-field inside a repeatable_group (e.g. one field of a work experience). */
export interface SubFieldDef {
  id: string;
  component: Exclude<ComponentType, "repeatable_group">;
  label: string;
  target: FieldTarget;
  options?: ChoiceOption[];
  selectOptions?: string[];
  scale?: ScaleConfig;
  placeholder?: string;
}

export interface QuestionDef {
  id: string;
  component: ComponentType;
  label: string;
  text: string;
  hint?: string;
  target: FieldTarget;
  options?: ChoiceOption[]; // single_choice / multi_choice
  selectOptions?: string[]; // select
  scale?: ScaleConfig; // scale
  fields?: SubFieldDef[]; // repeatable_group
  placeholder?: string; // text / textarea
}

export interface SectionDef {
  id: string;
  title: string;
  order: number;
  questions: QuestionDef[];
}
```

- [ ] **Step 4: Write a thin `registry.ts` (one section, the helper)**

Transcribe ONLY section `s-cog` now (full transcription is Task 2). Establish the shape + helper.

```ts
import type { SectionDef, QuestionDef } from "./types";

export const ASSESSMENT_SECTIONS: SectionDef[] = [
  {
    id: "s-cog",
    title: "Come risolvi i problemi",
    order: 1,
    questions: [
      {
        id: "q1",
        component: "single_choice",
        label: "Problem solving",
        text: "Hai un problema che non hai mai affrontato prima. Cosa fai di solito?",
        target: { kind: "profile", path: "cognitive.problemSolving" },
        options: [
          { value: "analitico", label: "Cerco di capire bene la situazione prima di muovermi — analizzo, poi agisco" },
          { value: "pratico", label: "Provo subito qualcosa e vedo cosa succede — imparo facendo" },
          { value: "relazionale", label: "Chiedo a qualcuno che ne sa più di me — mi fido dell'esperienza altrui" },
          { value: "intuitivo", label: "Mi fido dell'istinto e dell'esperienza passata — spesso funziona" },
        ],
      },
      {
        id: "q3",
        component: "scale",
        label: "Numeri e logica",
        text: "Durante la giornata, quanto spesso ti trovi a fare calcoli, stime o confronti tra numeri?",
        target: { kind: "profile", path: "cognitive.numeracy" },
        scale: { min: 1, max: 5, default: 3, labelMin: "Mai, evito i numeri", labelMax: "Continuamente, mi viene naturale" },
      },
    ],
  },
];

export function allQuestions(): QuestionDef[] {
  return ASSESSMENT_SECTIONS.flatMap((s) => s.questions);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/contracts/src/assessment/registry.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/assessment/types.ts packages/contracts/src/assessment/registry.ts packages/contracts/src/assessment/registry.test.ts
git commit -m "feat(contracts): assessment registry types + integrity tests"
```

---

## Task 2: Transcribe the full questionnaire into the registry

**Files:**
- Modify: `packages/contracts/src/assessment/registry.ts`

Transcribe the remaining sections from the source JSON (`docs/.../skill_assessment` JSON in the design discussion), following the established pattern. This is mechanical; the Task 1 integrity test guards it.

- [ ] **Step 1: Add all sections + questions.** Map each JSON question to a `QuestionDef`. Apply these `target` rules consistently:
  - **Psychometric** (s-cog q1/q2/q4, s-exec q5/q6/q7a/q7b/q8, s-rel q9–q12, s-int q14/q15) → `{ kind: "profile", path: "<section>.<id>" }`.
  - **Experience block** (`s-exp`) → a single `repeatable_group` question `id: "esperienze"` whose `fields` are the JSON `experience_fields`. Sub-field targets: `ruolo`/`durata`/`attivita` → `{ kind: "column", field: "workExperience", strategy: "append" }`; `skills_universali`/`skills_specifiche` → `{ kind: "column", field: "skillsAndCompetences", strategy: "append" }`; `gradimento` → `{ kind: "profile", path: "experience.gradimento" }`.
  - **Education extras** (`s-exp.extra_fields`): `titolo_studio` (select) + `corsi` (textarea) → regular questions in `s-exp`, target `{ kind: "column", field: "educationAndTraining", strategy: "append" }`.
  - **Interests/constraints** (`s-int`): `q13` (multi) → `{ kind: "profile", path: "interests.activities" }`; `q16` (multi, context/constraints) → `{ kind: "column", field: "jobConstraints", strategy: "set" }` (joined to a string).
  - `multi_choice` JSON options are plain strings → represent as `{ value: s, label: s }`.

  Show ~1 entry per remaining component type so the pattern is unambiguous; transcribe the rest identically. (The plan author lists the representative entries inline in the actual edit.)

- [ ] **Step 2: Run the integrity test**

Run: `pnpm exec vitest run packages/contracts/src/assessment/registry.test.ts`
Expected: PASS, now covering all questions.

- [ ] **Step 3: Commit**

```bash
git add packages/contracts/src/assessment/registry.ts
git commit -m "feat(contracts): transcribe full questionnaire into the registry"
```

---

## Task 3: Derive the validation schema + tighten the submission

**Files:**
- Create: `packages/contracts/src/assessment/schema.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/assessment/schema.test.ts`

- [ ] **Step 1: Write the failing test**

`schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assessmentAnswersSchema } from "./schema";

describe("assessmentAnswersSchema", () => {
  it("accepts a partial set of well-typed answers", () => {
    const r = assessmentAnswersSchema.safeParse({ q1: "analitico", q3: 4 });
    expect(r.success).toBe(true);
  });

  it("accepts an empty object (all answers optional)", () => {
    expect(assessmentAnswersSchema.safeParse({}).success).toBe(true);
  });

  it("rejects a single_choice value outside its options", () => {
    expect(assessmentAnswersSchema.safeParse({ q1: "nope" }).success).toBe(false);
  });

  it("rejects a scale value out of range", () => {
    expect(assessmentAnswersSchema.safeParse({ q3: 99 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/contracts/src/assessment/schema.test.ts`
Expected: FAIL — cannot resolve `./schema`.

- [ ] **Step 3: Write `schema.ts` (derive from registry)**

```ts
import { z } from "zod/v4";
import type { QuestionDef, SubFieldDef } from "./types";
import { allQuestions } from "./registry";

function fieldSchema(q: QuestionDef | SubFieldDef): z.ZodTypeAny {
  switch (q.component) {
    case "single_choice":
    case "select": {
      const values =
        q.component === "single_choice"
          ? (q.options ?? []).map((o) => o.value)
          : (q.selectOptions ?? []);
      return z.string().refine((v) => values.includes(v), "value not in options");
    }
    case "multi_choice": {
      const values = (q.options ?? []).map((o) => o.value);
      return z.array(z.string().refine((v) => values.includes(v), "value not in options"));
    }
    case "scale": {
      const s = q.scale!;
      return z.number().int().min(s.min).max(s.max);
    }
    case "text":
    case "textarea":
      return z.string();
    case "repeatable_group": {
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const f of (q as QuestionDef).fields ?? []) shape[f.id] = fieldSchema(f).optional();
      return z.array(z.object(shape));
    }
  }
}

function buildAnswersSchema(): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const q of allQuestions()) shape[q.id] = fieldSchema(q).optional();
  return z.object(shape);
}

export const assessmentAnswersSchema = buildAnswersSchema();
export type AssessmentAnswers = z.infer<typeof assessmentAnswersSchema>;
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run packages/contracts/src/assessment/schema.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Tighten `index.ts`** — add `email`, use the derived answers schema, re-export the registry/types/mapping.

Replace `packages/contracts/src/index.ts` with:

```ts
import { z } from "zod/v4";
import { assessmentAnswersSchema } from "./assessment/schema";

export * from "./assessment/types";
export * from "./assessment/registry";
export * from "./assessment/schema";
export * from "./assessment/mapping";

/** Contact details collected when the user joins the Kubri community. */
export const assessmentContactSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  // Digits with an optional leading "+", 8–15 long (loose E.164).
  phone: z.string().regex(/^\+?[0-9]{8,15}$/),
  email: z.email().optional(),
  privacyAccepted: z.literal(true),
});
export type AssessmentContact = z.infer<typeof assessmentContactSchema>;

/** Payload the assessment app POSTs to the dashboard webhook on "join". */
export const assessmentSubmissionSchema = z.object({
  contact: assessmentContactSchema,
  assessment: assessmentAnswersSchema,
});
export type AssessmentSubmission = z.infer<typeof assessmentSubmissionSchema>;
```

> Note: `mapping.ts` (Task 4) must exist for the `export *` to resolve. If running Task 3 before Task 4, create an empty `mapping.ts` placeholder exporting nothing, then fill it in Task 4. Prefer doing Task 4 immediately after.

- [ ] **Step 6: Update the existing community-route test** (the contact now requires `privacyAccepted: true` and allows `email`). In `apps/assessment/src/app/api/community/route.test.ts`, add `privacyAccepted: true` to the `VALID` contact fixture.

- [ ] **Step 7: Run the contracts + community tests**

Run: `pnpm exec vitest run packages/contracts apps/assessment/src/app/api/community`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts/src apps/assessment/src/app/api/community/route.test.ts
git commit -m "feat(contracts): derive answers schema + add email/consent to contact"
```

---

## Task 4: Map answers → Candidate columns + assessmentProfile

**Files:**
- Create: `packages/contracts/src/assessment/mapping.ts`
- Test: `packages/contracts/src/assessment/mapping.test.ts`

- [ ] **Step 1: Write the failing test**

`mapping.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapAssessmentToCandidate } from "./mapping";

describe("mapAssessmentToCandidate", () => {
  it("routes profile answers into assessmentProfile by path", () => {
    const { assessmentProfile } = mapAssessmentToCandidate({ q1: "analitico", q3: 4 });
    expect(assessmentProfile).toMatchObject({ cognitive: { problemSolving: "analitico", numeracy: 4 } });
  });

  it("appends column answers (experience → workExperience, skills)", () => {
    const { columns } = mapAssessmentToCandidate({
      esperienze: [{ ruolo: "cameriere", attivita: "servizio ai tavoli", skills_universali: ["Gestione del cliente"] }],
    });
    expect(columns.workExperience?.some((s) => s.includes("cameriere"))).toBe(true);
    expect(columns.skillsAndCompetences).toContain("Gestione del cliente");
  });

  it("ignores unknown / empty answers", () => {
    const { columns, assessmentProfile } = mapAssessmentToCandidate({});
    expect(columns).toEqual({});
    expect(assessmentProfile).toEqual({});
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/contracts/src/assessment/mapping.test.ts`
Expected: FAIL — cannot resolve `./mapping`.

- [ ] **Step 3: Write `mapping.ts`**

Mirror `normalize.ts` coercion style. Walk each answered question's `target`; for `repeatable_group`, walk each entry's sub-field targets. `set` overwrites; `append` pushes into a string array (composing readable strings for grouped text).

```ts
import type { CandidateColumn, QuestionDef, SubFieldDef } from "./types";
import { allQuestions, ASSESSMENT_SECTIONS } from "./registry";

export interface MappedColumns {
  workExperience?: string[];
  skillsAndCompetences?: string[];
  educationAndTraining?: string[];
  desiredJob?: string;
  jobConstraints?: string;
  preferredLocation?: string;
  partTimePreference?: boolean;
}

export interface MappedCandidate {
  columns: MappedColumns;
  assessmentProfile: Record<string, unknown>;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]!] ??= {};
    cur = cur[parts[i]!] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

function appendColumn(columns: MappedColumns, field: CandidateColumn, value: string): void {
  if (!value.trim()) return;
  const arr = (columns[field as "workExperience"] ??= []) as string[];
  arr.push(value.trim());
}

function asString(v: unknown): string {
  if (Array.isArray(v)) return v.join(", ");
  return v == null ? "" : String(v);
}

export function mapAssessmentToCandidate(answers: Record<string, unknown>): MappedCandidate {
  const columns: MappedColumns = {};
  const assessmentProfile: Record<string, unknown> = {};

  const byId = new Map(allQuestions().map((q) => [q.id, q] as const));

  for (const [qid, answer] of Object.entries(answers)) {
    if (answer == null) continue;
    const q = byId.get(qid);
    if (!q) continue;

    if (q.component === "repeatable_group") {
      const entries = Array.isArray(answer) ? answer : [];
      for (const entry of entries as Record<string, unknown>[]) {
        for (const f of q.fields ?? []) {
          const v = entry[f.id];
          if (v == null || asString(v) === "") continue;
          applyTarget(columns, assessmentProfile, f, v);
        }
      }
      continue;
    }
    applyTarget(columns, assessmentProfile, q, answer);
  }

  return { columns, assessmentProfile };
}

function applyTarget(
  columns: MappedColumns,
  profile: Record<string, unknown>,
  def: QuestionDef | SubFieldDef,
  value: unknown,
): void {
  const t = def.target;
  if (t.kind === "profile") {
    setPath(profile, t.path, value);
    return;
  }
  if (t.strategy === "append") {
    // compose a readable line: "<label>: <value>"
    appendColumn(columns, t.field, `${def.label}: ${asString(value)}`);
  } else {
    (columns as Record<string, unknown>)[t.field] = asString(value);
  }
}

// silence unused import if ASSESSMENT_SECTIONS not referenced
void ASSESSMENT_SECTIONS;
```

> Refine the `append` composition during implementation if the test expects bare values rather than `"<label>: <value>"` — keep the test and code in sync. Remove the `void ASSESSMENT_SECTIONS` line if unused.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run packages/contracts/src/assessment/mapping.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/assessment/mapping.ts packages/contracts/src/assessment/mapping.test.ts
git commit -m "feat(contracts): map assessment answers to Candidate columns + profile"
```

---

## Task 5: Prisma migration — add `assessmentProfile` + `email`

**Files:**
- Modify: `apps/dashboard/prisma/schema.prisma`
- Create: `apps/dashboard/prisma/migrations/<timestamp>_add_candidate_assessment_fields/migration.sql`

- [ ] **Step 1: Edit the schema** — inside `model Candidate`, near `rawPayload`:

```prisma
  email                String?
  assessmentProfile    Json?
```

- [ ] **Step 2: Generate the migration (from apps/dashboard, dev DB env loaded)**

Run: `cd apps/dashboard && set -a && source .env.local && set +a && pnpm exec prisma migrate dev --name add_candidate_assessment_fields`
Expected: a new migration with two `ALTER TABLE "Candidate" ADD COLUMN`. **Open the generated SQL and delete any `DROP INDEX ... hnsw` / vector index lines the generator injected** (known pgvector drift) before it is committed. Never `migrate reset`.

- [ ] **Step 3: Verify status**

Run: `cd apps/dashboard && set -a && source .env.local && set +a && pnpm exec prisma migrate status`
Expected: up to date, 0 pending.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/prisma/schema.prisma apps/dashboard/prisma/migrations
git commit -m "feat(db): add Candidate.email and Candidate.assessmentProfile"
```

---

## Task 6: Dashboard webhook receiver

**Files:**
- Create: `apps/dashboard/src/app/api/webhooks/assessment/route.ts`
- Test: `apps/dashboard/src/__tests__/app/api/webhooks/assessment/route.test.ts`

- [ ] **Step 1: Write the failing test** — mirror `make/candidate.test.ts` (mock `@/lib/db`, `@/lib/pools/resolve`, `@/lib/embeddings/client`). Import `POST` from the new route.

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { candidate: { upsert: vi.fn() }, $executeRaw: vi.fn() } }));
vi.mock("@/lib/pools/resolve", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pools/resolve")>("@/lib/pools/resolve");
  return { ...actual, resolvePoolByExternalKey: vi.fn() };
});
vi.mock("@/lib/embeddings/client", () => ({ generateEmbedding: vi.fn(), vectorToPgLiteral: (v: number[]) => `[${v.join(",")}]` }));

import { prisma } from "@/lib/db";
import { resolvePoolByExternalKey } from "@/lib/pools/resolve";
import { POST } from "@/app/api/webhooks/assessment/route";

const SECRET = "test-secret";
const POOL = { id: "00000000-0000-0000-0000-000000000001", name: "Global", externalKey: "global", createdAt: new Date() };

function req(body: unknown, auth?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth !== undefined) headers["Authorization"] = auth;
  return new Request("http://localhost/api/webhooks/assessment", { method: "POST", headers, body: JSON.stringify(body) });
}

const VALID = {
  contact: { firstName: "Amir", lastName: "K", phone: "+393331234567", privacyAccepted: true },
  assessment: { q1: "analitico", q3: 4 },
};

describe("POST /api/webhooks/assessment", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env["ASSESSMENT_WEBHOOK_SECRET"] = SECRET;
    process.env["ASSESSMENT_POOL_KEY"] = "global";
    (resolvePoolByExternalKey as ReturnType<typeof vi.fn>).mockResolvedValue(POOL);
    (prisma.candidate.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "c1", skillsAndCompetences: [], workExperience: [], educationAndTraining: [], desiredJob: null, jobConstraints: null,
    });
  });

  it("401 without secret", async () => {
    const res = await POST(req(VALID));
    expect(res.status).toBe(401);
  });

  it("400 on invalid payload", async () => {
    const res = await POST(req({ contact: {}, assessment: {} }, `Bearer ${SECRET}`));
    expect(res.status).toBe(400);
  });

  it("upserts with externalId = phone and assessmentProfile populated", async () => {
    const res = await POST(req(VALID, `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const arg = (prisma.candidate.upsert as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg.create.externalId).toBe("+393331234567");
    expect(arg.create.assessmentProfile).toMatchObject({ cognitive: { problemSolving: "analitico" } });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter kubri-dashboard exec vitest run src/__tests__/app/api/webhooks/assessment/route.test.ts`
Expected: FAIL — cannot resolve the route.

- [ ] **Step 3: Write `route.ts`** — clone `make/candidate/route.ts`, swapping the schema/mapping:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { assessmentSubmissionSchema, mapAssessmentToCandidate } from "@kubri/contracts";
import { resolvePoolByExternalKey, UnknownPoolError } from "@/lib/pools/resolve";
import { generateEmbedding, vectorToPgLiteral } from "@/lib/embeddings/client";
import { buildCandidateEmbeddingText } from "@/lib/embeddings/text";
import type { Prisma } from "@/generated/prisma/client";

export async function POST(req: Request): Promise<Response> {
  const expected = process.env["ASSESSMENT_WEBHOOK_SECRET"];
  if (!expected || req.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = assessmentSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const poolKey = process.env["ASSESSMENT_POOL_KEY"] ?? "global";
  let pool;
  try { pool = await resolvePoolByExternalKey(poolKey); }
  catch (e) {
    if (e instanceof UnknownPoolError) return NextResponse.json({ error: "unknown_pool", poolKey }, { status: 422 });
    throw e;
  }

  const { contact, assessment } = parsed.data;
  const { columns, assessmentProfile } = mapAssessmentToCandidate(assessment);

  const upsertInput: Prisma.CandidateUncheckedCreateInput = {
    externalId: contact.phone,
    poolId: pool.id,
    firstName: contact.firstName,
    lastName: contact.lastName,
    phone: contact.phone,
    email: contact.email ?? null,
    channel: "assessment",
    sourceOrganization: "kubri-assessment",
    sharedWithGlobal: contact.privacyAccepted === true,
    workExperience: columns.workExperience ?? [],
    skillsAndCompetences: columns.skillsAndCompetences ?? [],
    educationAndTraining: columns.educationAndTraining ?? [],
    desiredJob: columns.desiredJob ?? null,
    jobConstraints: columns.jobConstraints ?? null,
    preferredLocation: columns.preferredLocation ?? null,
    partTimePreference: columns.partTimePreference ?? null,
    assessmentProfile: assessmentProfile as Prisma.InputJsonValue,
    rawPayload: parsed.data as unknown as Prisma.InputJsonValue,
  };

  try {
    const candidate = await prisma.candidate.upsert({
      where: { poolId_externalId: { poolId: pool.id, externalId: contact.phone } },
      create: upsertInput,
      update: upsertInput,
      select: { id: true, skillsAndCompetences: true, workExperience: true, educationAndTraining: true, desiredJob: true, jobConstraints: true },
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
          SET "embedding" = ${vectorToPgLiteral(vector)}::vector, "embeddingText" = ${embeddingText}, "embeddingUpdatedAt" = now()
          WHERE id = ${candidate.id}::uuid`;
      } catch (e) {
        console.error("[webhook assessment] embedding failed", { candidateId: candidate.id, error: e });
      }
    }
    return NextResponse.json({ ok: true, candidateId: candidate.id });
  } catch (e) {
    console.error("[webhook assessment] upsert failed", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter kubri-dashboard exec vitest run src/__tests__/app/api/webhooks/assessment/route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/api/webhooks/assessment apps/dashboard/src/__tests__/app/api/webhooks/assessment
git commit -m "feat(dashboard): assessment webhook upserts Candidate from submission"
```

---

## Task 7: Questionnaire components (assessment app)

**Files:**
- Create: `apps/assessment/src/components/questionnaire/{SingleChoice,MultiChoice,Scale,TextInput,TextArea,SelectInput,RepeatableGroup,QuestionRenderer}.tsx`

These are presentational client components. Each takes `{ question, value, onChange }` and is styled per the HTML reference (purple `#534AB7`, card buttons, slider). Build `QuestionRenderer` (the switch) + one representative input fully; the rest follow the same shape.

- [ ] **Step 1: `QuestionRenderer.tsx` (the switch)**

```tsx
"use client";
import type { QuestionDef } from "@kubri/contracts";
import { SingleChoice } from "./SingleChoice";
import { MultiChoice } from "./MultiChoice";
import { Scale } from "./Scale";
import { TextInput } from "./TextInput";
import { TextArea } from "./TextArea";
import { SelectInput } from "./SelectInput";
import { RepeatableGroup } from "./RepeatableGroup";

export interface FieldProps {
  question: QuestionDef;
  value: unknown;
  onChange: (value: unknown) => void;
}

export function QuestionRenderer({ question, value, onChange }: FieldProps) {
  switch (question.component) {
    case "single_choice": return <SingleChoice question={question} value={value} onChange={onChange} />;
    case "multi_choice": return <MultiChoice question={question} value={value} onChange={onChange} />;
    case "scale": return <Scale question={question} value={value} onChange={onChange} />;
    case "text": return <TextInput question={question} value={value} onChange={onChange} />;
    case "textarea": return <TextArea question={question} value={value} onChange={onChange} />;
    case "select": return <SelectInput question={question} value={value} onChange={onChange} />;
    case "repeatable_group": return <RepeatableGroup question={question} value={value} onChange={onChange} />;
  }
}
```

- [ ] **Step 2: `SingleChoice.tsx` (representative full component)**

```tsx
"use client";
import type { FieldProps } from "./QuestionRenderer";

export function SingleChoice({ question, value, onChange }: FieldProps) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {(question.options ?? []).map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md border px-3.5 py-2.5 text-left text-sm leading-snug transition ${
            value === o.value ? "border-[#534AB7] bg-[#EEEDFE] font-medium text-[#3C3489]" : "border-neutral-200 bg-neutral-50 hover:border-[#AFA9EC]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Build the remaining 6 components** following the same `FieldProps` contract:
  - `MultiChoice` — array value, toggle add/remove (checkbox style from the HTML reference).
  - `Scale` — `<input type="range" min max>` + value display + min/max labels; `onChange(Number(...))`.
  - `TextInput` / `TextArea` — controlled `<input>` / `<textarea>`, `placeholder` from the question.
  - `SelectInput` — `<select>` over `question.selectOptions`.
  - `RepeatableGroup` — list of entries; "add" pushes `{}`; each entry renders its `fields` via the matching inputs; value is an array of records.

- [ ] **Step 4: Verify the app builds**

Run: `pnpm --filter @kubri/assessment build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 5: Commit**

```bash
git add apps/assessment/src/components/questionnaire
git commit -m "feat(assessment): questionnaire input components + renderer"
```

---

## Task 8: AssessmentFlow — sections, CTAs, contact form, submit

**Files:**
- Create: `apps/assessment/src/lib/submit.ts`
- Create: `apps/assessment/src/components/AssessmentFlow.tsx`
- Modify: `apps/assessment/src/app/page.tsx`

- [ ] **Step 1: `submit.ts`**

```ts
import type { AssessmentSubmission } from "@kubri/contracts";

export async function submitCommunity(payload: AssessmentSubmission): Promise<boolean> {
  const res = await fetch("/api/community", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.ok;
}
```

- [ ] **Step 2: `AssessmentFlow.tsx` (client)** — holds `answers` state, walks `ASSESSMENT_SECTIONS` one section per screen with a progress bar, renders each question via `QuestionRenderer`. On completion shows the **two CTAs**:
  - *"Scarica il questionario"* — (report round; for now a disabled/placeholder button or a no-op with a "presto disponibile" note).
  - *"Scarica il questionario e unisciti alla community"* (prominent) — reveals the contact form: `nome`*, `cognome`*, `telefono`*, `email` (optional), required privacy checkbox, "no spam promesso!" copy, submit button. On submit, validate with `assessmentContactSchema`, then `submitCommunity({ contact, assessment: answers })`; show success/error state.

- [ ] **Step 3: `page.tsx`** — replace the placeholder with `<AssessmentFlow />` (server component renders the client flow).

```tsx
import { AssessmentFlow } from "@/components/AssessmentFlow";

export default function Home() {
  return <AssessmentFlow />;
}
```

- [ ] **Step 4: Build + manual smoke**

Run: `pnpm --filter @kubri/assessment build` → `✓ Compiled successfully`.
Then `pnpm --filter @kubri/assessment dev` and walk the flow; on join, confirm a POST to `/api/community` in the network tab (it will 500/502 locally without a live receiver — expected; the receiver is tested separately).

- [ ] **Step 5: Commit**

```bash
git add apps/assessment/src/components/AssessmentFlow.tsx apps/assessment/src/lib/submit.ts apps/assessment/src/app/page.tsx
git commit -m "feat(assessment): questionnaire flow with community opt-in form"
```

---

## Task 9: Env docs

**Files:**
- Modify: `.env.example` (at the **repo root** — that's where `ASSESSMENT_WEBHOOK_SECRET` already lives; it stayed at root through Phase 2)

- [ ] **Step 1: Add `ASSESSMENT_POOL_KEY`** to `.env.example`, after the `ASSESSMENT_WEBHOOK_SECRET` block:

```bash
# Pool (by externalKey) that assessment-sourced candidates are written to.
# The pool must already exist (admin UI / seed). Defaults to "global".
ASSESSMENT_POOL_KEY=global
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: ASSESSMENT_POOL_KEY env var"
```

---

## Final verification
- `pnpm exec vitest run packages/contracts apps/assessment` — registry/schema/mapping/community green.
- `pnpm --filter kubri-dashboard test` (dev env) — webhook receiver green; `prisma migrate status` up to date.
- `pnpm --filter @kubri/assessment build` and `pnpm --filter kubri-dashboard build` — both compile.
- End-to-end on a Vercel preview (or local with both apps running + the configured pool seeded): complete the questionnaire → join → a `Candidate` appears in the pool with mapped columns, populated `assessmentProfile`, `email` (if given), `sharedWithGlobal=true`, and an embedding.
- Then open a PR (PR flow is the standard). Out of scope this round: report screen, scoring, PDF/LLM.
```
