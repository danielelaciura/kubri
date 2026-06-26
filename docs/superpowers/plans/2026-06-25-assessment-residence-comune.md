# "Zona di residenza" (comune → lat/lon) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a required "zona di residenza" (comune) field to the assessment community form, resolved client-side to `location` + `latitude` + `longitude` on the `Candidate`, so the candidate enters geographic JD matching.

**Architecture:** A static ISTAT-derived comuni dataset (`public/comuni.json`, ~7900 entries with `nome`/`sigla`/`lat`/`lon`) is fetched on demand by a searchable `ComuneSelect` combobox. Selecting a comune sets `location`/`latitude`/`longitude` in the contact form state. The contract schema (shared `@kubri/contracts`) makes these required and range-checks coordinates; the dashboard webhook writes them onto the `Candidate` upsert. No DB migration (columns already exist).

**Tech Stack:** Next.js 16 (App Router, React 19, Turbopack), Zod 4 (`zod/v4`), Prisma 7, vitest 4.

---

## File Structure

- `apps/assessment/scripts/build-comuni.mjs` — **new**, one-time dataset generator (fetches 3 open sources, joins, writes `public/comuni.json`). Committed for provenance; not run at build time.
- `apps/assessment/public/comuni.json` — **new**, generated runtime asset (committed).
- `apps/assessment/src/lib/comuni.ts` — **new**, `Comune` type + `searchComuni` (pure) + `loadComuni` (fetch wrapper).
- `apps/assessment/src/lib/comuni.test.ts` — **new**, unit tests for `searchComuni`.
- `apps/assessment/src/components/questionnaire/ComuneSelect.tsx` — **new**, searchable combobox.
- `packages/contracts/src/index.ts` — **modify**, extend `assessmentContactSchema`.
- `packages/contracts/src/index.test.ts` — **modify**, update `VALID` fixture + add cases.
- `apps/assessment/src/components/AssessmentFlow.tsx` — **modify**, contact state + render + validation.
- `apps/dashboard/src/app/api/webhooks/assessment/route.ts` — **modify**, 3 fields on upsert.
- `apps/dashboard/src/__tests__/app/api/webhooks/assessment/route.test.ts` — **modify**, update `VALID` + assert.

---

## Task 1: Generate the comuni dataset

**Files:**
- Create: `apps/assessment/scripts/build-comuni.mjs`
- Create (generated): `apps/assessment/public/comuni.json`

Sources (verified reachable, ISTAT-derived, permissive):
- Names + province sigla (current, ~7904): `https://raw.githubusercontent.com/matteocontrini/comuni-json/master/comuni.json` (fields: `nome`, `codice` "PPPCCC", `sigla`)
- Coordinates (by ISTAT code): `https://raw.githubusercontent.com/MatteoHenryChinaski/Comuni-Italiani-2018-Sql-Json-Excel/master/italy_geo.json` (fields: `istat`, `comune`, `lat`, `lng`)
- Centroid fallback for post-2018 merged comuni: `https://raw.githubusercontent.com/openpolis/geojson-italy/master/geojson/limits_IT_municipalities.geojson`

Join logic (proven to cover 7904/7904): base = matteocontrini; coords by normalized ISTAT (`istat` → `prov(3).pad + comune(3).pad`); residue resolved by normalized-name exact then `startsWith` against openpolis polygon centroids.

- [ ] **Step 1: Write the generator script**

Create `apps/assessment/scripts/build-comuni.mjs`:

```js
// Generates apps/assessment/public/comuni.json from open ISTAT-derived sources.
// One-time / occasional run: `node apps/assessment/scripts/build-comuni.mjs`.
// Output: [{ nome, sigla, lat, lon }] sorted by nome, coords rounded to 5dp.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const NAMES = "https://raw.githubusercontent.com/matteocontrini/comuni-json/master/comuni.json";
const GEO = "https://raw.githubusercontent.com/MatteoHenryChinaski/Comuni-Italiani-2018-Sql-Json-Excel/master/italy_geo.json";
const OP = "https://raw.githubusercontent.com/openpolis/geojson-italy/master/geojson/limits_IT_municipalities.geojson";

const key = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const normIstat = (istat) => {
  istat = String(istat);
  const comune = istat.slice(-3).padStart(3, "0");
  const prov = istat.slice(0, -3).padStart(3, "0");
  return prov + comune;
};
const round5 = (n) => Math.round(n * 1e5) / 1e5;
function centroid(geom) {
  let xs = 0, ys = 0, n = 0;
  (function walk(a) { if (typeof a[0] === "number") { xs += a[0]; ys += a[1]; n++; } else a.forEach(walk); })(geom.coordinates);
  return [ys / n, xs / n]; // [lat, lon]
}
const getJson = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url} -> ${r.status}`); return r.json(); };

