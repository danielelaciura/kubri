# Assessment Report PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a downloadable, LLM-authored PDF competence report (intro narrative + cluster map + per-domain competence table) behind both end-of-assessment CTAs.

**Architecture:** The browser POSTs the in-memory assessment answers (no PII) to the assessment app's `/api/report` proxy, which forwards (bearer secret) to the dashboard's `/api/assessment/report`. The dashboard calls Mistral (`mistral-small-latest`, JSON mode) to get a validated JSON of competences mapped onto a **fixed 5-domain taxonomy**, computes a radial layout (pure function), renders a PDF with `@react-pdf/renderer` (SVG primitives for the map), and streams `application/pdf` back. Generation is stateless.

**Tech Stack:** Next.js 16, TypeScript strict, Zod 4 (`zod/v4`), `@react-pdf/renderer` v4 (`renderToBuffer`, `Svg`/`Circle`/`Line`/`Text`, `Font.register`), Mistral chat API, vitest 4.

---

## File structure

- `packages/contracts/src/assessment/report.ts` — **new**: `DOMAIN_IDS`, `DOMAIN_LABELS`, `assessmentReportSchema`, `AssessmentReport` type.
- `packages/contracts/src/index.ts` — **modify**: re-export `./assessment/report`.
- `apps/dashboard/src/lib/report/layout.ts` — **new**: pure radial-layout function.
- `apps/dashboard/src/lib/llm/mistral.ts` — **new**: thin Mistral JSON client.
- `apps/dashboard/src/lib/report/prompt.ts` — **new**: builds the prompt from answers + taxonomy.
- `apps/dashboard/src/lib/report/generate.ts` — **new**: orchestrates Mistral call + validate + retry → `AssessmentReport`.
- `apps/dashboard/src/components/report/fonts/Onest-var.ttf` — **new**: bundled variable font.
- `apps/dashboard/src/components/report/CompetenceReportPdf.tsx` — **new**: the PDF document + `renderCompetenceReportPdf`.
- `apps/dashboard/src/app/api/assessment/report/route.ts` — **new**: orchestrator endpoint.
- `apps/assessment/src/app/api/report/route.ts` — **new**: proxy.
- `apps/assessment/src/components/AssessmentFlow.tsx` — **modify**: wire both CTAs + download.
- `apps/assessment/.env.example` (or root `.env.example`) — **modify**: `DASHBOARD_REPORT_URL`.

Tests live beside or under `__tests__` mirroring existing patterns.

---

## Task 1: Report schema in contracts

**Files:**
- Create: `packages/contracts/src/assessment/report.ts`
- Create: `packages/contracts/src/assessment/report.test.ts`
- Modify: `packages/contracts/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/contracts/src/assessment/report.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assessmentReportSchema, DOMAIN_IDS, DOMAIN_LABELS } from "./report";

const VALID = {
  intro: "Profilo pratico e orientato alle persone.",
  domains: [
    { id: "technical", competences: [{ name: "Lavoro manuale", level: "Forte", note: "Punto di forza" }] },
    { id: "relational", competences: [{ name: "Cura del cliente", level: "Buono", note: "Da esperienza" }] },
  ],
};

describe("assessmentReportSchema", () => {
  it("exposes the 5 fixed domains with Italian labels", () => {
    expect(DOMAIN_IDS).toHaveLength(5);
    expect(DOMAIN_LABELS.technical).toBe("Tecnico-operative");
  });

  it("accepts a valid report", () => {
    expect(assessmentReportSchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects a domain id outside the taxonomy", () => {
    const r = assessmentReportSchema.safeParse({
      ...VALID,
      domains: [{ id: "leadership", competences: [{ name: "X", level: "Forte", note: "" }] }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a non-enum level", () => {
    const r = assessmentReportSchema.safeParse({
      ...VALID,
      domains: [{ id: "technical", competences: [{ name: "X", level: "Ottimo", note: "" }] }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a missing intro", () => {
    const { intro, ...rest } = VALID;
    expect(assessmentReportSchema.safeParse(rest).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/contracts/src/assessment/report.test.ts`
Expected: FAIL — "Cannot find module './report'".

- [ ] **Step 3: Write the implementation**

Create `packages/contracts/src/assessment/report.ts`:

```ts
import { z } from "zod/v4";

/** Fixed competence-domain taxonomy. The LLM assigns competences to these; it never invents domains. */
export const DOMAIN_IDS = [
  "cognitive",
  "relational",
  "organizational",
  "technical",
  "motivation",
] as const;

export type DomainId = (typeof DOMAIN_IDS)[number];

export const DOMAIN_LABELS: Record<DomainId, string> = {
  cognitive: "Cognitive",
  relational: "Relazionali",
  organizational: "Organizzative",
  technical: "Tecnico-operative",
  motivation: "Motivazioni & interessi",
};

export const COMPETENCE_LEVELS = ["Base", "Buono", "Forte"] as const;
export type CompetenceLevel = (typeof COMPETENCE_LEVELS)[number];

export const assessmentReportSchema = z.object({
  intro: z.string().min(1),
  domains: z
    .array(
      z.object({
        id: z.enum(DOMAIN_IDS),
        competences: z
          .array(
            z.object({
              name: z.string().min(1),
              level: z.enum(COMPETENCE_LEVELS),
              note: z.string(),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});

export type AssessmentReport = z.infer<typeof assessmentReportSchema>;
```

