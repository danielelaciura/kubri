# Assessment — "Zona di residenza" (comune → lat/lon) nel form community

## Context

The public Assessment app (`apps/assessment`) collects a community lead at the end of
the questionnaire: `firstName`, `lastName`, `phone` (required), `email` (optional),
`privacyAccepted`. On submit it POSTs `{ contact, assessment }` to `/api/community`
(proxy, no DB creds) → `/api/webhooks/assessment` (dashboard, secret-authed), which
upserts a `Candidate`.

We need to also capture the candidate's **residence area (comune)** so the candidate
enters the dashboard's geographic JD-matching. The `Candidate` model **already has**
the target columns — no migration:

- `location  String?`
- `latitude  Float?`
- `longitude Float?`

These are the same coordinates the JD location filter uses (`JobDescription` has
`locationMunicipality` + `searchRadiusKm`).

## Decisions (locked)

- **Geocoding strategy:** static ISTAT-derived comuni dataset, **lookup client-side**.
  No external geocoding API (GDPR-clean, offline, no runtime dependency, aligned with
  "no external services for candidate data" + "lightweight bundle").
- **Required field** in the community form (like `firstName`/`phone`). Without
  coordinates the candidate can't be matched by location.
- **Minimal data (YAGNI):** store only `location` (string) + `latitude` + `longitude`.
  No separate province/region columns, no CAP, no ISTAT code persisted.

## Approach

### 1. Comuni dataset — `apps/assessment/public/comuni.json`

A static JSON array of Italian comuni, served as a **static asset** (not bundled into
JS). Each entry: `{ nome, provincia, lat, lon }` (provincia = 2-letter sigla, used only
to disambiguate homonyms in the UI). Sourced from an open ISTAT-derived dataset
(e.g. `matteocontrini/comuni-json` or equivalent) and committed verbatim; ~500KB–1MB.

Loaded on demand when the contact step mounts (`fetch("/comuni.json")`), parsed once,
filtered/searched in memory. A tiny in-memory index keyed by normalized name is fine at
this size.

### 2. UI — `ComuneSelect` (client component)

New `apps/assessment/src/components/questionnaire/ComuneSelect.tsx` (or under the
contact form): a searchable combobox consistent with the existing purple style
(`#534AB7`) and the a11y bar already set (visible `<label>`, `aria-` attributes,
`focus-visible:ring-2 focus-visible:ring-[#534AB7]`):

- User types → filter dataset by normalized name prefix/substring; cap rendered results
  (e.g. top 50) for performance.
- Each option displays `"Comune (PROV)"` to disambiguate homonyms (Peschiera, etc.).
- On selection, store the chosen `{ location: "Comune (PROV)", latitude, longitude }`
  in the contact form state.
- **Free text that doesn't resolve to a selected comune is invalid** → a field error
  ("Seleziona un comune dalla lista"), because without a selection we have no
  coordinates. Selecting from the list is the only way to set lat/lon.

Placed after the phone field, reusing the existing `fieldErrors` / `aria-invalid`
pattern in `AssessmentFlow.tsx`. The contact form state gains `comune` (display string)
+ `latitude` + `longitude` (numbers, `null` until selected).

### 3. Contract — `@kubri/contracts`

Extend `assessmentContactSchema` (in `packages/contracts/src/index.ts`):

```ts
location:  z.string().min(1),
latitude:  z.number().min(35).max(48),   // Italy latitude range
longitude: z.number().min(6).max(19),    // Italy longitude range
```

Required. This is enforced **twice** server-side: `/api/community` (assessment app) and
`/api/webhooks/assessment` (dashboard) both already re-validate
`assessmentSubmissionSchema`, so a client can't bypass validation or send coordinates
outside Italy.

### 4. Mapping → Candidate — webhook route

These are **contact-level** fields (like `firstName`/`phone`), NOT questionnaire
answers, so they're set **directly** in
`apps/dashboard/src/app/api/webhooks/assessment/route.ts` — NOT through
`mapAssessmentToCandidate` (which maps only `assessment` answers):

```
contact.location  → Candidate.location
contact.latitude  → Candidate.latitude
contact.longitude → Candidate.longitude
```

Added to the existing `upsertInput` object next to `firstName`/`phone`/`email`.

## Critical files

- New: `apps/assessment/public/comuni.json` (dataset)
- New: `apps/assessment/src/components/questionnaire/ComuneSelect.tsx`
- New: `apps/assessment/src/lib/comuni.ts` (load + search helper) — keeps fetch/filter
  logic out of the component
- Edit: `packages/contracts/src/index.ts` (extend `assessmentContactSchema` + tests)
- Edit: `apps/assessment/src/components/AssessmentFlow.tsx` (contact state + render +
  per-field validation)
- Edit: `apps/dashboard/src/app/api/webhooks/assessment/route.ts` (3 fields on upsert)
- Edit: webhook route test (assert location/lat/lon written)

## Out of scope

- No migration (columns exist).
- No province/region/CAP columns, no ISTAT code persistence.
- No reverse geocoding / map picker — comune granularity only.
- Backfill of existing candidates.

## Verification

- `pnpm exec vitest run packages/contracts` — schema accepts a valid contact with
  comune+coords; rejects missing location and out-of-range coordinates.
- `pnpm --filter kubri-dashboard test` — webhook test asserts `location`/`latitude`/
  `longitude` land on the upsert input.
- `pnpm --filter @kubri/assessment dev` — type a comune, pick from the list, confirm
  free-text-without-selection blocks submit; on join, payload carries location+coords.
- End-to-end (dashboard running / preview): submit → `Candidate` row has
  `location` + `latitude` + `longitude`, eligible for JD location matching.