const [names, geo, op] = await Promise.all([getJson(NAMES), getJson(GEO), getJson(OP)]);

const coordsByIstat = new Map(geo.map((g) => [normIstat(g.istat), { lat: +g.lat, lon: +g.lng }]));
const opExact = new Map();
const opList = [];
for (const f of op.features) {
  const k = key(f.properties.name || "");
  const [lat, lon] = centroid(f.geometry);
  opExact.set(k, { lat, lon });
  opList.push([k, { lat, lon }]);
}

const out = [];
const failed = [];
for (const c of names) {
  let co = coordsByIstat.get(c.codice);
  if (!co) {
    const k = key(c.nome);
    co = opExact.get(k) || (opList.find(([ok]) => ok.startsWith(k)) || [])[1];
  }
  if (!co) { failed.push(c.nome); continue; }
  out.push({ nome: c.nome, sigla: c.sigla, lat: round5(co.lat), lon: round5(co.lon) });
}
if (failed.length) throw new Error(`Unresolved comuni: ${failed.length} -> ${failed.join(", ")}`);

out.sort((a, b) => a.nome.localeCompare(b.nome, "it"));
const dst = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "comuni.json");
writeFileSync(dst, JSON.stringify(out));
console.log(`Wrote ${out.length} comuni -> ${dst}`);
```

- [ ] **Step 2: Run the generator**

Run: `node apps/assessment/scripts/build-comuni.mjs`
Expected: `Wrote 7904 comuni -> .../apps/assessment/public/comuni.json` (no "Unresolved" error).

- [ ] **Step 3: Verify the output**

Run:
```bash
node -e 'const c=require("./apps/assessment/public/comuni.json"); const lat=c.map(x=>x.lat),lon=c.map(x=>x.lon); console.log("n",c.length); console.log("allValid",c.every(x=>x.nome&&x.sigla&&x.lat>=35&&x.lat<=48&&x.lon>=6&&x.lon<=19)); console.log("sample",JSON.stringify(c[0])); console.log("roma",JSON.stringify(c.find(x=>x.nome==="Roma")));'
```
Expected: `n 7904`, `allValid true`, sample is a valid object, Roma present with sane coords (~41.9, ~12.5).

- [ ] **Step 4: Commit**

```bash
git add apps/assessment/scripts/build-comuni.mjs apps/assessment/public/comuni.json
git commit -m "feat(assessment): generate ISTAT comuni dataset with coordinates"
```

---

## Task 2: Extend the contact contract schema

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/index.test.ts`

- [ ] **Step 1: Update the failing tests first**

Replace the `VALID` constant and add cases in `packages/contracts/src/index.test.ts`:

```ts
const VALID = {
  contact: {
    firstName: "Amir",
    lastName: "K",
    phone: "+393331234567",
    location: "Roma (RM)",
    latitude: 41.89,
    longitude: 12.48,
    privacyAccepted: true as const,
  },
  assessment: { q1: "analitico", q3: 4 },
};

describe("assessmentSubmissionSchema", () => {
  it("accepts a valid submission", () => {
    expect(assessmentSubmissionSchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects a missing location", () => {
    const { location, ...contact } = VALID.contact;
    const r = assessmentSubmissionSchema.safeParse({ contact, assessment: {} });
    expect(r.success).toBe(false);
  });

  it("rejects coordinates outside Italy", () => {
    const r = assessmentSubmissionSchema.safeParse({
      contact: { ...VALID.contact, latitude: 0, longitude: 0 },
      assessment: {},
    });
    expect(r.success).toBe(false);
  });

  it("rejects a missing phone", () => {
    const { phone, ...contact } = VALID.contact;
    const r = assessmentSubmissionSchema.safeParse({ contact, assessment: {} });
    expect(r.success).toBe(false);
  });

  it("rejects a malformed phone", () => {
    const r = assessmentSubmissionSchema.safeParse({
      contact: { ...VALID.contact, phone: "not-a-number" },
      assessment: {},
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run packages/contracts/src/index.test.ts`
Expected: FAIL — "accepts a valid submission" fails (schema rejects unknown keys / lacks the fields) and the new location/coords cases fail.

- [ ] **Step 3: Extend the schema**