- [ ] **Step 4: Re-export from the package index**

In `packages/contracts/src/index.ts`, add after the other assessment re-exports (e.g. after `export * from "./assessment/mapping";`):

```ts
export * from "./assessment/report";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run packages/contracts`
Expected: all green (including the new file).

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/assessment/report.ts packages/contracts/src/assessment/report.test.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): assessment report schema (fixed domain taxonomy)"
```

---

## Task 2: Radial layout (pure function)

**Files:**
- Create: `apps/dashboard/src/lib/report/layout.ts`
- Create: `apps/dashboard/src/lib/report/layout.test.ts`

The layout positions a center node, one node per (non-empty) domain evenly on a circle, and the domain's competence leaves on a short outward arc. Leaves are capped (overflow still appears in the table, not the map).

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/lib/report/layout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeReportLayout, MAX_LEAVES_PER_DOMAIN } from "./layout";
import type { AssessmentReport } from "@kubri/contracts";

function domain(id: AssessmentReport["domains"][number]["id"], n: number) {
  return { id, competences: Array.from({ length: n }, (_, i) => ({ name: `c${i}`, level: "Buono" as const, note: "" })) };
}

describe("computeReportLayout", () => {
  it("creates one node per domain plus the center", () => {
    const l = computeReportLayout([domain("technical", 2), domain("relational", 1)]);
    expect(l.domains).toHaveLength(2);
    expect(l.center).toBeDefined();
    expect(l.edges.length).toBe(2); // center → each domain
  });

  it("caps leaves per domain but keeps coordinates finite", () => {
    const l = computeReportLayout([domain("cognitive", MAX_LEAVES_PER_DOMAIN + 4)]);
    expect(l.domains[0]!.leaves.length).toBe(MAX_LEAVES_PER_DOMAIN);
    for (const leaf of l.domains[0]!.leaves) {
      expect(Number.isFinite(leaf.x)).toBe(true);
      expect(Number.isFinite(leaf.y)).toBe(true);
    }
  });

  it("maps domain ids to Italian labels", () => {
    const l = computeReportLayout([domain("technical", 1)]);
    expect(l.domains[0]!.label).toBe("Tecnico-operative");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter kubri-dashboard exec vitest run src/lib/report/layout.test.ts`
Expected: FAIL — "Cannot find module './layout'".

- [ ] **Step 3: Write the implementation**

Create `apps/dashboard/src/lib/report/layout.ts`:

```ts
import { DOMAIN_LABELS, type AssessmentReport, type DomainId } from "@kubri/contracts";

/** Map canvas (matches the SVG viewBox used by the PDF component). */
export const CANVAS_W = 720;
export const CANVAS_H = 360;
export const MAX_LEAVES_PER_DOMAIN = 6;

const CENTER = { x: CANVAS_W / 2, y: CANVAS_H / 2 };
const DOMAIN_RADIUS = 130; // distance center → domain node
const LEAF_RADIUS = 70; // distance domain node → its leaves

export type LeafNode = { name: string; x: number; y: number };
export type DomainNode = { id: DomainId; label: string; x: number; y: number; leaves: LeafNode[] };
export type Edge = { x1: number; y1: number; x2: number; y2: number };
export type ReportLayout = {
  center: { x: number; y: number };
  domains: DomainNode[];
  edges: Edge[];
};

/**
 * Radial layout: domains evenly around the center; each domain's leaves fanned
 * on a short outward arc. Pure — no I/O. Leaves beyond MAX_LEAVES_PER_DOMAIN are
 * dropped from the map (they still appear in the table).
 */
export function computeReportLayout(domains: AssessmentReport["domains"]): ReportLayout {
  const n = domains.length;
  const out: DomainNode[] = [];
  const edges: Edge[] = [];

  domains.forEach((d, i) => {
    // Spread domains around the circle, starting at the top (-90°).
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const dx = CENTER.x + DOMAIN_RADIUS * Math.cos(angle);
    const dy = CENTER.y + DOMAIN_RADIUS * Math.sin(angle);
    edges.push({ x1: CENTER.x, y1: CENTER.y, x2: dx, y2: dy });

    const shown = d.competences.slice(0, MAX_LEAVES_PER_DOMAIN);
    const leaves: LeafNode[] = shown.map((c, j) => {
      // Fan leaves outward around the domain's own angle.
      const spread = Math.PI / 3; // 60° fan
      const t = shown.length === 1 ? 0 : (j / (shown.length - 1) - 0.5) * spread;
      const a = angle + t;
      return { name: c.name, x: dx + LEAF_RADIUS * Math.cos(a), y: dy + LEAF_RADIUS * Math.sin(a) };
    });

    out.push({ id: d.id, label: DOMAIN_LABELS[d.id], x: dx, y: dy, leaves });
  });

  return { center: { ...CENTER }, domains: out, edges };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter kubri-dashboard exec vitest run src/lib/report/layout.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/lib/report/layout.ts apps/dashboard/src/lib/report/layout.test.ts
git commit -m "feat(report): pure radial layout for the competence map"
```

