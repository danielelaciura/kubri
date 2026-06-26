# Assessment — Report PDF (intro + mappa a cluster + tabella competenze)

## Context

The public Assessment app (`apps/assessment`) ends on a "done" screen with two CTAs:
**"Scarica il questionario"** (download only) and **"Scarica il questionario e unisciti
alla community"** (download + persist candidate). Today the download CTA is a disabled
placeholder. This feature builds the deliverable behind both CTAs: a **downloadable PDF
report** of the candidate's competences, generated with an LLM.

Key existing facts:
- The questionnaire answers live **in browser memory** during the flow (`AssessmentFlow.tsx`,
  `answers` state). The structured registry is in `@kubri/contracts/src/assessment/`.
- The assessment app **holds no secrets** — it proxies to the dashboard (two-hop pattern,
  see `/api/community` → `/api/webhooks/assessment`).
- The dashboard already depends on **`@react-pdf/renderer`** (used by the candidate PDF
  export) — the established PDF stack.
- There is **no text-generation LLM in the project yet**. Embeddings go through a Supabase
  Edge Function; introducing a generative LLM is new. Provider chosen: **Mistral**
  (EU/GDPR-aligned, cheap, strong Italian) — see decisions.

## Decisions (locked)

- **Output:** one PDF, three sections in order — **Sintesi** (LLM narrative intro) →
  **Mappa** (cluster/tree: center → 5 domain nodes → competence leaves) → **Tabella**
  (competences grouped by domain, columns Competenza · Livello · Nota).
- **Font:** **Onest** (single family, weights 400/600/800), bundled + registered in
  `@react-pdf`. Brand purple `#534AB7` / `#EEEDFE` / `#3C3489`.
- **Cluster nodes = fixed competence-domain taxonomy (5):** `cognitive` (Cognitive),
  `relational` (Relazionali), `organizational` (Organizzative), `technical`
  (Tecnico-operative), `motivation` (Motivazioni & interessi). The LLM **never invents
  domains**; a domain with no emerged competences is omitted.
- **LLM role:** receives **only the assessment answers (no PII)**; returns **JSON only**
  (intro + per-domain competences with `level` + `note`). Our code does all rendering.
- **Provider/model:** Mistral, `mistral-small-latest`, JSON mode.
- **Generation is stateless:** nothing persisted for the download-only path. The "join"
  CTA additionally runs the existing `/api/community` persistence flow (independent).
- **Level column:** kept (Base/Buono/Forte), assigned by the LLM from answer intensity,
  constrained to the enum.

## Architecture

### Data flow (two-hop, stateless)

```
Browser (assessment answers in memory)
  └─ POST /api/report  { assessment, name? }  ──▶  assessment proxy (NO creds)
        └─ POST /api/assessment/report  (Bearer ASSESSMENT_WEBHOOK_SECRET)  ──▶ dashboard
              1. Mistral(assessment) → JSON  →  validate with assessmentReportSchema (Zod)
              2. compute radial layout (pure)  →  render @react-pdf → PDF bytes
              3. respond application/pdf
        ◀── stream PDF ───────────────────────────────────────────────────────┘
  ◀── browser downloads "competenze-<name>.pdf"
```

- The assessment app stays secret-free; only the dashboard calls Mistral.
- `name` (firstName/lastName), if present, is used **only in the rendered PDF header** —
  **never** forwarded to Mistral. The download-only path may omit it (header shows date only).
- The two CTAs both call `/api/report`. The "join" CTA *also* posts to `/api/community`
  (existing) to persist the candidate — the two requests are independent.

### LLM contract

Input to Mistral: a prompt embedding the **fixed taxonomy** + the candidate's assessment
answers (skills + psychometric), explicitly **no name/phone/email**. JSON mode.

Output schema (`assessmentReportSchema`, in `@kubri/contracts`):
```ts
{
  intro: string,                              // 3–4 sentence narrative, Italian
  domains: Array<{
    id: "cognitive" | "relational" | "organizational" | "technical" | "motivation",
    competences: Array<{
      name: string,
      level: "Base" | "Buono" | "Forte",
      note: string,                            // short contextual note
    }>,
  }>,
}
```
Validation is strict: ids outside the enum, malformed JSON, or non-enum levels →
treated as failure (retry → error). Domain labels are mapped from `id` in our code (not
trusted from the model), keeping display copy under our control.