In `packages/contracts/src/index.ts`, add the three fields to `assessmentContactSchema` (after `phone`, before `email`):

```ts
export const assessmentContactSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  // Digits with an optional leading "+", 8–15 long (loose E.164).
  phone: z.string().regex(/^\+?[0-9]{8,15}$/),
  // Residence comune, resolved client-side from the static comuni dataset.
  // location is the display label ("Comune (PROV)"); coordinates are range-
  // checked to Italy so a tampered client can't inject arbitrary points.
  location: z.string().min(1),
  latitude: z.number().min(35).max(48),
  longitude: z.number().min(6).max(19),
  email: z.string().email().optional(),
  privacyAccepted: z.literal(true),
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run packages/contracts/src/index.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/index.ts packages/contracts/src/index.test.ts
git commit -m "feat(contracts): require residence comune + Italy-bounded coordinates"
```

---

## Task 3: Comuni search library

**Files:**
- Create: `apps/assessment/src/lib/comuni.ts`
- Create: `apps/assessment/src/lib/comuni.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/assessment/src/lib/comuni.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { searchComuni, type Comune } from "./comuni";

const SAMPLE: Comune[] = [
  { nome: "Roma", sigla: "RM", lat: 41.89, lon: 12.48 },
  { nome: "Romagnano Sesia", sigla: "NO", lat: 45.62, lon: 8.39 },
  { nome: "Milano", sigla: "MI", lat: 45.46, lon: 9.19 },
  { nome: "Reggio Emilia", sigla: "RE", lat: 44.7, lon: 10.63 },
];

describe("searchComuni", () => {
  it("returns [] for a blank query", () => {
    expect(searchComuni("", SAMPLE)).toEqual([]);
    expect(searchComuni("  ", SAMPLE)).toEqual([]);
  });

  it("matches case- and accent-insensitively", () => {
    const r = searchComuni("ròma", SAMPLE);
    expect(r.map((c) => c.nome)).toContain("Roma");
  });

  it("ranks prefix matches before substring matches", () => {
    const r = searchComuni("rom", SAMPLE);
    expect(r[0]!.nome).toBe("Roma"); // prefix before 'Reggio'/substring
    expect(r.map((c) => c.nome)).toContain("Romagnano Sesia");
  });

  it("caps the number of results", () => {
    const many: Comune[] = Array.from({ length: 100 }, (_, i) => ({
      nome: `Borgo ${i}`, sigla: "XX", lat: 45, lon: 10,
    }));
    expect(searchComuni("borgo", many, 50).length).toBe(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/assessment/src/lib/comuni.test.ts`
Expected: FAIL — "Cannot find module './comuni'".

- [ ] **Step 3: Write the implementation**

Create `apps/assessment/src/lib/comuni.ts`:

```ts
export type Comune = {
  nome: string;
  sigla: string;
  lat: number;
  lon: number;
};

const normalize = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/**
 * Filter comuni by a free-text query. Accent/case-insensitive. Prefix matches
 * rank before substring matches; results are capped to `limit`.
 */
export function searchComuni(query: string, comuni: Comune[], limit = 50): Comune[] {
  const q = normalize(query);
  if (!q) return [];
  const prefix: Comune[] = [];
  const substr: Comune[] = [];
  for (const c of comuni) {
    const n = normalize(c.nome);
    if (n.startsWith(q)) prefix.push(c);
    else if (n.includes(q)) substr.push(c);
    if (prefix.length >= limit) break;
  }
  return [...prefix, ...substr].slice(0, limit);
}

let cache: Comune[] | null = null;

/** Fetch the static comuni dataset once and memoize it. */
export async function loadComuni(): Promise<Comune[]> {
  if (cache) return cache;
  const res = await fetch("/comuni.json");
  if (!res.ok) throw new Error(`comuni.json -> ${res.status}`);
  cache = (await res.json()) as Comune[];
  return cache;
}

/** The label stored in `Candidate.location`, e.g. "Roma (RM)". */
export const comuneLabel = (c: Comune) => `${c.nome} (${c.sigla})`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run apps/assessment/src/lib/comuni.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/assessment/src/lib/comuni.ts apps/assessment/src/lib/comuni.test.ts
git commit -m "feat(assessment): comuni search + load helpers"
```

---

## Task 4: ComuneSelect combobox component

**Files:**
- Create: `apps/assessment/src/components/questionnaire/ComuneSelect.tsx`

No unit test (the other questionnaire leaf components have none; assessment app has no DOM component-test harness). Verified via typecheck + lint + the manual walk in Task 6.