---

## Task 3: Mistral client + prompt builder

**Files:**
- Create: `apps/dashboard/src/lib/llm/mistral.ts`
- Create: `apps/dashboard/src/lib/report/prompt.ts`
- Create: `apps/dashboard/src/lib/report/prompt.test.ts`

The prompt builder is pure and the high-value unit to test (taxonomy present, answers present, **no PII**). The Mistral client is a thin fetch wrapper.

- [ ] **Step 1: Write the failing test (prompt builder)**

Create `apps/dashboard/src/lib/report/prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildReportPrompt } from "./prompt";

describe("buildReportPrompt", () => {
  const answers = { q1: "analitico", q3: 4, esperienze: [{ ruolo: "Cameriere" }] };

  it("injects all five domain ids into the system prompt", () => {
    const { system } = buildReportPrompt(answers);
    for (const id of ["cognitive", "relational", "organizational", "technical", "motivation"]) {
      expect(system).toContain(id);
    }
  });

  it("includes the candidate answers in the user prompt", () => {
    const { user } = buildReportPrompt(answers);
    expect(user).toContain("Cameriere");
    expect(user).toContain("analitico");
  });

  it("never includes contact PII even if accidentally present", () => {
    const { system, user } = buildReportPrompt({
      ...answers,
      firstName: "Mario",
      phone: "+393331234567",
      email: "mario@x.it",
    } as Record<string, unknown>);
    const all = system + user;
    expect(all).not.toContain("Mario");
    expect(all).not.toContain("+393331234567");
    expect(all).not.toContain("mario@x.it");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter kubri-dashboard exec vitest run src/lib/report/prompt.test.ts`
Expected: FAIL — "Cannot find module './prompt'".

- [ ] **Step 3: Write the prompt builder**

Create `apps/dashboard/src/lib/report/prompt.ts`:

```ts
import { DOMAIN_IDS, DOMAIN_LABELS, COMPETENCE_LEVELS } from "@kubri/contracts";

// Contact fields that must never reach the LLM, stripped defensively in case a
// caller passes a wider object than the bare assessment answers.
const PII_KEYS = new Set(["firstName", "lastName", "phone", "email", "location", "latitude", "longitude"]);

function stripPii(answers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(answers)) {
    if (!PII_KEYS.has(k)) out[k] = v;
  }
  return out;
}

export function buildReportPrompt(answers: Record<string, unknown>): { system: string; user: string } {
  const domains = DOMAIN_IDS.map((id) => `- ${id} (${DOMAIN_LABELS[id]})`).join("\n");
  const levels = COMPETENCE_LEVELS.join(", ");

  const system = [
    "Sei un analista di competenze per Kubri. Dalle risposte a un questionario di self-assessment",
    "produci un report in italiano. Raggruppa le competenze emerse SOLO in questi domini fissi (usa gli id esatti):",
    domains,
    "",
    "Regole:",
    "- Non inventare domini diversi da quelli elencati. Ometti un dominio se non emergono competenze.",
    `- Per ogni competenza assegna un livello tra: ${levels}.`,
    "- 'note' è una frase breve che contestualizza la competenza dalle risposte.",
    "- 'intro' è una sintesi narrativa di 3-4 frasi del profilo, in seconda persona (\"tu\").",
    "- Non usare nomi propri o dati personali: NON ci sono nel testo che ricevi.",
    "",
    "Rispondi SOLO con JSON valido di forma:",
    '{ "intro": string, "domains": [ { "id": <uno degli id>, "competences": [ { "name": string, "level": <livello>, "note": string } ] } ] }',
  ].join("\n");

  const user = "Risposte al questionario (JSON):\n" + JSON.stringify(stripPii(answers), null, 2);

  return { system, user };
}
```

- [ ] **Step 4: Write the Mistral client**

Create `apps/dashboard/src/lib/llm/mistral.ts`:

```ts
const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";
const MODEL = "mistral-small-latest";

export class MistralError extends Error {}

/**
 * Call Mistral in JSON mode and return the parsed JSON content (unknown — the
 * caller validates it). Throws MistralError on transport/HTTP/parse failure.
 */
export async function callMistralJson(system: string, user: string): Promise<unknown> {
  const key = process.env["MISTRAL_API_KEY"];
  if (!key) throw new MistralError("MISTRAL_API_KEY missing");

  const timeoutMs = Number(process.env["MISTRAL_TIMEOUT_MS"] ?? "20000");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(MISTRAL_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      }),
      signal: controller.signal,
    });
  } catch (e) {
    throw new MistralError("Mistral request failed");
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new MistralError(`Mistral HTTP ${res.status}`);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new MistralError("Mistral response not JSON");
  }
  const content = (body as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new MistralError("Mistral response missing content");

  try {
    return JSON.parse(content);
  } catch {
    throw new MistralError("Mistral content not parseable JSON");
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter kubri-dashboard exec vitest run src/lib/report/prompt.test.ts`
Expected: PASS (3 tests). (The Mistral client is exercised by the route test in Task 5.)

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/lib/llm/mistral.ts apps/dashboard/src/lib/report/prompt.ts apps/dashboard/src/lib/report/prompt.test.ts
git commit -m "feat(report): Mistral JSON client + PII-free prompt builder"
```

---

## Task 4: Report generator (Mistral → validated report, with retry)

**Files:**
- Create: `apps/dashboard/src/lib/report/generate.ts`
- Create: `apps/dashboard/src/lib/report/generate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/lib/report/generate.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/llm/mistral", () => ({ callMistralJson: vi.fn(), MistralError: class extends Error {} }));

import { callMistralJson } from "@/lib/llm/mistral";
import { generateReport } from "./generate";

const VALID = {
  intro: "Profilo pratico.",
  domains: [{ id: "technical", competences: [{ name: "Lavoro manuale", level: "Forte", note: "ok" }] }],
};