### PDF rendering (deterministic, ours)

- `lib/report/layout.ts` — **pure function**: given the (post-validation) domains+leaves,
  returns the radial layout: center node, domain nodes evenly spaced on a circle, leaves
  on an outward arc per domain, plus edges. Caps leaves per domain (e.g. ≤ 6) to avoid
  clutter; all competences still appear in the table. No I/O, fully unit-testable.
- `components/report/CompetenceReportPdf.tsx` — `@react-pdf` document: registers Onest;
  renders header (brand + optional name + date), intro, the map via SVG primitives
  (`Svg`/`Circle`/`Line`/`Text`) from the layout, and the grouped competence table.
  A4; content may flow onto a second page (table) — `@react-pdf` handles pagination.

## File structure

**Create:**
- `packages/contracts/src/assessment/report.ts` — `assessmentReportSchema` + types + the
  `DOMAIN_IDS`/`DOMAIN_LABELS` constants. Re-export from `packages/contracts/src/index.ts`.
- `apps/dashboard/src/lib/llm/mistral.ts` — thin Mistral chat client (fetch, JSON mode,
  timeout, typed result). The only new external dependency surface.
- `apps/dashboard/src/lib/report/prompt.ts` — builds the prompt from assessment answers +
  fixed taxonomy.
- `apps/dashboard/src/lib/report/layout.ts` — pure radial-layout function.
- `apps/dashboard/src/components/report/CompetenceReportPdf.tsx` — the PDF document.
- `apps/dashboard/src/components/report/fonts/` — Onest TTFs (400/600/800).
- `apps/dashboard/src/app/api/assessment/report/route.ts` — orchestrator (secret auth →
  Mistral → validate → render → stream PDF).
- `apps/assessment/src/app/api/report/route.ts` — proxy to the dashboard endpoint.

**Modify:**
- `apps/assessment/src/components/AssessmentFlow.tsx` — wire both CTAs: loading state,
  call `/api/report`, trigger the file download; error + retry UI.
- `.env.example` — add `MISTRAL_API_KEY`; document `DASHBOARD_REPORT_URL` (assessment) and
  that the proxy reuses `ASSESSMENT_WEBHOOK_SECRET`.

## Error handling

- Mistral failure or schema-invalid JSON → **1 retry**; persistent failure → dashboard
  returns 502 → proxy 502 → UI shows an error message + "Riprova".
- The CTA shows a loading state during generation (a few seconds).
- **Out of scope (V1):** a deterministic no-LLM fallback that always yields a PDF when
  Mistral is down. Noted as a possible follow-up (a second code path); not built now.

## Testing

- `layout.ts` — unit: node count/positions, empty-domain omission, leaf cap, edges.
- `assessmentReportSchema` — accepts valid JSON; rejects out-of-taxonomy `id`, non-enum
  `level`, missing `intro`.
- `app/api/assessment/report/route.ts` — Mistral mocked: 401 without secret, 200 +
  `application/pdf` on valid JSON, 502 after retry on persistent failure, and the LLM
  input asserts **no PII** is sent.
- `CompetenceReportPdf` — builds without throwing for realistic data (no pixel snapshot).
- `apps/assessment/src/app/api/report/route.ts` — proxy forwards with the bearer secret,
  streams the PDF, maps upstream failure to 502 (mirrors the `/api/community` test).

## Out of scope

- No persistence of the generated report/JSON on `Candidate` (download-only is stateless;
  storing the narrative for operators is a future enhancement).
- No deterministic LLM-down fallback (V1).
- No "Approfondisci con Claude" interactive CTA (separate future round).
- No reverse changes to the embeddings/Supabase path.

## Verification

- `pnpm exec vitest run packages/contracts` — report schema tests green.
- `pnpm --filter kubri-dashboard test` — layout + route + PDF-builds tests green.
- `pnpm exec vitest run apps/assessment` — proxy route test green.
- Manual / preview: finish the questionnaire → click each CTA → a branded PDF downloads
  with intro + cluster map + competence table; "join" CTA also creates the Candidate.