- [ ] **Step 1: Write the component**

Create `apps/assessment/src/components/questionnaire/ComuneSelect.tsx`:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { loadComuni, searchComuni, comuneLabel, type Comune } from "@/lib/comuni";

type Props = {
  /** Currently selected comune label ("Comune (PROV)"), or "" if none. */
  value: string;
  onSelect: (c: Comune) => void;
  onClear: () => void;
  error?: boolean;
};

export function ComuneSelect({ value, onSelect, onClear, error }: Props) {
  const [all, setAll] = useState<Comune[]>([]);
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadComuni().then(setAll).catch(() => setAll([]));
  }, []);

  // Keep the input text in sync when the parent resets the value.
  useEffect(() => setQuery(value), [value]);

  // Close on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const results = open && query.trim() ? searchComuni(query, all) : [];

  function pick(c: Comune) {
    onSelect(c);
    setQuery(comuneLabel(c));
    setOpen(false);
  }

  function onChange(next: string) {
    setQuery(next);
    setOpen(true);
    setActive(0);
    // Editing invalidates a previous selection so stale coordinates aren't kept.
    if (value) onClear();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) { setOpen(true); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (results[active]) pick(results[active]!); }
    else if (e.key === "Escape") setOpen(false);
  }

  return (
    <div className="relative" ref={boxRef}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls="comune-listbox"
        aria-label="Comune di residenza"
        aria-invalid={!!error}
        value={query}
        placeholder="Inizia a scrivere il tuo comune…"
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className={`w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#534AB7]/20 ${
          error ? "border-red-400 focus:border-red-500" : "border-neutral-300 focus:border-[#534AB7]"
        }`}
      />
      {open && results.length > 0 && (
        <ul
          id="comune-listbox"
          role="listbox"
          className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg"
        >
          {results.map((c, i) => (
            <li
              key={`${c.nome}-${c.sigla}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(c); }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-2 text-sm ${
                i === active ? "bg-[#EEEDFE] text-[#3C3489]" : "text-neutral-700"
              }`}
            >
              {c.nome} <span className="text-neutral-400">({c.sigla})</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm --filter @kubri/assessment exec tsc --noEmit && pnpm --filter @kubri/assessment lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/assessment/src/components/questionnaire/ComuneSelect.tsx
git commit -m "feat(assessment): ComuneSelect searchable combobox"
```

---

## Task 5: Wire ComuneSelect into the community form

**Files:**
- Modify: `apps/assessment/src/components/AssessmentFlow.tsx`

- [ ] **Step 1: Extend the contact state type**

In `apps/assessment/src/components/AssessmentFlow.tsx`, update `ContactFormState` (currently lines ~23–29):

```ts
type ContactFormState = {
  firstName: string;
  lastName: string;
  phone: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
  email: string;
  privacyAccepted: boolean;
};
```

And the initial state (the `useState<ContactFormState>({...})` call):

```ts
  const [contact, setContact] = useState<ContactFormState>({
    firstName: "",
    lastName: "",
    phone: "",
    location: "",
    latitude: null,
    longitude: null,
    email: "",
    privacyAccepted: false,
  });
```

- [ ] **Step 2: Add the import**

At the top of the file, add (next to the existing `submitCommunity` / contracts imports):

```ts
import { ComuneSelect } from "./questionnaire/ComuneSelect";
import type { Comune } from "@/lib/comuni";
import { comuneLabel } from "@/lib/comuni";
```

- [ ] **Step 3: Include the fields in the validated payload + error messages**

In `handleContactSubmit`, extend the `payload` object (after `phone`):

```ts
    const payload = {
      firstName: contact.firstName.trim(),
      lastName: contact.lastName.trim(),
      phone: contact.phone.trim().replace(/[\s().\-/]/g, ""),
      location: contact.location,
      latitude: contact.latitude ?? undefined,
      longitude: contact.longitude ?? undefined,
      email: contact.email.trim() || undefined,
      privacyAccepted: contact.privacyAccepted as true,
    };
```

And add to the `messages` map (so the location/coords issues surface one message):

```ts
      const messages: Record<string, string> = {
        firstName: "Inserisci il nome.",
        lastName: "Inserisci il cognome.",
        phone: "Inserisci un numero di telefono valido (es. +39 333 1234567).",
        location: "Seleziona un comune dalla lista.",
        latitude: "Seleziona un comune dalla lista.",
        longitude: "Seleziona un comune dalla lista.",
        email: "L'email non sembra valida.",
        privacyAccepted: "Devi accettare la privacy policy per continuare.",
      };
```

- [ ] **Step 4: Render the field (after the phone block, before the email block)**

Insert between the phone `</div>` (line ~377) and the email block (line ~379):

```tsx
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-neutral-700">
                  Comune di residenza <span className="text-red-500">*</span>
                </label>
                <ComuneSelect
                  value={contact.location}
                  error={!!(fieldErrors.location || fieldErrors.latitude || fieldErrors.longitude)}
                  onSelect={(c: Comune) =>
                    setContact((s) => ({
                      ...s,
                      location: comuneLabel(c),
                      latitude: c.lat,
                      longitude: c.lon,
                    }))
                  }
                  onClear={() =>
                    setContact((s) => ({ ...s, location: "", latitude: null, longitude: null }))
                  }
                />
                {(fieldErrors.location || fieldErrors.latitude || fieldErrors.longitude) && (
                  <p className="text-xs text-red-600">
                    {fieldErrors.location || fieldErrors.latitude || fieldErrors.longitude}
                  </p>
                )}
              </div>
```

- [ ] **Step 5: Typecheck, lint, build**

Run: `pnpm --filter @kubri/assessment exec tsc --noEmit && pnpm --filter @kubri/assessment lint && pnpm --filter @kubri/assessment build`
Expected: no errors, build succeeds.

- [ ] **Step 6: Manual walk**

Run: `pnpm dev:assessment`, complete the questionnaire to the community form. Verify: typing "rom" lists Roma/Romagnano; picking fills the field; submitting **without** picking shows "Seleziona un comune dalla lista."; editing after a pick clears the selection; a valid submit succeeds (with the dashboard running / webhook reachable).

- [ ] **Step 7: Commit**

```bash
git add apps/assessment/src/components/AssessmentFlow.tsx
git commit -m "feat(assessment): residence comune field in community form"
```

---

## Task 6: Persist location + coordinates on the Candidate

**Files:**
- Modify: `apps/dashboard/src/__tests__/app/api/webhooks/assessment/route.test.ts`
- Modify: `apps/dashboard/src/app/api/webhooks/assessment/route.ts`

- [ ] **Step 1: Update the test first**

In `route.test.ts`, update the `VALID` fixture's `contact`:

```ts
const VALID = {
  contact: {
    firstName: "Amir",
    lastName: "K",
    phone: "+393331234567",
    location: "Roma (RM)",
    latitude: 41.89,
    longitude: 12.48,
    privacyAccepted: true,
  },
  assessment: { q1: "analitico", q3: 4 },
};
```

And extend the success-case assertions (the "upserts with externalId = phone…" test):

```ts
    expect(arg.create.location).toBe("Roma (RM)");
    expect(arg.create.latitude).toBe(41.89);
    expect(arg.create.longitude).toBe(12.48);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter kubri-dashboard exec vitest run src/__tests__/app/api/webhooks/assessment/route.test.ts`
Expected: FAIL — `arg.create.location` is `undefined` (route doesn't set it yet). (The 400/401 tests still pass; the success assertions fail.)

- [ ] **Step 3: Add the fields to the upsert input**

In `apps/dashboard/src/app/api/webhooks/assessment/route.ts`, add to the `upsertInput` object (after `phone: contact.phone,`):

```ts
    phone: contact.phone,
    location: contact.location,
    latitude: contact.latitude,
    longitude: contact.longitude,
    email: contact.email ?? null,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter kubri-dashboard exec vitest run src/__tests__/app/api/webhooks/assessment/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/api/webhooks/assessment/route.ts apps/dashboard/src/__tests__/app/api/webhooks/assessment/route.test.ts
git commit -m "feat(assessment): write residence comune + coordinates to Candidate"
```

---

## Final verification

- [ ] `pnpm exec vitest run packages/contracts apps/assessment` — contracts + comuni tests green.
- [ ] `pnpm --filter kubri-dashboard exec vitest run src/__tests__/app/api/webhooks/assessment` — webhook test green.
- [ ] `pnpm --filter @kubri/assessment build` — assessment build green (dataset asset served from `public/`).
- [ ] End-to-end (dashboard running or Vercel preview): submit the form → a `Candidate` row has `location` = "Comune (PROV)", `latitude`/`longitude` populated and within Italy.

## Notes / out of scope

- No Prisma migration: `location`/`latitude`/`longitude` already exist on `Candidate`.
- No province/region/CAP columns; no ISTAT code persisted.
- The dataset is a committed snapshot; rerun `build-comuni.mjs` to refresh (requires network).