describe("generateReport", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns the validated report on first success", async () => {
    (callMistralJson as ReturnType<typeof vi.fn>).mockResolvedValueOnce(VALID);
    const r = await generateReport({ q1: "analitico" });
    expect(r.domains[0]!.id).toBe("technical");
    expect(callMistralJson).toHaveBeenCalledTimes(1);
  });

  it("retries once when the first result is schema-invalid", async () => {
    (callMistralJson as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ intro: "x", domains: [{ id: "BAD", competences: [] }] })
      .mockResolvedValueOnce(VALID);
    const r = await generateReport({ q1: "analitico" });
    expect(r.intro).toBe("Profilo pratico.");
    expect(callMistralJson).toHaveBeenCalledTimes(2);
  });

  it("throws after a persistent failure (two bad results)", async () => {
    (callMistralJson as ReturnType<typeof vi.fn>).mockResolvedValue({ nope: true });
    await expect(generateReport({ q1: "analitico" })).rejects.toThrow();
    expect(callMistralJson).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter kubri-dashboard exec vitest run src/lib/report/generate.test.ts`
Expected: FAIL — "Cannot find module './generate'".

- [ ] **Step 3: Write the implementation**

Create `apps/dashboard/src/lib/report/generate.ts`:

```ts
import { assessmentReportSchema, type AssessmentReport } from "@kubri/contracts";
import { callMistralJson } from "@/lib/llm/mistral";
import { buildReportPrompt } from "./prompt";

export class ReportGenerationError extends Error {}

/**
 * Build the prompt, call Mistral, and validate against the report schema.
 * Retries once on any failure (transport or schema-invalid). Throws
 * ReportGenerationError if both attempts fail.
 */
export async function generateReport(answers: Record<string, unknown>): Promise<AssessmentReport> {
  const { system, user } = buildReportPrompt(answers);

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callMistralJson(system, user);
      const parsed = assessmentReportSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
      lastErr = new ReportGenerationError("schema validation failed");
    } catch (e) {
      lastErr = e;
    }
  }
  throw new ReportGenerationError(`report generation failed: ${String(lastErr)}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter kubri-dashboard exec vitest run src/lib/report/generate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/lib/report/generate.ts apps/dashboard/src/lib/report/generate.test.ts
git commit -m "feat(report): generate + validate report with single retry"
```

---

## Task 5: PDF document component

**Files:**
- Create: `apps/dashboard/src/components/report/fonts/Onest-var.ttf`
- Create: `apps/dashboard/src/components/report/CompetenceReportPdf.tsx`
- Create: `apps/dashboard/src/components/report/CompetenceReportPdf.test.ts`

- [ ] **Step 1: Fetch the Onest variable font**

Run from the worktree root:
```bash
mkdir -p apps/dashboard/src/components/report/fonts
curl -sL "https://github.com/google/fonts/raw/main/ofl/onest/Onest%5Bwght%5D.ttf" -o apps/dashboard/src/components/report/fonts/Onest-var.ttf
node -e 'const s=require("fs").statSync("apps/dashboard/src/components/report/fonts/Onest-var.ttf").size; if(s<50000) throw new Error("font too small: "+s); console.log("font bytes", s)'
```
Expected: `font bytes` ≈ 124000. (Verified: `@react-pdf` v4 renders this variable font at weights 400/600/800 without error.)

- [ ] **Step 1b: Ensure the font is bundled into the serverless function**

The PDF component reads the TTF from disk at runtime via `process.cwd()`. On Vercel the
font file lives under `src/` and is NOT traced into the route's serverless bundle by
default, so production would fail with a missing-font error even though local tests pass.
Add `outputFileTracingIncludes` to `apps/dashboard/next.config.ts` so the font ships with
the report route. The current config is:

```ts
const nextConfig: NextConfig = {
  turbopack: {
    root: workspaceRoot,
  },
  outputFileTracingRoot: workspaceRoot,
};
```

Change it to:

```ts
const nextConfig: NextConfig = {
  turbopack: {
    root: workspaceRoot,
  },
  outputFileTracingRoot: workspaceRoot,
  outputFileTracingIncludes: {
    "/api/assessment/report": ["./src/components/report/fonts/**"],
  },
};
```

- [ ] **Step 2: Write the failing test**

Create `apps/dashboard/src/components/report/CompetenceReportPdf.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { renderCompetenceReportPdf } from "./CompetenceReportPdf";
import type { AssessmentReport } from "@kubri/contracts";

const REPORT: AssessmentReport = {
  intro: "Profilo pratico e orientato alle persone.",
  domains: [
    { id: "technical", competences: [{ name: "Lavoro manuale", level: "Forte", note: "Punto di forza" }] },
    { id: "relational", competences: [{ name: "Cura del cliente", level: "Buono", note: "Da esperienza" }] },
  ],
};

describe("renderCompetenceReportPdf", () => {
  it("renders to a non-empty PDF buffer (with a name)", async () => {
    const buf = await renderToBuffer(renderCompetenceReportPdf({ report: REPORT, name: "Mario Rossi" }));
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("renders without a name", async () => {
    const buf = await renderToBuffer(renderCompetenceReportPdf({ report: REPORT }));
    expect(buf.length).toBeGreaterThan(1000);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter kubri-dashboard exec vitest run src/components/report/CompetenceReportPdf.test.ts`
Expected: FAIL — "Cannot find module './CompetenceReportPdf'".

- [ ] **Step 4: Write the component**

Create `apps/dashboard/src/components/report/CompetenceReportPdf.tsx`:

```tsx
import React from "react";
import {
  Document, Page, Text, View, StyleSheet, Font, Svg, Circle, Line,
} from "@react-pdf/renderer";
import path from "node:path";
import { DOMAIN_LABELS, type AssessmentReport } from "@kubri/contracts";
import { computeReportLayout, CANVAS_W, CANVAS_H } from "@/lib/report/layout";

Font.register({
  family: "Onest",
  fonts: [
    { src: path.join(process.cwd(), "src/components/report/fonts/Onest-var.ttf"), fontWeight: 400 },
    { src: path.join(process.cwd(), "src/components/report/fonts/Onest-var.ttf"), fontWeight: 600 },
    { src: path.join(process.cwd(), "src/components/report/fonts/Onest-var.ttf"), fontWeight: 800 },
  ],
});

const PURPLE = "#534AB7";
const PURPLE_DK = "#3C3489";
const PURPLE_LT = "#EEEDFE";

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 11, fontFamily: "Onest", color: "#1a1a1a" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottomWidth: 2, borderBottomColor: PURPLE, paddingBottom: 12, marginBottom: 16 },
  brand: { fontSize: 10, letterSpacing: 2, color: PURPLE, fontWeight: 800 },
  title: { fontSize: 20, fontWeight: 800, marginTop: 4 },
  name: { fontSize: 12, fontWeight: 800, color: "#333", textAlign: "right" },
  date: { fontSize: 9, color: "#888", textAlign: "right" },
  sectionLabel: { fontSize: 9, letterSpacing: 1.5, color: PURPLE, fontWeight: 800, marginBottom: 6, marginTop: 14 },
  intro: { fontSize: 11.5, color: "#333", lineHeight: 1.5 },
  domainHeader: { backgroundColor: PURPLE_LT, color: PURPLE_DK, fontWeight: 800, padding: 5, marginTop: 8 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#f0f0f0", paddingVertical: 5 },
  cName: { width: "34%", paddingHorizontal: 6 },
  cLevel: { width: "16%", paddingHorizontal: 6 },
  cNote: { width: "50%", paddingHorizontal: 6, color: "#555" },
  badge: { backgroundColor: PURPLE, color: "#fff", fontSize: 9, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8 },
  footer: { marginTop: 18, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#eee", fontSize: 9, color: "#999" },
});

function Map({ report }: { report: AssessmentReport }) {
  const layout = computeReportLayout(report.domains);
  return (
    <Svg viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} style={{ width: "100%", height: 250 }}>
      {layout.edges.map((e, i) => (
        <Line key={`e${i}`} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} strokeWidth={2.5} stroke="#C9C4F0" />
      ))}
      {layout.domains.flatMap((d) =>
        d.leaves.map((leaf, j) => (
          <Line key={`l${d.id}${j}`} x1={d.x} y1={d.y} x2={leaf.x} y2={leaf.y} strokeWidth={1.5} stroke="#E4E2FC" />
        )),
      )}
      {layout.domains.flatMap((d) =>
        d.leaves.map((leaf, j) => <Circle key={`lc${d.id}${j}`} cx={leaf.x} cy={leaf.y} r={3} fill="#AFA9EC" />),
      )}
      {layout.domains.map((d) => (
        <React.Fragment key={d.id}>
          <Circle cx={d.x} cy={d.y} r={34} fill={PURPLE_LT} stroke={PURPLE} strokeWidth={2} />
          <Text x={d.x} y={d.y + 3} style={{ fontSize: 9, fontWeight: 700, color: PURPLE_DK, textAlign: "center" }}>
            {d.label}
          </Text>
        </React.Fragment>
      ))}
      <Circle cx={layout.center.x} cy={layout.center.y} r={40} fill={PURPLE} />
      <Text x={layout.center.x} y={layout.center.y + 3} style={{ fontSize: 10, fontWeight: 800, color: "#fff", textAlign: "center" }}>
        competenze
      </Text>
    </Svg>
  );
}

function ReportDoc({ report, name }: { report: AssessmentReport; name?: string }) {
  const date = new Date().toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>KUBRI</Text>
            <Text style={styles.title}>Il tuo profilo di competenze</Text>
          </View>
          <View>
            {name ? <Text style={styles.name}>{name}</Text> : null}
            <Text style={styles.date}>{date}</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>IN SINTESI</Text>
        <Text style={styles.intro}>{report.intro}</Text>

        <Text style={styles.sectionLabel}>LA TUA MAPPA</Text>
        <Map report={report} />

        <Text style={styles.sectionLabel}>DETTAGLIO COMPETENZE</Text>
        {report.domains.map((d) => (
          <View key={d.id} wrap={false}>
            <Text style={styles.domainHeader}>{DOMAIN_LABELS[d.id]}</Text>
            {d.competences.map((c, i) => (
              <View key={i} style={styles.row}>
                <Text style={styles.cName}>{c.name}</Text>
                <View style={styles.cLevel}><Text style={styles.badge}>{c.level}</Text></View>
                <Text style={styles.cNote}>{c.note}</Text>
              </View>
            ))}
          </View>
        ))}

        <Text style={styles.footer}>
          Report generato dalle tue risposte all&#39;assessment Kubri · Le competenze riflettono il profilo emerso, non una valutazione formale.
        </Text>
      </Page>
    </Document>
  );
}

export function renderCompetenceReportPdf(props: { report: AssessmentReport; name?: string }): React.ReactElement {
  return <ReportDoc {...props} />;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter kubri-dashboard exec vitest run src/components/report/CompetenceReportPdf.test.ts`
Expected: PASS (2 tests). If a test fails because `process.cwd()` in the test runner is not `apps/dashboard`, run it with that cwd (vitest for the dashboard runs from `apps/dashboard`, so `process.cwd()` is correct).

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/report/ apps/dashboard/next.config.ts
git commit -m "feat(report): @react-pdf competence report document (Onest, SVG map)"
```

Note: the `Onest-var.ttf` is a binary; `git add` it explicitly (it is not gitignored).

---

## Task 6: Dashboard orchestrator route

**Files:**
- Create: `apps/dashboard/src/app/api/assessment/report/route.ts`
- Create: `apps/dashboard/src/__tests__/app/api/assessment/report/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/__tests__/app/api/assessment/report/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/llm/mistral", () => ({ callMistralJson: vi.fn(), MistralError: class extends Error {} }));

import { callMistralJson } from "@/lib/llm/mistral";
import { POST } from "@/app/api/assessment/report/route";

const SECRET = "test-secret";
const VALID_REPORT = {
  intro: "Profilo pratico.",
  domains: [{ id: "technical", competences: [{ name: "Lavoro manuale", level: "Forte", note: "ok" }] }],
};

function req(body: unknown, auth?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth !== undefined) headers["Authorization"] = auth;
  return new Request("http://localhost/api/assessment/report", { method: "POST", headers, body: JSON.stringify(body) });
}

describe("POST /api/assessment/report", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env["ASSESSMENT_WEBHOOK_SECRET"] = SECRET;
    process.env["MISTRAL_API_KEY"] = "x";
  });

  it("401 without secret", async () => {
    expect((await POST(req({ assessment: {} }))).status).toBe(401);
  });

  it("200 application/pdf on valid input", async () => {
    (callMistralJson as ReturnType<typeof vi.fn>).mockResolvedValue(VALID_REPORT);
    const res = await POST(req({ assessment: { q1: "analitico" }, name: "Mario Rossi" }, `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(1000);
  });

  it("never forwards PII (name) to the LLM", async () => {
    (callMistralJson as ReturnType<typeof vi.fn>).mockResolvedValue(VALID_REPORT);
    await POST(req({ assessment: { q1: "analitico" }, name: "Mario Rossi" }, `Bearer ${SECRET}`));
    const [system, user] = (callMistralJson as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(system + user).not.toContain("Mario");
  });

  it("502 after persistent LLM failure", async () => {
    (callMistralJson as ReturnType<typeof vi.fn>).mockResolvedValue({ nope: true });
    const res = await POST(req({ assessment: { q1: "analitico" } }, `Bearer ${SECRET}`));
    expect(res.status).toBe(502);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ALLOW_REMOTE_TEST_DB=1 pnpm --filter kubri-dashboard exec vitest run src/__tests__/app/api/assessment/report/route.test.ts`
Expected: FAIL — cannot find the route module.

- [ ] **Step 3: Write the route**

Create `apps/dashboard/src/app/api/assessment/report/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { renderToBuffer } from "@react-pdf/renderer";
import { generateReport } from "@/lib/report/generate";
import { renderCompetenceReportPdf } from "@/components/report/CompetenceReportPdf";

const bodySchema = z.object({
  assessment: z.record(z.string(), z.unknown()),
  name: z.string().optional(),
});

export async function POST(req: Request): Promise<Response> {
  const expected = process.env["ASSESSMENT_WEBHOOK_SECRET"];
  if (!expected || req.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  // name is used only for the PDF header — never passed to the LLM.
  const { assessment, name } = parsed.data;

  let report;
  try {
    report = await generateReport(assessment);
  } catch (e) {
    console.error("[assessment/report] generation failed", e);
    return NextResponse.json({ error: "report_generation_failed" }, { status: 502 });
  }

  const buffer = await renderToBuffer(renderCompetenceReportPdf({ report, name }));
  const safeName = (name ?? "kubri").replace(/[^a-zA-Z0-9À-ɏ\s-]/g, "").replace(/\s+/g, "-").toLowerCase() || "kubri";

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="competenze-${safeName}.pdf"`,
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `ALLOW_REMOTE_TEST_DB=1 pnpm --filter kubri-dashboard exec vitest run src/__tests__/app/api/assessment/report/route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/api/assessment/report/route.ts apps/dashboard/src/__tests__/app/api/assessment/report/route.test.ts
git commit -m "feat(report): dashboard endpoint — generate + stream report PDF"
```

---

## Task 7: Assessment proxy route

**Files:**
- Create: `apps/assessment/src/app/api/report/route.ts`
- Create: `apps/assessment/src/app/api/report/route.test.ts`
- Modify: root `.env.example`

- [ ] **Step 1: Write the failing test**

Create `apps/assessment/src/app/api/report/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "./route";

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID = { assessment: { q1: "analitico" }, name: "Mario Rossi" };

describe("POST /api/report", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env["DASHBOARD_REPORT_URL"] = "https://dash.example/api/assessment/report";
    process.env["ASSESSMENT_WEBHOOK_SECRET"] = "s3cr3t";
  });

  it("forwards to the dashboard with the bearer secret and streams the PDF", async () => {
    const pdf = new Uint8Array([37, 80, 68, 70]); // %PDF
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(pdf, { status: 200, headers: { "Content-Type": "application/pdf" } }),
    );
    const res = await POST(makeReq(VALID));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://dash.example/api/assessment/report");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer s3cr3t" });
  });

  it("returns 502 when the dashboard fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
    const res = await POST(makeReq(VALID));
    expect(res.status).toBe(502);
  });

  it("returns 500 when config is missing", async () => {
    delete process.env["DASHBOARD_REPORT_URL"];
    const res = await POST(makeReq(VALID));
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/assessment/src/app/api/report/route.test.ts`
Expected: FAIL — cannot find `./route`.

- [ ] **Step 3: Write the proxy route**

Create `apps/assessment/src/app/api/report/route.ts`:

```ts
import { NextResponse } from "next/server";

export async function POST(req: Request): Promise<Response> {
  const reportUrl = process.env["DASHBOARD_REPORT_URL"];
  const secret = process.env["ASSESSMENT_WEBHOOK_SECRET"];
  if (!reportUrl || !secret) {
    console.error("[assessment/report] missing config");
    return NextResponse.json({ error: "misconfigured" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(reportUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error("[assessment/report] upstream fetch failed", e);
    return NextResponse.json({ error: "upstream_unreachable" }, { status: 502 });
  }

  if (!upstream.ok) {
    console.error("[assessment/report] upstream error", upstream.status);
    return NextResponse.json({ error: "upstream_error" }, { status: 502 });
  }

  const buf = await upstream.arrayBuffer();
  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": upstream.headers.get("content-disposition") ?? 'attachment; filename="competenze-kubri.pdf"',
    },
  });
}
```

- [ ] **Step 4: Document the env var**

In the root `.env.example`, under the assessment/webhook section, add:

```
# Assessment app → dashboard report endpoint (PDF generation proxy)
DASHBOARD_REPORT_URL=
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run apps/assessment/src/app/api/report/route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/assessment/src/app/api/report/route.ts apps/assessment/src/app/api/report/route.test.ts .env.example
git commit -m "feat(assessment): /api/report proxy to the dashboard report endpoint"
```

---

## Task 8: Wire both CTAs to download the PDF

**Files:**
- Modify: `apps/assessment/src/components/AssessmentFlow.tsx`

No unit test (UI wiring); verified via build + manual.

- [ ] **Step 1: Add report download state + handler**

In `apps/assessment/src/components/AssessmentFlow.tsx`, add near the other `useState` declarations in `AssessmentFlow`:

```ts
  const [reportState, setReportState] = useState<"idle" | "loading" | "error">("idle");
```

And add this handler alongside `handleContactSubmit` (it posts the answers — and optionally a display name — to the proxy and triggers a browser download):

```ts
  async function downloadReport(name?: string) {
    setReportState("loading");
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assessment: answers, name }),
      });
      if (!res.ok) throw new Error(`report ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `competenze-kubri.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setReportState("idle");
    } catch {
      setReportState("error");
    }
  }
```

- [ ] **Step 2: Enable CTA 1 (download only)**

Replace the disabled CTA-1 block (the `{/* CTA 1 — Download (not yet available) */}` card, currently the `<div>` containing "Scarica il questionario" and the disabled "Presto disponibile" button) with:

```tsx
        {/* CTA 1 — Download only */}
        <div className="rounded-2xl border border-neutral-200 bg-white p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-neutral-900">Scarica il questionario</p>
              <p className="mt-0.5 text-sm text-neutral-500">Ricevi subito il tuo report PDF delle competenze.</p>
            </div>
            <button
              onClick={() => downloadReport()}
              disabled={reportState === "loading"}
              className="shrink-0 rounded-xl border border-[#534AB7] px-5 py-2.5 text-sm font-medium text-[#534AB7] transition-colors hover:bg-[#EEEDFE] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {reportState === "loading" ? "Generazione…" : "Scarica PDF"}
            </button>
          </div>
          {reportState === "error" && (
            <p className="mt-3 text-sm text-red-600">Qualcosa è andato storto. Riprova tra qualche secondo.</p>
          )}
        </div>
```

- [ ] **Step 3: Trigger the download on successful join too**

In `handleContactSubmit`, after `setSubmitState(ok ? "success" : "error");`, add a download using the contact name when the join succeeded:

```ts
      setSubmitState(ok ? "success" : "error");
      if (ok) {
        void downloadReport(`${result.data.firstName} ${result.data.lastName}`.trim());
      }
```

- [ ] **Step 4: Typecheck, lint, build**

Run: `pnpm --filter @kubri/assessment exec tsc --noEmit && pnpm --filter @kubri/assessment build`
Expected: no errors; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/assessment/src/components/AssessmentFlow.tsx
git commit -m "feat(assessment): wire both CTAs to download the report PDF"
```

---

## Final verification

- [ ] `pnpm exec vitest run packages/contracts apps/assessment` — contracts (report schema) + assessment (proxy) tests green.
- [ ] `ALLOW_REMOTE_TEST_DB=1 pnpm --filter kubri-dashboard exec vitest run src/lib/report src/components/report src/__tests__/app/api/assessment` — layout, prompt, generate, PDF-build, route tests green.
- [ ] `pnpm --filter @kubri/assessment build` and `pnpm --filter kubri-dashboard build` — both green.
- [ ] Manual / preview: finish the questionnaire → "Scarica PDF" downloads a branded report (intro + cluster map + table); the join CTA persists the candidate **and** downloads the report with the candidate name in the header.

## Notes / out of scope

- `MISTRAL_API_KEY` already exists in `.env.example` (used by the embedding Edge Function); the dashboard route reads it directly. New env: `DASHBOARD_REPORT_URL` (assessment app), and the proxy reuses `ASSESSMENT_WEBHOOK_SECRET`.
- No deterministic LLM-down fallback (V1). No persistence of the report. No "Approfondisci con Claude" CTA.
- The Onest variable font is registered for 3 weights from a single TTF (verified to render under `@react-pdf` v4).
